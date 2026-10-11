import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { MatchStatus, Prisma, ResultStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MatchesService } from '../matches/matches.service';
import { SCOREBOARD_AWARDS, ScoreboardCommandDto } from './dto/scoreboard.dto';

const SCOREBOARD_LEASE_MS = 20_000;
const MAX_SCORE = 50;

type Award = { id: number; side: number; award: string; points: number; remainingMs: number; at: string; actor: string; penaltyLevel?: number; opponentAward?: { side: number; award: 'ADVANTAGE' | 'POINTS'; points: number }; scoreChanges?: { side: number; before: number; after: number }[]; undone?: boolean };
type Clock = { remainingMs: number; runningSince: string | null; actions: Award[]; startedAt?: string; finishedAt?: string };

@Injectable()
export class ScoreboardService {
  constructor(private readonly prisma: PrismaService, private readonly matches: MatchesService) {}

  private leaseKey(userId: string, clientId: string) {
    return createHash('sha256').update(`${userId}:${clientId}`).digest('hex');
  }

  private load(db: Prisma.TransactionClient | PrismaService, id: string) {
    return db.match.findUnique({ where: { id }, include: { category: { select: { name: true, matchDurationSeconds: true } }, event: { select: { name: true } } } });
  }

  private terminal(match: any, clock: Clock) {
    return match.athlete1Score >= MAX_SCORE || match.athlete2Score >= MAX_SCORE
      || match.athlete1Penalties >= 4 || match.athlete2Penalties >= 4
      || clock.actions.some((action) => !action.undone && action.award === 'SUBMISSION');
  }

  private outcome(match: any, clock: Clock) {
    const actions = clock.actions.filter((action) => !action.undone);
    const submission = [...actions].reverse().find((action) => action.award === 'SUBMISSION');
    if (submission) return { winnerId: submission.side === 1 ? match.athlete1Id : match.athlete2Id, method: 'SUBMISSION', reason: 'Thắng bằng submission' };
    if (match.athlete1Penalties >= 4 || match.athlete2Penalties >= 4) {
      const winnerSide = match.athlete1Penalties >= 4 ? 2 : 1;
      return { winnerId: winnerSide === 1 ? match.athlete1Id : match.athlete2Id, method: 'DISQUALIFICATION', reason: 'Đối thủ nhận đủ 4 lần phạt' };
    }
    if (match.athlete1Score >= MAX_SCORE || match.athlete2Score >= MAX_SCORE) {
      const firstReached = actions.find((action) => action.scoreChanges?.some((change) => change.after >= MAX_SCORE));
      const firstSide = firstReached?.scoreChanges?.find((change) => change.after >= MAX_SCORE)?.side
        ?? (match.athlete1Score >= MAX_SCORE && match.athlete2Score < MAX_SCORE ? 1 : match.athlete2Score >= MAX_SCORE && match.athlete1Score < MAX_SCORE ? 2 : null);
      return firstSide ? { winnerId: firstSide === 1 ? match.athlete1Id : match.athlete2Id, method: 'POINTS', reason: 'Đạt 50 điểm trước' } : null;
    }
    if (match.athlete1Score !== match.athlete2Score) return { winnerId: match.athlete1Score > match.athlete2Score ? match.athlete1Id : match.athlete2Id, method: 'POINTS', reason: 'Nhiều điểm hơn' };
    if (match.athlete1Advantages !== match.athlete2Advantages) return { winnerId: match.athlete1Advantages > match.athlete2Advantages ? match.athlete1Id : match.athlete2Id, method: 'DECISION', reason: 'Điểm hòa; nhiều lợi thế hơn' };
    if (match.athlete1Penalties !== match.athlete2Penalties) return { winnerId: match.athlete1Penalties < match.athlete2Penalties ? match.athlete1Id : match.athlete2Id, method: 'DECISION', reason: 'Điểm và lợi thế hòa; ít lần phạt hơn' };
    return null;
  }

  async get(id: string) {
    const match = await this.load(this.prisma, id);
    if (!match) throw new NotFoundException('Không tìm thấy trận đấu');
    let blockedReason: string | null = null;
    if (match.status === 'SCHEDULED') {
      try { await this.matches.assertScoreboardReady(this.prisma, match); }
      catch (error) {
        if (!(error instanceof HttpException)) throw error;
        blockedReason = error.message;
      }
    }
    const clock = (match.resultData as any)?.scoreboard as Clock | undefined;
    const outcome = clock ? this.outcome(match, clock) : null;
    const resultData = (match.resultData || {}) as Record<string, any>;
    const visibleResultData = { ...resultData };
    delete visibleResultData.scoreboardLease;
    return { ...match, resultData: visibleResultData, proposedWinnerId: outcome?.winnerId ?? null, proposedWinMethod: outcome?.method ?? null, outcomeReason: outcome?.reason ?? null, serverNow: new Date().toISOString(), blockedReason };
  }

  async claim(id: string, userId: string, clientId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Match" WHERE id = ${id} FOR UPDATE`;
      const match = await this.load(tx, id);
      if (!match) throw new NotFoundException('Không tìm thấy trận đấu');
      if (!['SCHEDULED', 'RUNNING'].includes(match.status) || match.resultStatus !== ResultStatus.DRAFT) {
        throw new BadRequestException('Bảng điểm chỉ khả dụng cho trận chưa kết thúc');
      }
      if (match.status === 'SCHEDULED') await this.matches.assertScoreboardReady(tx, match);
      const data = (match.resultData || {}) as Record<string, any>;
      const existing = data.scoreboardLease;
      const key = this.leaseKey(userId, clientId);
      const now = Date.now();
      if (existing && Date.parse(existing.expiresAt) > now && existing.key !== key) {
        throw new ConflictException('Bảng điểm đang được điều khiển ở một tab khác. Đóng tab đó hoặc chờ phiên hết hạn.');
      }
      const expiresAt = new Date(now + SCOREBOARD_LEASE_MS).toISOString();
      await tx.match.update({ where: { id }, data: { resultData: { ...data, scoreboardLease: { key, expiresAt } } as Prisma.InputJsonValue } });
      return { owned: true, expiresAt };
    });
  }

  async heartbeat(id: string, userId: string, clientId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Match" WHERE id = ${id} FOR UPDATE`;
      const match = await this.load(tx, id);
      if (!match) throw new NotFoundException('Không tìm thấy trận đấu');
      const data = (match.resultData || {}) as Record<string, any>;
      const lease = data.scoreboardLease;
      if (!lease || lease.key !== this.leaseKey(userId, clientId) || Date.parse(lease.expiresAt) <= Date.now()) {
        throw new ConflictException('Quyền điều khiển bảng điểm đã hết hạn hoặc được chuyển sang tab khác. Tải lại trang để yêu cầu quyền mới.');
      }
      const expiresAt = new Date(Date.now() + SCOREBOARD_LEASE_MS).toISOString();
      await tx.match.update({ where: { id }, data: { resultData: { ...data, scoreboardLease: { ...lease, expiresAt } } as Prisma.InputJsonValue } });
      return { owned: true, expiresAt };
    });
  }

  async release(id: string, userId: string, clientId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Match" WHERE id = ${id} FOR UPDATE`;
      const match = await this.load(tx, id);
      if (!match) return { released: true };
      const data = (match.resultData || {}) as Record<string, any>;
      const lease = data.scoreboardLease;
      if (lease?.key === this.leaseKey(userId, clientId)) {
        const { scoreboardLease: _lease, ...rest } = data;
        await tx.match.update({ where: { id }, data: { resultData: rest as Prisma.InputJsonValue } });
      }
      return { released: true };
    });
  }

  async command(id: string, userId: string, dto: ScoreboardCommandDto) {
    await this.prisma.$transaction(async (tx) => {
      // Serialize starts within an event, including different matches on the same FOP.
      const initial = await this.load(tx, id);
      if (!initial) throw new NotFoundException('Không tìm thấy trận đấu');
      if (dto.action === 'START' || dto.action === 'FINISH') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.eventId}))`;
      }
      await tx.$queryRaw`SELECT id FROM "Match" WHERE id = ${id} FOR UPDATE`;
      const match = await this.load(tx, id);
      if (!match) throw new NotFoundException('Không tìm thấy trận đấu');
      if (dto.action === 'START') {
        const athleteIds = [match.athlete1Id, match.athlete2Id].filter(Boolean).sort();
        for (const athleteId of athleteIds) await tx.$queryRaw`SELECT id FROM "Athlete" WHERE id = ${athleteId} FOR UPDATE`;
      }
      if (match.resultVersion !== dto.expectedVersion) throw new ConflictException('Bảng điểm đã thay đổi. Tải lại trước khi thao tác.');
      if (match.resultStatus !== ResultStatus.DRAFT || !['SCHEDULED', 'RUNNING'].includes(match.status)) {
        throw new BadRequestException('Trận đấu đã kết thúc hoặc kết quả không còn là bản nháp');
      }
      const now = new Date();
      const data = (match.resultData || {}) as Record<string, any>;
      const lease = data.scoreboardLease;
      if (!dto.clientId || !lease || lease.key !== this.leaseKey(userId, dto.clientId) || Date.parse(lease.expiresAt) <= now.getTime()) {
        throw new ConflictException('Tab này không giữ quyền điều khiển bảng điểm. Tải lại để yêu cầu quyền mới.');
      }
      const clock: Clock = data.scoreboard ? { ...data.scoreboard, actions: [...data.scoreboard.actions] } : {
        remainingMs: (match.category.matchDurationSeconds || 300) * 1000, runningSince: null, actions: [],
      };
      const remaining = Math.max(0, clock.remainingMs - (clock.runningSince ? now.getTime() - Date.parse(clock.runningSince) : 0));
      const update: Prisma.MatchUncheckedUpdateManyInput = { resultVersion: { increment: 1 } };
      if (dto.action === 'START') {
        if (match.status !== 'SCHEDULED') throw new BadRequestException('Trận đấu đã bắt đầu');
        await this.matches.assertScoreboardReady(tx, match);
        update.status = MatchStatus.RUNNING;
        clock.runningSince = now.toISOString();
        clock.startedAt = now.toISOString();
      } else {
        if (match.status !== 'RUNNING') throw new BadRequestException('Hãy bắt đầu trận đấu trước');
        if (dto.action === 'RESUME') {
          if (this.terminal(match, clock)) {
            throw new BadRequestException('Trận đã có người thắng bằng submission, truất quyền hoặc đạt 50 điểm; hãy hoàn tác nếu cần sửa');
          }
          if (clock.runningSince || remaining === 0) throw new BadRequestException('Đồng hồ đang chạy hoặc đã hết giờ');
          clock.runningSince = now.toISOString();
        } else if (dto.action === 'PAUSE') {
          clock.remainingMs = remaining;
          clock.runningSince = null;
        } else if (dto.action === 'AWARD' || dto.action === 'UNDO') {
          let award: Award;
          let direction = 1;
          if (dto.action === 'UNDO') {
            let index = clock.actions.length - 1;
            while (index >= 0 && clock.actions[index].undone) index--;
            if (index < 0) throw new BadRequestException('Không có thao tác để hoàn tác');
            award = { ...clock.actions[index], undone: true };
            clock.actions[index] = award;
            direction = -1;
          } else {
            if (this.terminal(match, clock)) {
              throw new BadRequestException('Trận đã có người thắng bằng submission, truất quyền hoặc đạt 50 điểm; hãy hoàn tác nếu cần sửa');
            }
            if (!dto.side || !dto.award) throw new BadRequestException('Thiếu VĐV hoặc loại điểm');
            if (!SCOREBOARD_AWARDS.includes(dto.award)) throw new BadRequestException('Loại điểm không được hỗ trợ');
            if (dto.award === 'POINTS' && !dto.points) throw new BadRequestException('Thiếu số điểm');
            if (dto.penaltyLevel !== undefined) {
              if (dto.award !== 'PENALTY') throw new BadRequestException('Mốc phạt chỉ dùng cho thao tác phạt');
            }
            award = { id: match.resultVersion + 1, side: dto.side, award: dto.award, points: dto.award === 'POINTS' ? dto.points : 1, remainingMs: remaining, at: now.toISOString(), actor: userId };
            if (dto.award === 'PENALTY') {
              const currentPenalties = dto.side === 1 ? match.athlete1Penalties : match.athlete2Penalties;
              const penaltyLevel = currentPenalties + 1;
              if (penaltyLevel > 4 || (dto.penaltyLevel !== undefined && dto.penaltyLevel !== penaltyLevel)) {
                throw new BadRequestException('Chỉ có thể ghi nhận mốc phạt tiếp theo');
              }
              award.penaltyLevel = penaltyLevel;
              const opponentSide = dto.side === 1 ? 2 : 1;
              if (penaltyLevel === 2) award.opponentAward = { side: opponentSide, award: 'ADVANTAGE', points: 1 };
              if (penaltyLevel === 3) award.opponentAward = { side: opponentSide, award: 'POINTS', points: 2 };
            }
            clock.actions.push(award);
          }
          const suffix = { POINTS: 'Score', ADVANTAGE: 'Advantages', PENALTY: 'Penalties' }[award.award];
          if (suffix) {
            const field = `athlete${award.side}${suffix}`;
            update[field] = Math.max(0, match[field] + direction * award.points);
          }
          // Keep the opponent award in the same action so undo reverses both atomically.
          if (award.opponentAward) {
            const opponentAward = award.opponentAward;
            const field = `athlete${opponentAward.side}${opponentAward.award === 'ADVANTAGE' ? 'Advantages' : 'Score'}`;
            update[field] = Math.max(0, match[field] + direction * opponentAward.points);
          }
          if (direction === 1) {
            for (const side of [1, 2]) {
              const field = `athlete${side}Score`;
              const proposedScore = award.award === 'SUBMISSION' && award.side === side ? MAX_SCORE : update[field];
              if (typeof proposedScore !== 'number') continue;
              const after = Math.min(MAX_SCORE, Math.max(0, proposedScore));
              update[field] = after;
              (award.scoreChanges ||= []).push({ side, before: match[field], after });
            }
          } else if (award.scoreChanges) {
            for (const change of award.scoreChanges) update[`athlete${change.side}Score`] = change.before;
          }
          if (this.terminal({ ...match, ...update }, clock)) {
            clock.remainingMs = remaining;
            clock.runningSince = null;
          }
        } else if (dto.action === 'FINISH') {
          if (clock.runningSince && remaining > 0) throw new BadRequestException('Tạm dừng đồng hồ trước khi xác nhận');
          if (![match.athlete1Id, match.athlete2Id].includes(dto.winnerId) || !dto.winnerId || !dto.winMethod) {
            throw new BadRequestException('Chọn VĐV thắng và phương thức thắng');
          }
          const outcome = this.outcome({ ...match,
            athlete1Score: (match.athlete1Score || 0), athlete2Score: (match.athlete2Score || 0),
          }, clock);
          if (outcome && (dto.winnerId !== outcome.winnerId || dto.winMethod !== outcome.method)) {
            throw new BadRequestException(`Kết quả phải theo bảng điểm: ${outcome.reason}`);
          }
          if (!outcome && dto.winMethod !== 'DECISION') throw new BadRequestException('Khi mọi chỉ số bằng nhau, chọn Quyết định trọng tài');
          update.athlete1Score = Math.min(MAX_SCORE, match.athlete1Score || 0);
          update.athlete2Score = Math.min(MAX_SCORE, match.athlete2Score || 0);
          if (outcome?.method === 'SUBMISSION') update[outcome.winnerId === match.athlete1Id ? 'athlete1Score' : 'athlete2Score'] = MAX_SCORE;
          clock.remainingMs = remaining;
          clock.runningSince = null;
          clock.finishedAt = now.toISOString();
          update.status = MatchStatus.FINISHED;
          update.winnerId = dto.winnerId;
          update.winMethod = dto.winMethod;
          update.resultStatus = ResultStatus.REFEREE_CONFIRMED;
          update.resultEnteredAt = now;
          update.resultEnteredBy = userId;
          update.refereeConfirmedAt = now;
          update.refereeConfirmedBy = userId;
        }
      }
      const resultData: Record<string, any> = { ...data, scoreboard: clock };
      if (dto.action === 'FINISH') delete resultData.scoreboardLease;
      update.resultData = resultData as unknown as Prisma.InputJsonValue;
      const written = await tx.match.updateMany({ where: { id, resultVersion: dto.expectedVersion, status: match.status, resultStatus: ResultStatus.DRAFT }, data: update });
      if (written.count !== 1) throw new ConflictException('Trận đấu đã thay đổi. Hãy tải lại.');
      const after = await this.load(tx, id);
      if (dto.action === 'FINISH') await this.matches.syncProgression(tx, match, after);
      await tx.resultRevision.create({ data: {
        matchId: id, version: after.resultVersion, status: after.resultStatus,
        action: `SCOREBOARD_${dto.action}`, actorUserId: userId,
        before: JSON.parse(JSON.stringify(match)), after: JSON.parse(JSON.stringify(after)),
      } });
    });
    return this.get(id);
  }
}
