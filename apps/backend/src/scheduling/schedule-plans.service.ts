import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApplyScheduleDto, DeleteScheduleDraftDto, PreviewScheduleDto, SaveScheduleDraftDto } from './dto/schedule-plan.dto';
import { assertScheduleConfig, eventDays, localDay, ScheduleConfig } from './planner/schedule-config';
import { categoryWeight, contentGroupKey, isAutomaticScheduleBye } from './planner/main-tree';
import { liveScheduleViolations, previewSnapshot, ScheduleSnapshot, semanticStages } from './planner/snapshot-planner';

function hash(value: unknown): string {
  const canonical = (item: any): any => item instanceof Date ? item.toISOString() : Array.isArray(item)
    ? item.map(canonical) : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])])) : item;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

function hasScheduleDraft(plan: any, applied: any, previewVersion?: number): boolean {
  return !applied || hash(plan.draft) !== hash(applied.config) || (previewVersion ?? -1) > applied.draftVersion;
}

@Injectable()
export class SchedulePlansService {
  constructor(private readonly prisma: PrismaService) {}

  private validate(config: unknown, complete: boolean) {
    try { assertScheduleConfig(config, complete); }
    catch (error: any) { throw new BadRequestException(error.message); }
  }

  private async transaction<T>(eventId: string, work: (db: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await this.prisma.$transaction(async (db) => {
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${eventId}))`;
        const exists = await db.$queryRaw<any[]>`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
        if (!exists.length) throw new NotFoundException('Không tìm thấy sự kiện.');
        return work(db);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 });
    } catch (error: any) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (['P2034', 'P2002'].includes(error.code)
        || error.code === 'P2010' && ['40001', '40P01', '23P01'].includes(String(error.meta?.code)))) {
        throw new ConflictException({ code: 'STALE_PREVIEW', message: 'Dữ liệu lịch vừa thay đổi. Giữ bản nháp và tính lại lịch.' });
      }
      throw error;
    }
  }

  private async plan(db: Prisma.TransactionClient | PrismaService, eventId: string, id: string) {
    const plan = await db.matchSchedulePlan.findFirst({ where: { id, eventId } });
    if (!plan) throw new NotFoundException('Không tìm thấy lịch trong sự kiện.');
    return plan;
  }

  private async snapshot(db: Prisma.TransactionClient | PrismaService, eventId: string): Promise<ScheduleSnapshot> {
    const event = await db.event.findUnique({ where: { id: eventId }, select: {
      id: true, name: true, startDate: true, endDate: true, updatedAt: true,
      categories: { include: { sport: { select: { name: true } } }, orderBy: { id: 'asc' } },
      fops: { include: { venue: true }, orderBy: { id: 'asc' } },
    } });
    if (!event) throw new NotFoundException('Không tìm thấy sự kiện.');
    const [matches, draws, teams, entries, rules, slots, owners, plans, heats, groups] = await Promise.all([
      db.match.findMany({ where: { eventId }, orderBy: { id: 'asc' }, include: {
        athlete1: { select: { fullName: true } }, athlete2: { select: { fullName: true } },
        team1: { select: { name: true } }, team2: { select: { name: true } },
        participants: { orderBy: { id: 'asc' } }, _count: { select: { resultRevisions: true } },
      } }),
      db.draw.findMany({ where: { eventId }, orderBy: { id: 'asc' } }),
      db.team.findMany({ where: { eventId }, include: { members: { include: { athlete: { select: { fullName: true } } }, orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } }),
      db.competitionEntry.findMany({ where: { eventId }, include: { athlete: { select: { fullName: true } } }, orderBy: { id: 'asc' } }),
      db.sportSchedulingRule.findMany({ where: { eventId }, orderBy: { id: 'asc' } }),
      db.timeSlot.findMany({ where: { session: { eventId } }, include: { session: true, match: { select: { id: true } } }, orderBy: { id: 'asc' } }),
      db.matchScheduleCategory.findMany({ where: { eventId }, orderBy: { id: 'asc' } }),
      db.matchSchedulePlan.findMany({ where: { eventId }, select: { id: true, appliedRevisionId: true }, orderBy: { id: 'asc' } }),
      db.heat.findMany({ where: { eventId }, include: { lanes: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } }),
      db.roundRobinGroup.findMany({ where: { eventId }, include: { members: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } }),
    ]);
    const applied = await db.matchScheduleRevision.findMany({ where: { id: { in: plans.map((plan) => plan.appliedRevisionId).filter(Boolean) } },
      include: { items: { orderBy: { chainSequence: 'asc' } } } });
    return { event, matches, draws, teams, entries, rules, slots, owners, heats, groups,
      plans: plans.filter((plan) => plan.appliedRevisionId).map((plan) => ({ ...plan, applied: applied.find((revision) => revision.id === plan.appliedRevisionId) })) };
  }

  async plannerInput(eventId: string) {
    const data = await this.snapshot(this.prisma, eventId);
    const drafts = await this.prisma.matchSchedulePlan.findMany({ where: { eventId }, select: { id: true, name: true, draft: true } });
    const timezone = data.event.fops[0]?.venue?.timezone || 'Asia/Ho_Chi_Minh';
    return { eventId, timezone, days: eventDays(data.event.startDate, data.event.endDate, timezone),
      fops: [...data.event.fops].sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true })).map((fop) => ({ id: fop.id, name: fop.name, timezone: fop.venue?.timezone || 'Asia/Ho_Chi_Minh' })),
      rules: data.rules, categories: data.event.categories.map((category) => {
        let unsupported: string | null = null;
        let stages: ReturnType<typeof semanticStages> = new Map();
        try {
          categoryWeight(category);
          stages = semanticStages(data, category.id);
          if (['DUO', 'SHOW'].includes(category.discipline)) {
            const entries = data.entries.filter((entry) => entry.categoryId === category.id);
            if (!entries.length || entries.some((entry) => entry.type !== 'TEAM' || !data.teams.some((team) => team.id === entry.teamId && team.members.length))) {
              unsupported = 'Cần entry đội và danh sách thành viên thật cho Duo/Show.';
            }
          }
        } catch (error: any) { unsupported = error.message; }
        const matches = data.matches.filter((match) => match.categoryId === category.id && !isAutomaticScheduleBye(match));
        return { ...category, groupKey: contentGroupKey(category), unsupported,
          owner: data.owners.find((owner) => owner.categoryId === category.id)?.planId,
          draftPlans: drafts.filter((plan) => (plan.draft as unknown as ScheduleConfig).blocks.some((block) => block.categoryIds.includes(category.id)))
            .map((plan) => ({ id: plan.id, name: plan.name })),
          entryCount: data.entries.filter((entry) => entry.categoryId === category.id && ['REGISTERED', 'VERIFIED'].includes(entry.status)).length,
          entryUnit: data.entries.some((entry) => entry.categoryId === category.id && entry.type !== 'INDIVIDUAL') ? 'đội' : 'VĐV',
          matchCount: matches.length, stages: [...new Map([...stages.entries()].map(([id, stage]) => [stage.stageKey,
            { ...stage, round: data.matches.find((match) => match.id === id)?.round }])).values()].sort((a, b) => a.stageOrder - b.stageOrder),
        };
      }) };
  }

  async overview(eventId: string) {
    const snapshot = await this.snapshot(this.prisma, eventId);
    const drafts = await this.prisma.matchSchedulePlan.findMany({ where: { eventId }, orderBy: { updatedAt: 'desc' },
      include: { revisions: { orderBy: { draftVersion: 'desc' }, take: 1, select: { proposal: true, draftVersion: true } } } });
    const timezone = snapshot.event.fops[0]?.venue?.timezone || 'Asia/Ho_Chi_Minh';
    const segments: any[] = [];
    for (const plan of snapshot.plans) {
      const config = plan.applied.config as ScheduleConfig;
      const groups = new Map<string, any[]>();
      for (const item of plan.applied.items) {
        const key = `${item.localDate}:${item.fopId}`;
        groups.set(key, [...(groups.get(key) || []), item]);
      }
      const first = plan.applied.items[0]?.chainSequence;
      for (const items of groups.values()) segments.push({ planId: plan.id, name: config.name,
        localDate: items[0].localDate, fopId: items[0].fopId, count: items.length,
        start: Math.min(...items.map((item) => +new Date(item.startTime))), end: Math.max(...items.map((item) => +new Date(item.endTime))),
        continuation: Math.min(...items.map((item) => item.chainSequence)) !== first,
        intervals: items.map((item) => ({ start: +new Date(item.startTime), end: +new Date(item.endTime) + item.turnaroundSeconds * 1000 })),
        contents: config.blocks.flatMap((block) => block.categoryIds).map((id) => snapshot.event.categories.find((category) => category.id === id)?.name),
        hasDraft: hasScheduleDraft(drafts.find((draft) => draft.id === plan.id), plan.applied,
          drafts.find((draft) => draft.id === plan.id)?.revisions[0]?.draftVersion) });
    }
    const legacy = snapshot.matches.filter((match) => !match.schedulePlanId && match.startTime && match.status !== 'CANCELLED' && !isAutomaticScheduleBye(match));
    for (const match of legacy) segments.push({ legacy: true, planId: null, matchId: match.id,
      name: `Lịch hiện có · Trận #${match.matchNumber || match.id}`, localDate: localDay(match.startTime, timezone),
      fopId: match.fopId, count: 1, start: +new Date(match.startTime), end: match.endTime ? +new Date(match.endTime) : null,
      intervals: match.endTime ? [{ start: +new Date(match.startTime), end: +new Date(match.endTime) }] : [] });
    const actors = await this.prisma.user.findMany({ where: { id: { in: drafts.map((plan) => plan.updatedBy) } }, select: { id: true, name: true } });
    return { eventId, timezone, days: eventDays(snapshot.event.startDate, snapshot.event.endDate, timezone),
      fops: [...snapshot.event.fops].sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true })).map((fop) => ({ id: fop.id, name: fop.name })), segments,
      drafts: drafts.filter((draft) => hasScheduleDraft(draft, snapshot.plans.find((plan) => plan.id === draft.id)?.applied, draft.revisions[0]?.draftVersion))
        .map((draft) => ({ id: draft.id, name: draft.name, updatedAt: draft.updatedAt, updatedBy: actors.find((actor) => actor.id === draft.updatedBy)?.name || draft.updatedBy,
          errorCount: draft.revisions[0]?.draftVersion === draft.draftVersion ? ((draft.revisions[0]?.proposal as any)?.violations || []).filter((item) => item.severity === 'ERROR').length : null,
          appliedRevisionId: draft.appliedRevisionId, draftVersion: draft.draftVersion })) };
  }

  async detail(eventId: string, planId: string) {
    const plan = await this.plan(this.prisma, eventId, planId);
    const applied = plan.appliedRevisionId ? await this.prisma.matchScheduleRevision.findUnique({ where: { id: plan.appliedRevisionId } }) : null;
    const pending = applied ? await this.prisma.matchScheduleRevision.findFirst({ where: { planId, appliedAt: null },
      orderBy: { draftVersion: 'desc' }, select: { draftVersion: true } }) : null;
    const snapshot = applied ? await this.snapshot(this.prisma, eventId) : null;
    const live = snapshot?.matches || [];
    const proposal = applied?.proposal as any;
    return { ...plan, applied: applied ? { ...applied, proposal: { ...proposal,
      violations: [...proposal.violations.filter((item) => item.code !== 'POTENTIAL_PARTICIPANT_CONFLICT'), ...liveScheduleViolations(snapshot!, planId, Date.now())],
      warningsRequiringAcknowledgement: (proposal.warningsRequiringAcknowledgement || []).filter((item) => item.code !== 'POTENTIAL_PARTICIPANT_CONFLICT'),
      matchDetails: proposal.matchDetails.map((detail) => { const match = live.find((match) => match.id === detail.id); return match ? { ...detail,
        round: match.round, status: match.status, immutable: match.scheduleLocked || ['RUNNING', 'FINISHED'].includes(match.status)
          || snapshot!.slots.some((slot) => slot.match?.id === match.id && (slot.isLocked || slot.session.status === 'LOCKED')),
        canScore: ['SCHEDULED', 'RUNNING'].includes(match.status) && Boolean(match.athlete1Id && match.athlete2Id),
        participants: [match.athlete1?.fullName || match.team1?.name, match.athlete2?.fullName || match.team2?.name].filter(Boolean),
      } : detail; }),
    } } : null, hasDraft: hasScheduleDraft(plan, applied, pending?.draftVersion) };
  }

  async create(eventId: string, actorId: string, dto: SaveScheduleDraftDto) {
    this.validate(dto.config, false);
    if (!dto.idempotencyKey?.trim()) throw new BadRequestException('Cần mã yêu cầu để tạo bản nháp.');
    return this.transaction(eventId, async (db) => {
      const existing = await db.matchSchedulePlan.findUnique({ where: { eventId_createKey: { eventId, createKey: dto.idempotencyKey } } });
      if (existing) {
        const log = await db.auditLog.findFirst({ where: { entityId: existing.id, action: 'CREATE_SCHEDULE_PLAN' } });
        if ((log?.metadata as any)?.configHash !== hash(dto.config)) throw new ConflictException('Mã yêu cầu đã dùng với cấu hình khác.');
        return existing;
      }
      const plan = await db.matchSchedulePlan.create({ data: { eventId, name: dto.config.name, timezone: dto.config.timezone,
        draft: json(dto.config), createKey: dto.idempotencyKey, createdBy: actorId, updatedBy: actorId } });
      await db.auditLog.create({ data: { actorUserId: actorId, action: 'CREATE_SCHEDULE_PLAN', entityType: 'MatchSchedulePlan', entityId: plan.id,
        metadata: { eventId, configHash: hash(dto.config) } } });
      return plan;
    });
  }

  async save(eventId: string, planId: string, actorId: string, dto: SaveScheduleDraftDto) {
    this.validate(dto.config, false);
    return this.transaction(eventId, async (db) => {
      const plan = await this.plan(db, eventId, planId);
      if (plan.draftVersion !== dto.expectedDraftVersion) throw new ConflictException({ code: 'DRAFT_VERSION_CONFLICT', message: 'Bản nháp đã được người khác sửa. Hãy mở lại lịch.' });
      return db.matchSchedulePlan.update({ where: { id: planId }, data: { draft: json(dto.config), name: dto.config.name,
        timezone: dto.config.timezone, draftVersion: { increment: 1 }, updatedBy: actorId } });
    });
  }

  async deleteDraft(eventId: string, planId: string, actorId: string, dto: DeleteScheduleDraftDto) {
    return this.transaction(eventId, async (db) => {
      const plan = await this.plan(db, eventId, planId);
      if (plan.draftVersion !== dto.expectedDraftVersion) throw new ConflictException({ code: 'DRAFT_VERSION_CONFLICT', message: 'Bản nháp vừa thay đổi. Hãy làm mới trước khi xoá.' });
      const applied = plan.appliedRevisionId ? await db.matchScheduleRevision.findUnique({ where: { id: plan.appliedRevisionId } }) : null;
      await db.matchScheduleRevision.deleteMany({ where: { planId, appliedAt: null } });
      if (applied) {
        const config = applied.config as unknown as ScheduleConfig;
        // Keep versions monotonic so another tab cannot save/apply a discarded draft.
        await db.matchSchedulePlan.update({ where: { id: planId }, data: { draft: json(config), name: config.name,
          timezone: config.timezone, draftVersion: { increment: 1 }, updatedBy: actorId } });
      } else {
        await db.matchSchedulePlan.delete({ where: { id: planId } });
      }
      await db.auditLog.create({ data: { actorUserId: actorId, action: 'DELETE_SCHEDULE_DRAFT', entityType: 'MatchSchedulePlan', entityId: planId,
        metadata: { eventId, draftVersion: plan.draftVersion, appliedRevisionId: plan.appliedRevisionId, deletedPlan: !applied } } });
      return { eventId, planId, deletedPlan: !applied };
    });
  }

  async preview(eventId: string, planId: string, actorId: string, dto: PreviewScheduleDto) {
    this.validate(dto.config, true);
    return this.transaction(eventId, async (db) => {
      const plan = await this.plan(db, eventId, planId);
      if (plan.draftVersion !== dto.expectedDraftVersion) throw new ConflictException({ code: 'DRAFT_VERSION_CONFLICT', message: 'Bản nháp đã thay đổi. Mở lại lịch để kiểm tra.' });
      const snapshot = await this.snapshot(db, eventId);
      let proposal: ReturnType<typeof previewSnapshot>;
      try { proposal = previewSnapshot(snapshot, dto.config, planId); }
      catch (error: any) { throw new BadRequestException({ code: error.code || 'INVALID_INPUT', message: error.message }); }
      const draftVersion = plan.draftVersion + 1;
      const revision = await db.matchScheduleRevision.create({ data: { planId, draftVersion, inputHash: hash(snapshot),
        config: json(dto.config), proposal: json(proposal), createdBy: actorId } });
      await db.matchSchedulePlan.update({ where: { id: planId }, data: { draft: json(dto.config), draftVersion,
        name: dto.config.name, timezone: dto.config.timezone, updatedBy: actorId } });
      return { ...proposal, previewId: revision.id, draftVersion, expectedAppliedRevision: plan.appliedRevisionId };
    });
  }

  async apply(eventId: string, planId: string, actorId: string, dto: ApplyScheduleDto) {
    if (!dto.idempotencyKey.trim()) throw new BadRequestException('Cần mã yêu cầu áp dụng.');
    return this.transaction(eventId, async (db) => {
      const plan = await this.plan(db, eventId, planId);
      const applyKey = `${planId}:${dto.idempotencyKey}`;
      const applyHash = hash(dto);
      const replay = await db.matchScheduleRevision.findUnique({ where: { applyKey } });
      if (replay) {
        if (replay.applyHash !== applyHash) throw new ConflictException('Mã yêu cầu đã được dùng với nội dung khác.');
        return { eventId, planId, revisionId: replay.id, draftVersion: replay.draftVersion };
      }
      const revision = await db.matchScheduleRevision.findFirst({ where: { id: dto.previewId, planId } });
      if (!revision || revision.appliedAt || revision.draftVersion !== dto.draftVersion || plan.draftVersion !== dto.draftVersion
        || (plan.appliedRevisionId || null) !== (dto.expectedAppliedRevision || null) || hash(plan.draft) !== hash(revision.config)) {
        throw new ConflictException({ code: 'STALE_PREVIEW', message: 'Bản xem trước không còn khớp bản nháp. Hãy tính lại lịch.' });
      }
      const snapshot = await this.snapshot(db, eventId);
      if (hash(snapshot) !== revision.inputHash) throw new ConflictException({ code: 'STALE_PREVIEW', message: 'Trận, nhánh, đội, quy định hoặc lịch liên quan đã thay đổi. Hãy tính lại lịch.' });
      const config = revision.config as unknown as ScheduleConfig;
      const proposal = previewSnapshot(snapshot, config, planId);
      if (hash(proposal) !== hash(revision.proposal)) throw new ConflictException('Kết quả tính lịch đã thay đổi. Hãy xem trước lại.');
      if (!proposal.canApply) throw new BadRequestException('Lịch còn lỗi hoặc trận chưa xếp; không thể áp dụng.');
      if (proposal.warningsRequiringAcknowledgement.length && !dto.acknowledgeWarnings) throw new BadRequestException('Cần xác nhận cảnh báo VĐV chưa xác định trước khi áp dụng.');
      const mutable = snapshot.matches.filter((match) => (match.schedulePlanId === planId || proposal.assignments.some((item) => item.matchId === match.id))
        && !match.scheduleLocked && !['RUNNING', 'FINISHED'].includes(match.status)
        && !snapshot.slots.some((slot) => slot.match?.id === match.id && (slot.isLocked || slot.session.status === 'LOCKED')));
      await db.$executeRaw`SELECT set_config('sportdata.schedule_apply', ${planId}, true)`;
      // EXCLUDE is immediate: release only mutable rows inside this transaction,
      // then project the exact preview. Any failure rolls back both phases.
      await db.match.updateMany({ where: { id: { in: mutable.map((match) => match.id) } }, data: {
        startTime: null, endTime: null, timeSlotId: null, sessionId: null,
        schedulePlanId: null, scheduleRevisionId: null, scheduleSequence: null, scheduleWindowId: null,
      } });
      await db.heat.updateMany({ where: { matchId: { in: mutable.filter((match) => !proposal.assignments.some((item) => item.matchId === match.id)).map((match) => match.id) } },
        data: { startTime: null } });
      await db.matchScheduleCategory.deleteMany({ where: { planId } });
      await db.matchScheduleCategory.createMany({ data: config.blocks.flatMap((block) => block.categoryIds.map((categoryId) => ({ eventId, planId, categoryId }))) });
      for (const item of proposal.assignments) {
        const fop = snapshot.event.fops.find((fop) => fop.id === item.fopId)!;
        const original = snapshot.matches.find((match) => match.id === item.matchId)!;
        const scheduleFields = mutable.some((match) => match.id === item.matchId) ? {
          startTime: new Date(item.start), endTime: new Date(item.end), matchDate: new Date(item.start), fopId: item.fopId, fop: fop.name,
        } : {};
        if (!Object.keys(scheduleFields).length && (+new Date(original.startTime) !== item.start || +new Date(original.endTime) !== item.end || original.fopId !== item.fopId)) {
          throw new ConflictException('Không được di chuyển trận đã đấu hoặc đã khóa.');
        }
        await db.match.update({ where: { id: item.matchId }, data: { ...scheduleFields, schedulePlanId: planId,
          scheduleRevisionId: revision.id, scheduleSequence: item.chainSequence, scheduleWindowId: item.windowId } });
        await db.heat.updateMany({ where: { matchId: item.matchId }, data: { startTime: new Date(item.start) } });
      }
      await db.matchScheduleItem.createMany({ data: proposal.assignments.map((item) => ({ revisionId: revision.id,
        matchId: item.matchId, chainSequence: item.chainSequence, windowId: item.windowId, localDate: item.localDate,
        fopId: item.fopId, blockId: item.blockId, stageKey: item.stageKey, startTime: new Date(item.start), endTime: new Date(item.end),
        turnaroundSeconds: item.turnaroundSeconds })) });
      await db.matchScheduleRevision.update({ where: { id: revision.id }, data: { appliedAt: new Date(), appliedBy: actorId, applyKey, applyHash } });
      await db.matchSchedulePlan.update({ where: { id: planId }, data: { appliedRevisionId: revision.id, updatedBy: actorId } });
      await db.auditLog.create({ data: { actorUserId: actorId, action: 'APPLY_SCHEDULE_PLAN', entityType: 'MatchSchedulePlan', entityId: planId,
        metadata: json({ eventId, revisionId: revision.id, diff: proposal.diff, acknowledgedWarnings: dto.acknowledgeWarnings ? proposal.warningsRequiringAcknowledgement : [], reason: 'Áp dụng bản xem trước đã xác nhận' }) } });
      return { eventId, planId, revisionId: revision.id, draftVersion: revision.draftVersion };
    });
  }

  async revisions(eventId: string, planId: string) {
    await this.plan(this.prisma, eventId, planId);
    return this.prisma.matchScheduleRevision.findMany({ where: { planId, appliedAt: { not: null } },
      select: { id: true, appliedAt: true, appliedBy: true, proposal: true, draftVersion: true }, orderBy: { appliedAt: 'desc' } });
  }
}
