import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MatchStatus, Prisma, ResultStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MatchesService } from '../matches/matches.service';
import { EnterResultDto } from './dto/result-workflow.dto';

const RESULT_SELECT = {
  id: true,
  eventId: true,
  categoryId: true,
  drawId: true,
  round: true,
  matchNumber: true,
  athlete1Id: true,
  athlete2Id: true,
  team1Id: true,
  team2Id: true,
  winnerId: true,
  winnerTeamId: true,
  athlete1Score: true,
  athlete2Score: true,
  athlete1Advantages: true,
  athlete2Advantages: true,
  athlete1Penalties: true,
  athlete2Penalties: true,
  winMethod: true,
  resultData: true,
  resultStatus: true,
  resultVersion: true,
  status: true,
  resultEnteredAt: true,
  resultEnteredBy: true,
  refereeConfirmedAt: true,
  approvedAt: true,
  resultPublishedAt: true,
  resultLockedAt: true,
  winnerToMatchId: true,
  winnerToSide: true,
  loserToMatchId: true,
  loserToSide: true,
  participants: {
    select: { id: true, athleteId: true, teamId: true, score: true, rank: true, qualified: true },
  },
} satisfies Prisma.MatchSelect;

class ResultCorrectionPreview extends Error {
  constructor(readonly preview: Record<string, unknown>) { super('Result correction preview'); }
}

const RESULT_STATUS_LABELS: Record<ResultStatus, string> = {
  DRAFT: 'Bản nháp',
  ENTERED: 'Đã nhập kết quả',
  REFEREE_CONFIRMED: 'Trọng tài đã xác nhận',
  APPROVED: 'Đã phê duyệt',
  PUBLISHED: 'Đã công bố',
  LOCKED: 'Đã khóa kết quả',
};

const RESULT_ACTION_LABELS: Record<string, string> = {
  REFEREE_CONFIRM: 'trọng tài xác nhận',
  APPROVE_RESULT: 'phê duyệt',
  PUBLISH_RESULT: 'công bố',
  LOCK_RESULT: 'khóa kết quả',
};

@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matches: MatchesService,
  ) {}

  async get(matchId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        ...RESULT_SELECT,
        resultRevisions: { orderBy: { version: 'desc' as const }, take: 50 },
      },
    });
    if (!match) throw new NotFoundException('Không tìm thấy trận đấu');
    return match;
  }

  async enter(matchId: string, userId: string, dto: EnterResultDto) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockResult(transaction, matchId);
        return this.enterInTransaction(transaction, matchId, userId, dto);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
    } catch (error) { this.rethrowCorrectionConflict(error); }
  }

  async previewCorrection(matchId: string, userId: string, dto: EnterResultDto) {
    try {
      await this.prisma.$transaction(async (transaction) => {
        await this.lockResult(transaction, matchId);
        const before = await this.loadMatch(transaction, matchId);
        const original = await this.progressionSnapshot(transaction, before.eventId);
        const token = this.correctionToken(before, dto, original);
        await this.enterInTransaction(transaction, matchId, userId, { ...dto, progressionToken: undefined });
        const after = await this.progressionSnapshot(transaction, before.eventId);
        const sourceById = new Map(original.map((match) => [match.id, match]));
        const changes = after.filter((match) => match.id !== matchId
          && this.pairState(match) !== this.pairState(sourceById.get(match.id))).map((match) => ({
          id: match.id, matchNumber: match.matchNumber, categoryName: match.category.name,
          before: sourceById.get(match.id), after: match,
        }));
        // Use the actual propagation/constraints, then roll every write back.
        throw new ResultCorrectionPreview({ token, changes, sourceVersion: before.resultVersion });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
    } catch (error) {
      if (error instanceof ResultCorrectionPreview) return error.preview;
      this.rethrowCorrectionConflict(error);
    }
  }

  private async lockResult(transaction: Prisma.TransactionClient, matchId: string) {
    const match = await this.loadMatch(transaction, matchId);
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${match.eventId}))`;
    await transaction.$queryRaw`SELECT id FROM "Match" WHERE id = ${matchId} FOR UPDATE`;
  }

  private progressionSnapshot(transaction: Prisma.TransactionClient, eventId: string) {
    return transaction.match.findMany({ where: { eventId }, orderBy: { id: 'asc' }, select: {
      id: true, eventId: true, matchNumber: true, status: true, resultStatus: true, resultVersion: true,
      athlete1Id: true, athlete2Id: true, team1Id: true, team2Id: true, winnerId: true, winnerTeamId: true,
      winMethod: true, resultEnteredAt: true, notes: true, winnerToMatchId: true, winnerToSide: true,
      loserToMatchId: true, loserToSide: true, category: { select: { name: true } },
      athlete1: { select: { fullName: true } }, athlete2: { select: { fullName: true } },
      team1: { select: { name: true } }, team2: { select: { name: true } },
    } });
  }

  private pairState(match: Record<string, any> | undefined) {
    return JSON.stringify(match && [match.athlete1Id, match.athlete2Id, match.team1Id, match.team2Id,
      match.status, match.resultStatus, match.winnerId, match.winnerTeamId]);
  }

  private correctionToken(source: Record<string, any>, dto: EnterResultDto, graph: Record<string, any>[]) {
    const related = new Set<string>([source.id]);
    const routesChange = source.status !== MatchStatus.FINISHED || source.winnerId !== (dto.winnerId || null) || source.winnerTeamId !== (dto.winnerTeamId || null);
    let changed = routesChange;
    while (changed) {
      changed = false;
      for (const match of graph) {
        if (!related.has(match.id)) continue;
        for (const id of [match.winnerToMatchId, match.loserToMatchId]) {
          if (id && !related.has(id)) { related.add(id); changed = true; }
        }
      }
    }
    const records = graph.filter((match) => related.has(match.id)
      || routesChange && (related.has(match.winnerToMatchId) || related.has(match.loserToMatchId))).map((match) => [
      match.id, match.resultVersion, this.pairState(match), match.winnerToMatchId, match.winnerToSide,
      match.loserToMatchId, match.loserToSide, match.resultEnteredAt, match.notes?.startsWith('Generated '),
    ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return createHash('sha256').update(JSON.stringify({ records, sourceVersion: source.resultVersion,
      result: [dto.athlete1Score, dto.athlete2Score, dto.athlete1Advantages, dto.athlete2Advantages,
        dto.athlete1Penalties, dto.athlete2Penalties, dto.winnerId, dto.winnerTeamId, dto.winMethod,
        dto.reason?.trim(), dto.participantResults, dto.resultData],
    })).digest('hex');
  }

  private rethrowCorrectionConflict(error: any): never {
    if (error?.code === 'P2034' || error?.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))) {
      throw new ConflictException('Kết quả hoặc cặp đấu vừa thay đổi. Hãy tải lại và tính lại cặp đấu trước khi lưu.');
    }
    throw error;
  }

  private async enterInTransaction(transaction: Prisma.TransactionClient, matchId: string, userId: string, dto: EnterResultDto) {
    const before = await this.loadMatch(transaction, matchId);
    if (before.status === MatchStatus.RUNNING && (before.resultData as any)?.scoreboard) throw new BadRequestException('Xác nhận trận đang thi đấu qua bảng điểm');
    await this.matches.assertRepechageReady(transaction, before as any);
    this.assertExpectedVersion(before.resultVersion, dto.expectedVersion);
    if (before.resultStatus === ResultStatus.LOCKED) throw new BadRequestException('Kết quả đã khóa và không thể chỉnh sửa');
    if (before.resultStatus === ResultStatus.APPROVED || before.resultStatus === ResultStatus.PUBLISHED) {
      throw new BadRequestException('Phải mở lại kết quả đã phê duyệt hoặc công bố trước khi chỉnh sửa');
    }
    if (before.resultVersion > 0 && !dto.reason?.trim()) {
      throw new BadRequestException('Bắt buộc nhập lý do khi hiệu chỉnh kết quả đã có');
    }

    const validAthletes = new Set([
      before.athlete1Id,
      before.athlete2Id,
      ...before.participants.map((participant) => participant.athleteId),
    ].filter(Boolean));
    const validTeams = new Set([
      before.team1Id,
      before.team2Id,
      ...before.participants.map((participant) => participant.teamId),
    ].filter(Boolean));
    if (dto.winnerId && !validAthletes.has(dto.winnerId)) {
      throw new BadRequestException('Vận động viên thắng không thuộc trận đấu này');
    }
    if (dto.winnerTeamId && !validTeams.has(dto.winnerTeamId)) {
      throw new BadRequestException('Đội thắng không thuộc trận đấu này');
    }
    if (dto.participantResults?.length) {
      const participantIds = new Set(before.participants.map(({ id }) => id));
      if (dto.participantResults.some(({ matchParticipantId }) => !participantIds.has(matchParticipantId))) {
        throw new BadRequestException('Có kết quả của người tham dự không thuộc trận đấu này');
      }
    }

    if (dto.progressionToken) {
      const graph = await this.progressionSnapshot(transaction, before.eventId);
      if (dto.progressionToken !== this.correctionToken(before, dto, graph)) {
        throw new ConflictException('Cặp đấu đã thay đổi sau khi tính lại. Hãy tính lại cặp đấu trước khi lưu.');
      }
    }
    if ((before.resultData as any)?.scoreboard) {
      if ((dto.winMethod || before.winMethod) === 'POINTS') {
        const differences = [
          (dto.athlete1Score ?? before.athlete1Score) - (dto.athlete2Score ?? before.athlete2Score),
          (dto.athlete1Advantages ?? before.athlete1Advantages) - (dto.athlete2Advantages ?? before.athlete2Advantages),
          (dto.athlete2Penalties ?? before.athlete2Penalties) - (dto.athlete1Penalties ?? before.athlete1Penalties),
        ];
        const difference = differences.find((value) => value !== 0);
        if (difference === undefined) throw new BadRequestException('Điểm, lợi thế và phạt bằng nhau. Chọn Quyết định trọng tài.');
        const winnerId = difference > 0 ? before.athlete1Id : before.athlete2Id;
        if (dto.winnerId !== winnerId) throw new BadRequestException('Người thắng không khớp điểm, lợi thế và phạt. Kiểm tra lại kết quả rồi tính lại cặp đấu.');
      }
      for (const value of [dto.athlete1Score, dto.athlete2Score]) {
        if (value !== undefined && (value < 0 || value > 50)) throw new BadRequestException('Điểm bảng điểm phải trong khoảng 0–50');
      }
      for (const value of [dto.athlete1Penalties, dto.athlete2Penalties]) {
        if (value !== undefined && value > 4) throw new BadRequestException('Số lần phạt tối đa là 4');
      }
      if ((dto.winMethod || before.winMethod) === 'SUBMISSION' && dto.winnerId) {
        const winnerScore = dto.winnerId === before.athlete1Id ? dto.athlete1Score ?? before.athlete1Score : dto.athlete2Score ?? before.athlete2Score;
        if (winnerScore !== 50) throw new BadRequestException('Người thắng bằng submission phải có 50 điểm. Kiểm tra lại điểm và phương thức thắng.');
      }
    }
    const existingData = before.resultData as Record<string, any> | null;
    const resultData = existingData?.scoreboard ? { ...existingData, ...dto.resultData,
      scoreboard: { ...existingData.scoreboard, resultCorrection: { winnerId: dto.winnerId || null,
        winMethod: dto.winMethod || before.winMethod, reason: dto.reason?.trim(), actor: userId,
        version: before.resultVersion + 1, at: new Date().toISOString() } },
    } : dto.resultData;
    for (const result of dto.participantResults || []) {
      await transaction.matchParticipant.update({
        where: { id: result.matchParticipantId },
        data: {
          score: result.score as Prisma.InputJsonValue | undefined,
          rank: result.rank,
          qualified: result.qualified,
        },
      });
    }
    const writeResult = await transaction.match.updateMany({
      where: { id: matchId, resultVersion: before.resultVersion },
      data: {
        athlete1Score: dto.athlete1Score,
        athlete2Score: dto.athlete2Score,
        athlete1Advantages: dto.athlete1Advantages,
        athlete2Advantages: dto.athlete2Advantages,
        athlete1Penalties: dto.athlete1Penalties,
        athlete2Penalties: dto.athlete2Penalties,
        winnerId: dto.winnerId || null,
        winnerTeamId: dto.winnerTeamId || null,
        winMethod: dto.winMethod,
        resultData: resultData as Prisma.InputJsonValue | undefined,
        resultStatus: ResultStatus.ENTERED,
        resultVersion: { increment: 1 },
        resultEnteredAt: new Date(),
        resultEnteredBy: userId,
        status: MatchStatus.FINISHED,
        refereeConfirmedAt: null,
        refereeConfirmedBy: null,
        approvedAt: null,
        approvedBy: null,
        resultPublishedAt: null,
        resultPublishedBy: null,
        resultLockedAt: null,
        resultLockedBy: null,
      },
    });
    if (writeResult.count !== 1) this.throwConcurrentUpdate();
    const updated = await this.loadMatch(transaction, matchId);
    await this.matches.syncProgression(transaction, before as any, updated as any);
    await this.revise(transaction, before, updated, 'ENTER_RESULT', userId, dto.reason);
    return updated;
  }

  confirm(matchId: string, userId: string, expectedVersion: number, reason?: string) {
    return this.transition(
      matchId,
      userId,
      ResultStatus.ENTERED,
      ResultStatus.REFEREE_CONFIRMED,
      'REFEREE_CONFIRM',
      expectedVersion,
      reason,
      { refereeConfirmedAt: new Date(), refereeConfirmedBy: userId },
    );
  }

  approve(matchId: string, userId: string, expectedVersion: number, reason?: string) {
    return this.transition(
      matchId,
      userId,
      ResultStatus.REFEREE_CONFIRMED,
      ResultStatus.APPROVED,
      'APPROVE_RESULT',
      expectedVersion,
      reason,
      { approvedAt: new Date(), approvedBy: userId },
    );
  }

  publish(matchId: string, userId: string, expectedVersion: number, reason?: string) {
    return this.transition(
      matchId,
      userId,
      ResultStatus.APPROVED,
      ResultStatus.PUBLISHED,
      'PUBLISH_RESULT',
      expectedVersion,
      reason,
      { resultPublishedAt: new Date(), resultPublishedBy: userId },
    );
  }

  lock(matchId: string, userId: string, expectedVersion: number, reason?: string) {
    return this.transition(
      matchId,
      userId,
      ResultStatus.PUBLISHED,
      ResultStatus.LOCKED,
      'LOCK_RESULT',
      expectedVersion,
      reason,
      { resultLockedAt: new Date(), resultLockedBy: userId },
    );
  }

  async reopen(matchId: string, userId: string, expectedVersion: number, reason?: string) {
    if (!reason?.trim()) throw new BadRequestException('Bắt buộc nhập lý do mở lại kết quả');
    return this.prisma.$transaction(async (transaction) => {
      const before = await this.loadMatch(transaction, matchId);
      this.assertExpectedVersion(before.resultVersion, expectedVersion);
      if (!(
        before.resultStatus === ResultStatus.REFEREE_CONFIRMED
        || before.resultStatus === ResultStatus.APPROVED
        || before.resultStatus === ResultStatus.PUBLISHED
        || before.resultStatus === ResultStatus.LOCKED
      )) {
        throw new BadRequestException('Chỉ có thể mở lại kết quả đã xác nhận, phê duyệt, công bố hoặc khóa');
      }
      const writeResult = await transaction.match.updateMany({
        where: { id: matchId, resultVersion: before.resultVersion },
        data: {
          resultStatus: ResultStatus.ENTERED,
          resultVersion: { increment: 1 },
          refereeConfirmedAt: null,
          refereeConfirmedBy: null,
          approvedAt: null,
          approvedBy: null,
          resultPublishedAt: null,
          resultPublishedBy: null,
          resultLockedAt: null,
          resultLockedBy: null,
        },
      });
      if (writeResult.count !== 1) this.throwConcurrentUpdate();
      const updated = await this.loadMatch(transaction, matchId);
      await this.revise(transaction, before, updated, 'REOPEN_RESULT', userId, reason);
      return updated;
    });
  }

  private async transition(
    matchId: string,
    userId: string,
    expected: ResultStatus,
    next: ResultStatus,
    action: string,
    expectedVersion: number,
    reason: string | undefined,
    data: Prisma.MatchUpdateManyMutationInput,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const before = await this.loadMatch(transaction, matchId);
      this.assertExpectedVersion(before.resultVersion, expectedVersion);
      if (before.resultStatus !== expected) {
      throw new BadRequestException(
        `Kết quả phải ở trạng thái “${RESULT_STATUS_LABELS[expected]}” trước khi ${RESULT_ACTION_LABELS[action] || 'thực hiện thao tác này'}`,
      );
      }
      const writeResult = await transaction.match.updateMany({
        where: {
          id: matchId,
          resultStatus: expected,
          resultVersion: before.resultVersion,
        },
        data: { ...data, resultStatus: next, resultVersion: { increment: 1 } },
      });
      if (writeResult.count !== 1) this.throwConcurrentUpdate();
      const updated = await this.loadMatch(transaction, matchId);
      await this.revise(transaction, before, updated, action, userId, reason);
      return updated;
    });
  }

  private async loadMatch(transaction: Prisma.TransactionClient, matchId: string) {
    const match = await transaction.match.findUnique({ where: { id: matchId }, select: RESULT_SELECT });
    if (!match) throw new NotFoundException('Không tìm thấy trận đấu');
    return match;
  }

  private revise(
    transaction: Prisma.TransactionClient,
    before: Record<string, any>,
    after: Record<string, any>,
    action: string,
    actorUserId: string,
    reason?: string,
  ) {
    return transaction.resultRevision.create({
      data: {
        matchId: after.id,
        version: after.resultVersion,
        status: after.resultStatus,
        action,
        before: this.snapshot(before),
        after: this.snapshot(after),
        actorUserId,
        reason: reason?.trim(),
      },
    });
  }

  private snapshot(match: Record<string, any>): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(match)) as Prisma.InputJsonValue;
  }

  private assertExpectedVersion(currentVersion: number, expectedVersion: number) {
    if (currentVersion !== expectedVersion) this.throwConcurrentUpdate();
  }

  private throwConcurrentUpdate(): never {
    throw new ConflictException(
      'Kết quả đã được người khác cập nhật. Hãy tải lại phiên bản mới trước khi thao tác.',
    );
  }
}
