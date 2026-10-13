import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MatchStatus, Prisma, ResultStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MatchesService } from '../matches/matches.service';
import { SCOREBOARD_AWARDS, ScoreboardCommandDto } from './dto/scoreboard.dto';
import { SCOREBOARD_REVIEW_AWARDS, scoreboardReviewState, eventReviewCardAvailable, isScoreboardMedalMatch } from './scoreboard-review';
import { AUXILIARY_TIMER_AWARDS, STALLING_TIME_MS, activeMedicalSide, auxiliaryRemaining, auxiliaryTimers, pauseStallingTimers, type AuxiliaryTimer, type AuxiliaryTimers } from './scoreboard-timers';

const SCOREBOARD_LEASE_MS = 20_000;
const MAX_SCORE = 50;

type Award = { id: number; side: number; award: string; points: number; remainingMs: number; at: string; actor: string; penaltyLevel?: number; opponentAward?: { side: number; award: 'ADVANTAGE' | 'POINTS'; points: number }; scoreChanges?: { side: number; before: number; after: number }[]; source?: 'STALLING_TIMER'; medicalBefore?: AuxiliaryTimer; undone?: boolean };
type Clock = { remainingMs: number; runningSince: string | null; actions: Award[]; startedAt?: string; finishedAt?: string; auxiliaryTimers?: AuxiliaryTimers };

@Injectable()
export class ScoreboardService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScoreboardService.name);
  private timerInterval?: ReturnType<typeof setInterval>;
  private settlingTimers = false;
  constructor(private readonly prisma: PrismaService, private readonly matches: MatchesService) {}

  onModuleInit() {
    this.timerInterval = setInterval(() => {
      if (this.settlingTimers) return;
      this.settlingTimers = true;
      void this.settleAuxiliaryTimers().catch((error) => this.logger.error('Không thể cập nhật timer bảng điểm', error?.stack)).finally(() => { this.settlingTimers = false; });
    }, 500);
    this.timerInterval.unref();
  }

  onModuleDestroy() { if (this.timerInterval) clearInterval(this.timerInterval); }

  async settleAuxiliaryTimers() {
    const matches = await this.prisma.match.findMany({
      where: { status: MatchStatus.RUNNING, resultStatus: ResultStatus.DRAFT, OR: [1, 2].flatMap((side) => ['stall', 'medical'].map((kind) => ({
        resultData: { path: ['scoreboard', 'auxiliaryTimers', String(side), kind, 'active'], equals: true },
      }))) },
      select: { id: true, resultVersion: true, resultData: true },
    });
    for (const match of matches) {
      const clock = (match.resultData as any)?.scoreboard as Clock;
      const now = Date.now();
      const due: { side: 1 | 2; kind: 'stall' | 'medical'; actor: string; deadline: number }[] = [];
      for (const side of [1, 2] as const) {
        for (const kind of ['stall', 'medical'] as const) {
          const timer = clock?.auxiliaryTimers?.[side][kind];
          const matchEnded = clock.runningSince && now - Date.parse(clock.runningSince) >= clock.remainingMs;
          if (!timer?.active || timer.exhausted || (auxiliaryRemaining(timer, now) > 0 && !(kind === 'stall' && matchEnded))) continue;
          due.push({ side, kind, actor: timer.actor, deadline: timer.runningSince ? Date.parse(timer.runningSince) + timer.remainingMs : 0 });
        }
      }
      due.sort((a, b) => a.deadline - b.deadline);
      let expectedVersion = match.resultVersion;
      for (const { side, kind, actor } of due) {
        try {
          const after = await this.executeCommand(match.id, actor, { action: kind === 'stall' ? 'AWARD' : 'MEDICAL_EXPIRE', side, award: kind === 'stall' ? 'PENALTY' : undefined, expectedVersion, clientId: '' }, { side, kind });
          expectedVersion = after.resultVersion;
        } catch (error) {
          if (!(error instanceof ConflictException) && !(error instanceof BadRequestException)) throw error;
        }
      }
    }
  }

  private leaseKey(userId: string, clientId: string) {
    return createHash('sha256').update(`${userId}:${clientId}`).digest('hex');
  }

  private load(db: Prisma.TransactionClient | PrismaService, id: string) {
    return db.match.findUnique({ where: { id }, include: { category: { select: { name: true, matchDurationSeconds: true } }, event: { select: { name: true } }, draw: { select: { type: true } } } });
  }

  private async videoReview(db: Prisma.TransactionClient | PrismaService, match: any, clock?: Clock) {
    const cards = { 1: true, 2: true };
    if (!isScoreboardMedalMatch(match)) {
      const athleteIds = [match.athlete1Id, match.athlete2Id].filter(Boolean);
      const previousMatches = athleteIds.length ? await db.match.findMany({
        where: { eventId: match.eventId, id: { not: match.id }, status: { in: [MatchStatus.RUNNING, MatchStatus.FINISHED] },
          OR: [{ athlete1Id: { in: athleteIds } }, { athlete2Id: { in: athleteIds } }] },
        select: { athlete1Id: true, athlete2Id: true, matchType: true, winnerToMatchId: true, notes: true,
          draw: { select: { type: true } }, resultData: true, resultEnteredAt: true },
      }) : [];
      const startedAt = clock?.startedAt || clock?.actions[0]?.at || match.resultEnteredAt;
      const before = startedAt ? new Date(startedAt).getTime() : Date.now();
      for (const side of [1, 2] as const) {
        const athleteId = match[`athlete${side}Id`];
        if (athleteId) cards[side] = eventReviewCardAvailable(athleteId, previousMatches, before);
      }
    }
    return scoreboardReviewState(clock?.actions || [], cards);
  }

  private terminal(match: any, clock: Clock) {
    return match.athlete1Score >= MAX_SCORE || match.athlete2Score >= MAX_SCORE
      || match.athlete1Penalties >= 4 || match.athlete2Penalties >= 4
      || clock.actions.some((action) => !action.undone && ['SUBMISSION', 'MEDICAL_UNFIT'].includes(action.award));
  }

  private outcome(match: any, clock: Clock) {
    const actions = clock.actions.filter((action) => !action.undone);
    const medicalForfeit = [...actions].reverse().find((action) => action.award === 'MEDICAL_UNFIT');
    if (medicalForfeit) return { winnerId: medicalForfeit.side === 1 ? match.athlete2Id : match.athlete1Id, method: 'WALKOVVER', reason: 'Đối thủ không thể tiếp tục theo quyết định y tế/trọng tài' };
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
    const correction = (match.resultData as any)?.scoreboard?.resultCorrection;
    const outcome = match.status === MatchStatus.FINISHED && correction
      ? { winnerId: match.winnerId, method: match.winMethod, reason: `Kết quả đã hiệu chỉnh: ${correction.reason || 'Theo quyết định trọng tài'}` }
      : clock ? this.outcome(match, clock) : null;
    const resultData = (match.resultData || {}) as Record<string, any>;
    const visibleResultData = { ...resultData };
    delete visibleResultData.scoreboardLease;
    return { ...match, resultData: visibleResultData, videoReview: await this.videoReview(this.prisma, match, clock), proposedWinnerId: outcome?.winnerId ?? null, proposedWinMethod: outcome?.method ?? null, outcomeReason: outcome?.reason ?? null, serverNow: new Date().toISOString(), blockedReason };
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
    return this.executeCommand(id, userId, dto);
  }

  private async executeCommand(id: string, userId: string, dto: ScoreboardCommandDto, expiration?: { side: 1 | 2; kind: 'stall' | 'medical' }) {
    await this.prisma.$transaction(async (tx) => {
      // Serialize starts within an event, including different matches on the same FOP.
      const initial = await this.load(tx, id);
      if (!initial) throw new NotFoundException('Không tìm thấy trận đấu');
      if (['START', 'FINISH', 'REVIEW_REQUEST', 'REVIEW_RESOLVE', 'REVIEW_UNDO'].includes(dto.action)) {
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
      if (!expiration && (!dto.clientId || !lease || lease.key !== this.leaseKey(userId, dto.clientId) || Date.parse(lease.expiresAt) <= now.getTime())) {
        throw new ConflictException('Tab này không giữ quyền điều khiển bảng điểm. Tải lại để yêu cầu quyền mới.');
      }
      const clock: Clock = data.scoreboard ? { ...data.scoreboard, actions: [...data.scoreboard.actions] } : {
        remainingMs: (match.category.matchDurationSeconds || 300) * 1000, runningSince: null, actions: [],
      };
      const remaining = Math.max(0, clock.remainingMs - (clock.runningSince ? now.getTime() - Date.parse(clock.runningSince) : 0));
      const stallPauseAt = Math.min(now.getTime(), clock.runningSince ? Date.parse(clock.runningSince) + clock.remainingMs : now.getTime());
      clock.auxiliaryTimers = auxiliaryTimers(clock.auxiliaryTimers);
      const timers = clock.auxiliaryTimers;
      if (expiration) {
        const timer = timers[expiration.side][expiration.kind];
        const mainDeadline = clock.runningSince ? Date.parse(clock.runningSince) + clock.remainingMs : Infinity;
        const timerDeadline = timer.runningSince ? Date.parse(timer.runningSince) + timer.remainingMs : Infinity;
        const shouldCancelStall = expiration.kind === 'stall' && (this.terminal(match, clock) || (remaining === 0 && mainDeadline < timerDeadline));
        if (!timer.active || timer.exhausted || (!shouldCancelStall && auxiliaryRemaining(timer, now.getTime()) > 0)) throw new ConflictException('Timer đã thay đổi');
        if (shouldCancelStall) dto = { ...dto, action: 'STALL_CANCEL' };
        else if (expiration.kind === 'stall') { timer.remainingMs = 0; timer.runningSince = null; timer.active = false; }
      }
      const recordTimerAction = (award: string, side: number): Award => {
        const action = { id: match.resultVersion + 1, side, award, points: 0, remainingMs: remaining, at: now.toISOString(), actor: userId };
        clock.actions.push(action);
        return action;
      };
      const update: Prisma.MatchUncheckedUpdateManyInput = { resultVersion: { increment: 1 } };
      if (dto.action === 'START') {
        if (match.status !== 'SCHEDULED') throw new BadRequestException('Trận đấu đã bắt đầu');
        await this.matches.assertScoreboardReady(tx, match);
        update.status = MatchStatus.RUNNING;
        clock.runningSince = now.toISOString();
        clock.startedAt = now.toISOString();
      } else {
        if (match.status !== 'RUNNING') throw new BadRequestException('Hãy bắt đầu trận đấu trước');
        const review = await this.videoReview(tx, match, clock);
        const medicalSide = activeMedicalSide(timers);
        if (dto.action === 'MEDICAL_UNDO') {
          if (review.pendingSide) throw new BadRequestException('Hãy xử lý xong VR trước khi hoàn tác quyết định y tế');
          let index = clock.actions.length - 1;
          while (index >= 0 && (clock.actions[index].undone || !clock.actions[index].medicalBefore)) index--;
          const action = clock.actions[index];
          if (!action) throw new BadRequestException('Không có quyết định y tế để hoàn tác');
          if (medicalSide && medicalSide !== action.side) throw new BadRequestException('Hãy xử lý xong lượt kiểm tra y tế hiện tại');
          const timer = timers[action.side].medical;
          const currentRemaining = auxiliaryRemaining(timer, now.getTime());
          timers[action.side].medical = { ...action.medicalBefore, remainingMs: Math.min(currentRemaining, action.medicalBefore.remainingMs), runningSince: null };
          clock.actions[index] = { ...action, undone: true };
          clock.remainingMs = remaining; clock.runningSince = null;
          pauseStallingTimers(timers, stallPauseAt);
        } else if (['STALL_START', 'STALL_CANCEL', 'MEDICAL_START', 'MEDICAL_STOP', 'MEDICAL_DECISION', 'MEDICAL_EXPIRE'].includes(dto.action)) {
          if (dto.side !== 1 && dto.side !== 2) throw new BadRequestException('Chọn bên Đỏ hoặc Xanh');
          const timer = timers[dto.side][dto.action.startsWith('STALL') ? 'stall' : 'medical'];
          if (dto.action === 'STALL_START') {
            if (this.terminal(match, clock) || medicalSide || review.pendingSide || !clock.runningSince || remaining === 0) throw new BadRequestException('Chỉ bắt đầu đếm thụ động khi trận đang chạy');
            if (timer.active) throw new BadRequestException('Timer thụ động đã bắt đầu');
            timers[dto.side].stall = { remainingMs: STALLING_TIME_MS, runningSince: now.toISOString(), active: true, actor: userId };
          } else if (dto.action === 'STALL_CANCEL') {
            if (!timer.active) throw new BadRequestException('Không có lượt đếm thụ động đang chạy');
            timer.remainingMs = 0; timer.active = false; timer.runningSince = null;
          } else if (dto.action === 'MEDICAL_START') {
            if (this.terminal(match, clock) || review.pendingSide || (medicalSide && medicalSide !== dto.side)) throw new BadRequestException('Trận đã dừng hoặc đang có kiểm tra khác');
            if (timer.exhausted || auxiliaryRemaining(timer, now.getTime()) === 0) throw new BadRequestException('VĐV đã dùng hết thời gian y tế');
            if (timer.runningSince) throw new BadRequestException('Timer y tế đang chạy');
            timer.active = true; timer.runningSince = now.toISOString(); timer.actor = userId;
            clock.remainingMs = remaining; clock.runningSince = null;
            pauseStallingTimers(timers, stallPauseAt);
          } else if (dto.action === 'MEDICAL_STOP') {
            if (!timer.active || !timer.runningSince) throw new BadRequestException('Timer y tế không chạy');
            timer.remainingMs = auxiliaryRemaining(timer, now.getTime()); timer.runningSince = null;
            timer.exhausted = timer.remainingMs === 0;
          } else if (dto.action === 'MEDICAL_EXPIRE') {
            if (!expiration || expiration.kind !== 'medical') throw new BadRequestException('Thao tác dành cho timer hệ thống');
            timer.remainingMs = 0; timer.runningSince = null; timer.exhausted = true;
          } else {
            if (medicalSide !== dto.side || !['FIT', 'UNFIT'].includes(dto.medicalResult)) throw new BadRequestException('Chọn quyết định y tế cho VĐV đang được kiểm tra');
            timer.remainingMs = auxiliaryRemaining(timer, now.getTime()); timer.runningSince = null; timer.active = false;
            timer.exhausted = timer.remainingMs === 0;
          }
          const action = recordTimerAction(dto.action === 'MEDICAL_DECISION' ? dto.medicalResult === 'FIT' ? 'MEDICAL_FIT' : 'MEDICAL_UNFIT' : dto.action === 'MEDICAL_EXPIRE' ? 'MEDICAL_EXHAUSTED' : dto.action, dto.side);
          if (dto.action === 'MEDICAL_DECISION') action.medicalBefore = { ...timer, active: true, runningSince: null };
        } else if (dto.action === 'REVIEW_REQUEST' || dto.action === 'REVIEW_RESOLVE') {
          if (medicalSide) throw new BadRequestException('Hãy xử lý xong kiểm tra y tế trước khi dùng VR');
          if (dto.side !== 1 && dto.side !== 2) throw new BadRequestException('Chọn bên Đỏ hoặc Xanh');
          if (dto.action === 'REVIEW_REQUEST') {
            if (review.pendingSide) throw new BadRequestException('Đang xem lại một khiếu nại VR');
            if (!review.cards[dto.side]) throw new BadRequestException('VĐV bên này đã mất quyền khiếu nại trong giải; quyền được cấp lại ở trận tranh HCV/HCĐ');
            clock.actions.push({ id: match.resultVersion + 1, side: dto.side, award: 'REVIEW_REQUEST', points: 0, remainingMs: remaining, at: now.toISOString(), actor: userId });
          } else {
            if (review.pendingSide !== dto.side) throw new BadRequestException('Không có khiếu nại VR đang chờ của bên này');
            if (!['ACCEPTED', 'REJECTED'].includes(dto.reviewResult)) throw new BadRequestException('Chọn kết quả khiếu nại đúng hoặc sai');
            clock.actions.push({ id: match.resultVersion + 1, side: dto.side, award: dto.reviewResult === 'ACCEPTED' ? 'REVIEW_ACCEPTED' : 'REVIEW_REJECTED', points: 0, remainingMs: remaining, at: now.toISOString(), actor: userId });
          }
          clock.remainingMs = remaining;
          clock.runningSince = null;
          pauseStallingTimers(timers, stallPauseAt);
        } else if (dto.action === 'REVIEW_UNDO') {
          if (medicalSide) throw new BadRequestException('Hãy xử lý xong kiểm tra y tế trước khi hoàn tác VR');
          let index = clock.actions.length - 1;
          while (index >= 0 && (clock.actions[index].undone || !SCOREBOARD_REVIEW_AWARDS.includes(clock.actions[index].award))) index--;
          if (index < 0) throw new BadRequestException('Không có thao tác VR để hoàn tác');
          clock.actions[index] = { ...clock.actions[index], undone: true };
          clock.remainingMs = remaining;
          clock.runningSince = null;
          pauseStallingTimers(timers, stallPauseAt);
        } else if (dto.action === 'RESUME') {
          if (medicalSide) throw new BadRequestException('Chờ quyết định bác sĩ/trọng tài trước khi tiếp tục');
          if (review.pendingSide) throw new BadRequestException('Hãy xử lý xong khiếu nại VR trước khi chạy đồng hồ');
          if (this.terminal(match, clock)) {
            throw new BadRequestException('Trận đã có người thắng bằng submission, truất quyền hoặc đạt 50 điểm; hãy hoàn tác nếu cần sửa');
          }
          if (clock.runningSince || remaining === 0) throw new BadRequestException('Đồng hồ đang chạy hoặc đã hết giờ');
          clock.runningSince = now.toISOString();
          for (const side of [1, 2] as const) if (timers[side].stall.active && timers[side].stall.remainingMs > 0) timers[side].stall.runningSince = now.toISOString();
        } else if (dto.action === 'PAUSE') {
          clock.remainingMs = remaining;
          clock.runningSince = null;
          pauseStallingTimers(timers, stallPauseAt);
        } else if (dto.action === 'AWARD' || dto.action === 'UNDO') {
          let award: Award;
          let direction = 1;
          if (dto.action === 'UNDO') {
            let index = clock.actions.length - 1;
            while (index >= 0 && (clock.actions[index].undone || SCOREBOARD_REVIEW_AWARDS.includes(clock.actions[index].award) || AUXILIARY_TIMER_AWARDS.includes(clock.actions[index].award))) index--;
            if (index < 0) throw new BadRequestException('Không có thao tác để hoàn tác');
            award = { ...clock.actions[index], undone: true };
            clock.actions[index] = award;
            direction = -1;
          } else {
            if (medicalSide && !expiration) throw new BadRequestException('Không chấm điểm khi đang kiểm tra y tế');
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
              if (!expiration) {
                timers[dto.side].stall.remainingMs = 0;
                timers[dto.side].stall.active = false; timers[dto.side].stall.runningSince = null;
              }
              const opponentSide = dto.side === 1 ? 2 : 1;
              if (penaltyLevel === 2) award.opponentAward = { side: opponentSide, award: 'ADVANTAGE', points: 1 };
              if (penaltyLevel === 3) award.opponentAward = { side: opponentSide, award: 'POINTS', points: 2 };
            }
            clock.actions.push(award);
            if (expiration?.kind === 'stall') award.source = 'STALLING_TIMER';
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
            pauseStallingTimers(timers, stallPauseAt);
          }
        } else if (dto.action === 'FINISH') {
          if (medicalSide) throw new BadRequestException('Chờ quyết định y tế trước khi xác nhận kết quả');
          if (review.pendingSide) throw new BadRequestException('Hãy xử lý xong khiếu nại VR trước khi xác nhận kết quả');
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
      if (this.terminal({ ...match, ...update }, clock) || dto.action === 'FINISH') {
        clock.remainingMs = remaining; clock.runningSince = null;
        pauseStallingTimers(timers, stallPauseAt);
        for (const side of [1, 2] as const) { timers[side].stall.active = false; timers[side].stall.remainingMs = 0; }
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
