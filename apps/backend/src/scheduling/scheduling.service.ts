import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EntryStatus,
  MatchStatus,
  Prisma,
  ResultStatus,
  SessionStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertContentSchedule } from './content-schedule-guard';
import {
  AutoScheduleDto,
  CreateSessionDto,
  CreateVenueDto,
  GenerateTimeSlotsDto,
  LockScheduleDto,
  UpsertSchedulingRuleDto,
} from './dto/scheduling.dto';

type SlotCandidate = {
  id: string;
  startTime: Date;
  endTime: Date;
  fop: { id: string; name: string; venue: { id: string; name: string; timezone: string } | null };
  session: { id: string; name: string; sportId: string | null };
};

type ScheduleAssignment = {
  matchId: string;
  matchNumber: number | null;
  categoryId: string;
  sportId: string;
  timeSlotId: string;
  sessionId: string;
  fopId: string;
  fop: string;
  startTime: Date;
  endTime: Date;
};

@Injectable()
export class SchedulingService {
  constructor(private readonly prisma: PrismaService) {}

  async getEventOverview(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        _count: {
          select: {
            athletes: true,
            categories: true,
            entries: true,
            teams: true,
            venues: true,
            sessions: true,
            scheduleRules: true,
            heats: true,
            roundRobinGroups: true,
            matches: true,
          },
        },
      },
    });
    if (!event) throw new NotFoundException('Không tìm thấy sự kiện');

    const [timeSlots, scheduledMatches, lockedSchedules, resultGroups] = await Promise.all([
      this.prisma.timeSlot.count({ where: { session: { eventId } } }),
      this.prisma.match.count({ where: { eventId, startTime: { not: null } } }),
      this.prisma.match.count({ where: { eventId, scheduleLocked: true } }),
      this.prisma.match.groupBy({
        by: ['resultStatus'],
        where: { eventId },
        _count: { _all: true },
      }),
    ]);

    return {
      id: event.id,
      name: event.name,
      startDate: event.startDate,
      endDate: event.endDate,
      counts: {
        ...event._count,
        timeSlots,
        scheduledMatches,
        unscheduledMatches: Math.max(0, event._count.matches - scheduledMatches),
        lockedSchedules,
        results: Object.fromEntries(
          resultGroups.map((group) => [group.resultStatus, group._count._all]),
        ),
      },
    };
  }

  async getEventReadiness(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        name: true,
        isPublished: true,
        sport: { select: { id: true, name: true } },
        sports: { select: { id: true, name: true } },
        categories: { select: { id: true, name: true } },
        venues: { select: { id: true } },
        fops: { select: { id: true, name: true, venueId: true } },
      },
    });
    if (!event) throw new NotFoundException('Không tìm thấy sự kiện');

    const eventSports = event.sports.length ? event.sports : [event.sport];
    const activeEntryStatuses = [EntryStatus.REGISTERED, EntryStatus.VERIFIED];
    const [
      sessions,
      rules,
      entryStatusGroups,
      activeEntriesByCategory,
      matchCount,
      unscheduledMatches,
      matchesWithoutEntrants,
      scheduledWithoutSlot,
      finishedDraftResults,
      activeUserRoles,
      conflictReport,
    ] = await Promise.all([
      this.prisma.competitionSession.findMany({
        where: { eventId },
        select: { id: true, status: true, _count: { select: { timeSlots: true } } },
      }),
      this.prisma.sportSchedulingRule.findMany({
        where: { eventId },
        select: { sportId: true },
      }),
      this.prisma.competitionEntry.groupBy({
        by: ['status'],
        where: { eventId },
        _count: { _all: true },
      }),
      this.prisma.competitionEntry.groupBy({
        by: ['categoryId'],
        where: { eventId, status: { in: activeEntryStatuses } },
        _count: { _all: true },
      }),
      this.prisma.match.count({ where: { eventId, status: { not: MatchStatus.CANCELLED } } }),
      this.prisma.match.count({
        where: {
          eventId,
          status: { not: MatchStatus.CANCELLED },
          OR: [{ startTime: null }, { endTime: null }, { fopId: null }],
        },
      }),
      this.prisma.match.count({
        where: {
          eventId,
          status: { not: MatchStatus.CANCELLED },
          athlete1Id: null,
          athlete2Id: null,
          team1Id: null,
          team2Id: null,
          participants: { none: {} },
          OR: [
            { round: 1 },
            { matchType: { in: ['HEAT', 'GROUP_STAGE', 'POOL', 'QUALIFIER'] } },
          ],
        },
      }),
      this.prisma.match.count({
        where: {
          eventId,
          status: { not: MatchStatus.CANCELLED },
          startTime: { not: null },
          timeSlotId: null,
        },
      }),
      this.prisma.match.count({
        where: {
          eventId,
          status: MatchStatus.FINISHED,
          resultStatus: ResultStatus.DRAFT,
          winMethod: { not: 'WALKOVVER' },
        },
      }),
      this.prisma.user.groupBy({
        by: ['role'],
        where: { isActive: true },
        _count: { _all: true },
      }),
      this.reportConflicts(eventId),
    ]);

    const rulesBySport = new Set(rules.map(({ sportId }) => sportId));
    const categoriesWithEntries = new Set(activeEntriesByCategory.map(({ categoryId }) => categoryId));
    const missingRuleSports = eventSports.filter(({ id }) => !rulesBySport.has(id));
    const emptyCategories = event.categories.filter(({ id }) => !categoriesWithEntries.has(id));
    const missingVenueFops = event.fops.filter(({ venueId }) => !venueId);
    const sessionsWithoutSlots = sessions.filter((session) => session._count.timeSlots === 0);
    const draftSessions = sessions.filter((session) => session.status === SessionStatus.DRAFT);
    const entryCounts = Object.fromEntries(
      entryStatusGroups.map((group) => [group.status, group._count._all]),
    ) as Partial<Record<EntryStatus, number>>;
    const activeEntries = (entryCounts.REGISTERED || 0) + (entryCounts.VERIFIED || 0);
    const roleCounts = new Map(activeUserRoles.map((group) => [group.role, group._count._all]));
    const hasEventManager = Boolean(roleCounts.get(UserRole.GAMES_ADMIN) || roleCounts.get(UserRole.ADMIN));
    const checks: Array<{
      code: string;
      status: 'PASS' | 'WARN' | 'FAIL';
      title: string;
      detail: string;
      tab: 'resources' | 'entries' | 'schedule' | 'results';
    }> = [];
    const addCheck = (
      code: string,
      status: 'PASS' | 'WARN' | 'FAIL',
      title: string,
      detail: string,
      tab: 'resources' | 'entries' | 'schedule' | 'results',
    ) => checks.push({ code, status, title, detail, tab });

    addCheck(
      'EVENT_PUBLISHED',
      event.isPublished ? 'PASS' : 'FAIL',
      'Công bố sự kiện',
      event.isPublished ? 'Sự kiện đang hiển thị công khai.' : 'Sự kiện vẫn là bản nháp.',
      'resources',
    );
    addCheck(
      'SPORTS_AND_CATEGORIES',
      eventSports.length && event.categories.length ? 'PASS' : 'FAIL',
      'Bộ môn và hạng mục',
      `${eventSports.length} bộ môn · ${event.categories.length} hạng mục thi đấu.`,
      'entries',
    );
    addCheck(
      'ACTIVE_ENTRIES',
      activeEntries ? 'PASS' : 'FAIL',
      'Danh sách đăng ký',
      activeEntries ? `${activeEntries} entry còn hiệu lực.` : 'Chưa có entry còn hiệu lực.',
      'entries',
    );
    addCheck(
      'ENTRY_VERIFICATION',
      entryCounts.REGISTERED ? 'WARN' : 'PASS',
      'Xác minh entry',
      entryCounts.REGISTERED
        ? `${entryCounts.REGISTERED} entry mới đăng ký, chưa được xác minh.`
        : 'Không còn entry chờ xác minh.',
      'entries',
    );
    addCheck(
      'CATEGORY_ENTRY_COVERAGE',
      emptyCategories.length ? 'WARN' : 'PASS',
      'Phủ entry theo hạng mục',
      emptyCategories.length
        ? `${emptyCategories.length} hạng mục chưa có entry: ${emptyCategories.slice(0, 3).map(({ name }) => name).join(', ')}${emptyCategories.length > 3 ? '…' : ''}`
        : 'Tất cả hạng mục đều có entry.',
      'entries',
    );
    addCheck(
      'VENUE_AND_FOP',
      event.venues.length && event.fops.length ? 'PASS' : 'FAIL',
      'Venue và FOP',
      `${event.venues.length} địa điểm · ${event.fops.length} sàn/FOP.`,
      'resources',
    );
    addCheck(
      'FOP_VENUE_MAPPING',
      missingVenueFops.length ? 'FAIL' : 'PASS',
      'Gán FOP vào venue',
      missingVenueFops.length
        ? `${missingVenueFops.length} FOP chưa gắn venue: ${missingVenueFops.slice(0, 3).map(({ name }) => name).join(', ')}${missingVenueFops.length > 3 ? '…' : ''}`
        : 'Mọi FOP đã được gắn đúng cấp venue.',
      'resources',
    );
    addCheck(
      'SESSIONS_AND_SLOTS',
      sessions.length && !sessionsWithoutSlots.length ? 'PASS' : 'FAIL',
      'Ca thi đấu và time slot',
      sessions.length
        ? `${sessions.length} ca · ${sessionsWithoutSlots.length} ca chưa có time slot.`
        : 'Chưa tạo ca thi đấu.',
      'resources',
    );
    addCheck(
      'SESSION_PUBLICATION',
      draftSessions.length ? 'WARN' : 'PASS',
      'Trạng thái ca thi đấu',
      draftSessions.length ? `${draftSessions.length} ca vẫn đang ở trạng thái nháp.` : 'Không còn ca ở trạng thái nháp.',
      'resources',
    );
    addCheck(
      'SPORT_RULES',
      missingRuleSports.length ? 'FAIL' : 'PASS',
      'Quy tắc xếp lịch từng môn',
      missingRuleSports.length
        ? `Thiếu quy tắc cho: ${missingRuleSports.map(({ name }) => name).join(', ')}.`
        : 'Mọi bộ môn đã có thời lượng, thời gian nghỉ và khung giờ.',
      'resources',
    );
    addCheck(
      'MATCH_GENERATION',
      matchCount ? 'PASS' : 'FAIL',
      'Sinh cấu trúc thi đấu',
      matchCount ? `${matchCount} trận/heat đã được tạo.` : 'Chưa có trận hoặc heat.',
      'entries',
    );
    addCheck(
      'FIRST_ROUND_PARTICIPANTS',
      matchesWithoutEntrants ? 'FAIL' : 'PASS',
      'Đối tượng thi đấu vòng đầu',
      matchesWithoutEntrants
        ? `${matchesWithoutEntrants} trận vòng đầu chưa có bất kỳ VĐV/đội/entry nào.`
        : 'Các trận vòng đầu đều đã có đối tượng thi đấu.',
      'entries',
    );
    addCheck(
      'SCHEDULE_COMPLETENESS',
      unscheduledMatches ? 'FAIL' : 'PASS',
      'Hoàn tất xếp lịch',
      unscheduledMatches ? `${unscheduledMatches}/${matchCount} trận chưa đủ thời gian hoặc FOP.` : 'Toàn bộ trận đã có thời gian và FOP.',
      'schedule',
    );
    addCheck(
      'TIME_SLOT_LINKAGE',
      scheduledWithoutSlot ? 'WARN' : 'PASS',
      'Liên kết time slot',
      scheduledWithoutSlot
        ? `${scheduledWithoutSlot} trận được xếp thủ công nhưng chưa liên kết time slot.`
        : 'Mọi trận đã xếp đều liên kết time slot.',
      'schedule',
    );
    addCheck(
      'HARD_CONFLICTS',
      conflictReport.valid ? 'PASS' : 'FAIL',
      'Ràng buộc lịch cứng',
      conflictReport.valid
        ? `Đã kiểm tra ${conflictReport.checkedMatches} trận, không có xung đột.`
        : `Phát hiện ${conflictReport.conflictCount} xung đột lịch cứng.`,
      'schedule',
    );
    addCheck(
      'FINISHED_RESULT_DRAFT',
      finishedDraftResults ? 'FAIL' : 'PASS',
      'Tính toàn vẹn kết quả',
      finishedDraftResults
        ? `${finishedDraftResults} trận đã hoàn thành nhưng kết quả vẫn ở trạng thái bản nháp.`
        : 'Không có trận hoàn thành bị bỏ ngoài quy trình kết quả.',
      'results',
    );
    addCheck(
      'OPERATIONAL_STAFFING',
      hasEventManager ? 'PASS' : 'WARN',
      'Phân công tài khoản vận hành',
      hasEventManager
        ? 'Đã có tài khoản Quản lý sự kiện hoặc Quản trị hệ thống để vận hành.'
        : 'Chưa có tài khoản Quản lý sự kiện hoặc Quản trị hệ thống đang hoạt động.',
      'resources',
    );

    const summary = checks.reduce(
      (result, check) => ({ ...result, [check.status.toLowerCase()]: result[check.status.toLowerCase() as 'pass' | 'warn' | 'fail'] + 1 }),
      { pass: 0, warn: 0, fail: 0 },
    );
    const score = Math.round(((summary.pass + summary.warn * 0.5) / checks.length) * 100);

    return {
      eventId,
      eventName: event.name,
      ready: summary.fail === 0,
      score,
      summary: { ...summary, total: checks.length },
      checks,
      generatedAt: new Date(),
    };
  }

  listVenues(eventId?: string) {
    return this.prisma.venue.findMany({
      where: eventId ? { events: { some: { id: eventId } } } : undefined,
      include: {
        sports: { select: { id: true, name: true, code: true } },
        _count: { select: { fops: true, sessions: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createVenue(dto: CreateVenueDto) {
    return this.prisma.venue.create({
      data: {
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        location: dto.location?.trim(),
        capacity: dto.capacity,
        timezone: dto.timezone || 'Asia/Ho_Chi_Minh',
        sports: dto.sportIds?.length ? { connect: dto.sportIds.map((id) => ({ id })) } : undefined,
        events: dto.eventIds?.length ? { connect: dto.eventIds.map((id) => ({ id })) } : undefined,
      },
      include: { sports: true, events: { select: { id: true, name: true } } },
    });
  }

  async removeVenue(id: string) {
    const venue = await this.prisma.venue.findUnique({
      where: { id },
      include: { _count: { select: { fops: true, sessions: true } } },
    });
    if (!venue) throw new NotFoundException('Không tìm thấy địa điểm');
    if (venue._count.fops || venue._count.sessions) {
      throw new BadRequestException('Không thể xóa địa điểm đang có sân/sàn hoặc ca thi đấu');
    }
    await this.prisma.venue.delete({ where: { id } });
  }

  listSessions(eventId: string) {
    return this.prisma.competitionSession.findMany({
      where: { eventId },
      include: {
        venue: true,
        sport: { select: { id: true, name: true, code: true } },
        _count: { select: { timeSlots: true, matches: true } },
      },
      orderBy: { startTime: 'asc' },
    });
  }

  async createSession(eventId: string, dto: CreateSessionDto) {
    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);
    if (endTime <= startTime) throw new BadRequestException('Thời gian kết thúc ca phải sau thời gian bắt đầu');

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, startDate: true, endDate: true, sports: { select: { id: true } } },
    });
    if (!event) throw new NotFoundException('Không tìm thấy sự kiện');
    if (startTime < event.startDate || endTime > new Date(event.endDate.getTime() + 86_400_000)) {
      throw new BadRequestException('Ca thi đấu phải nằm trong thời gian diễn ra sự kiện');
    }
    if (dto.sportId && !event.sports.some(({ id }) => id === dto.sportId)) {
      throw new BadRequestException('Bộ môn không thuộc sự kiện này');
    }

    const venue = await this.prisma.venue.findUnique({ where: { id: dto.venueId }, select: { id: true } });
    if (!venue) throw new NotFoundException('Không tìm thấy địa điểm');

    return this.prisma.$transaction(async (transaction) => {
      await transaction.event.update({
        where: { id: eventId },
        data: { venues: { connect: { id: dto.venueId } } },
      });
      return transaction.competitionSession.create({
        data: {
          eventId,
          venueId: dto.venueId,
          sportId: dto.sportId,
          name: dto.name.trim(),
          startTime,
          endTime,
          status: dto.status || SessionStatus.DRAFT,
          notes: dto.notes?.trim(),
        },
        include: { venue: true, sport: true },
      });
    });
  }

  async generateTimeSlots(sessionId: string, dto: GenerateTimeSlotsDto) {
    const session = await this.prisma.competitionSession.findUnique({
      where: { id: sessionId },
      include: { venue: true },
    });
    if (!session) throw new NotFoundException('Không tìm thấy ca thi đấu');
    if (session.status === SessionStatus.LOCKED) throw new BadRequestException('Ca thi đấu đã bị khóa');

    const fops = await this.prisma.fop.findMany({
      where: { id: { in: dto.fopIds }, eventId: session.eventId },
    });
    if (fops.length !== dto.fopIds.length) throw new BadRequestException('Có sân/sàn không thuộc sự kiện này');
    const invalidVenue = fops.find((fop) => fop.venueId && fop.venueId !== session.venueId);
    if (invalidVenue) throw new BadRequestException(`Sân/sàn ${invalidVenue.name} thuộc một địa điểm khác`);

    const durationMs = (dto.durationMinutes || 10) * 60_000;
    const stepMs = durationMs + (dto.turnaroundMinutes ?? 5) * 60_000;
    const existing = await this.prisma.timeSlot.findMany({
      where: { sessionId, fopId: { in: dto.fopIds } },
      select: { fopId: true, startTime: true, endTime: true },
    });
    const existingKeys = new Set(existing.map((slot) => `${slot.fopId}:${slot.startTime.toISOString()}:${slot.endTime.toISOString()}`));
    const rows: Prisma.TimeSlotCreateManyInput[] = [];
    for (const fop of fops) {
      for (let cursor = session.startTime.getTime(); cursor + durationMs <= session.endTime.getTime(); cursor += stepMs) {
        const startTime = new Date(cursor);
        const endTime = new Date(cursor + durationMs);
        const key = `${fop.id}:${startTime.toISOString()}:${endTime.toISOString()}`;
        if (!existingKeys.has(key)) rows.push({ sessionId, fopId: fop.id, startTime, endTime });
      }
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.fop.updateMany({
        where: { id: { in: fops.filter((fop) => !fop.venueId).map((fop) => fop.id) } },
        data: { venueId: session.venueId },
      });
      if (rows.length) await transaction.timeSlot.createMany({ data: rows });
    });
    return { created: rows.length, existing: existing.length, total: rows.length + existing.length };
  }

  async upsertRule(eventId: string, sportId: string, dto: UpsertSchedulingRuleDto) {
    const membership = await this.prisma.event.count({ where: { id: eventId, sports: { some: { id: sportId } } } });
    if (!membership) throw new BadRequestException('Bộ môn không thuộc sự kiện này');
    return this.prisma.sportSchedulingRule.upsert({
      where: { eventId_sportId: { eventId, sportId } },
      update: dto,
      create: { eventId, sportId, ...dto },
      include: { sport: { select: { id: true, name: true, code: true } } },
    });
  }

  listRules(eventId: string) {
    return this.prisma.sportSchedulingRule.findMany({
      where: { eventId },
      include: { sport: { select: { id: true, name: true, code: true } } },
      orderBy: { sport: { name: 'asc' } },
    });
  }

  async lockMatch(matchId: string, userId: string, dto: LockScheduleDto) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId }, select: { id: true } });
    if (!match) throw new NotFoundException('Không tìm thấy trận đấu');
    return this.prisma.match.update({
      where: { id: matchId },
      data: {
        scheduleLocked: dto.locked,
        scheduleLockedAt: dto.locked ? new Date() : null,
        scheduleLockedBy: dto.locked ? userId : null,
        scheduleLockReason: dto.locked ? dto.reason?.trim() || null : null,
      },
      select: {
        id: true,
        scheduleLocked: true,
        scheduleLockedAt: true,
        scheduleLockedBy: true,
        scheduleLockReason: true,
      },
    });
  }

  async autoSchedule(eventId: string, dto: AutoScheduleDto) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new NotFoundException('Không tìm thấy sự kiện');
    const onlyUnscheduled = dto.onlyUnscheduled !== false;
    const dryRun = dto.dryRun !== false;

    const matches = await this.prisma.match.findMany({
      where: {
        eventId,
        schedulePlanId: null,
        scheduleLocked: false,
        status: MatchStatus.SCHEDULED,
        ...(onlyUnscheduled ? { OR: [{ startTime: null }, { timeSlotId: null }] } : {}),
        ...(dto.categoryIds?.length ? { categoryId: { in: dto.categoryIds } } : {}),
        ...(dto.sportIds?.length ? { category: { sportId: { in: dto.sportIds } } } : {}),
      },
      include: {
        category: { select: { sportId: true, matchDurationSeconds: true } },
        participants: { select: { athleteId: true, teamId: true } },
        winnerFromMatches: { select: { id: true, endTime: true } },
        loserFromMatches: { select: { id: true, endTime: true } },
      },
      orderBy: [{ round: 'asc' }, { categoryId: 'asc' }, { matchNumber: 'asc' }],
    });
    const slots = await this.prisma.timeSlot.findMany({
      where: {
        match: null,
        isLocked: false,
        session: { eventId, status: { not: SessionStatus.LOCKED } },
      },
      include: {
        fop: { select: { id: true, name: true, venue: { select: { id: true, name: true, timezone: true } } } },
        session: { select: { id: true, name: true, sportId: true } },
      },
      orderBy: [{ startTime: 'asc' }, { fopId: 'asc' }],
    });
    const rules = await this.prisma.sportSchedulingRule.findMany({ where: { eventId } });
    const ruleBySport = new Map(rules.map((rule) => [rule.sportId, rule]));
    const targetIds = new Set(matches.map(({ id }) => id));
    const existing = await this.prisma.match.findMany({
      where: {
        eventId,
        id: { notIn: [...targetIds] },
        status: { not: MatchStatus.CANCELLED },
        startTime: { not: null },
        endTime: { not: null },
      },
      include: { participants: { select: { athleteId: true, teamId: true } } },
    });

    const occupiedByParticipant = new Map<string, Array<{ start: Date; end: Date }>>();
    for (const match of existing) {
      if (!match.startTime || !match.endTime) continue;
      for (const key of this.participantKeys(match)) {
        const list = occupiedByParticipant.get(key) || [];
        list.push({ start: match.startTime, end: match.endTime });
        occupiedByParticipant.set(key, list);
      }
    }
    const proposedEnd = new Map<string, Date>();
    const usedSlots = new Set<string>();
    const dayLoad = new Map<string, number>();
    const lastCategorySession = new Map<string, string>();
    const assignments: ScheduleAssignment[] = [];
    const unscheduled: Array<{ matchId: string; matchNumber: number | null; reason: string }> = [];

    for (const match of matches) {
      const rule = ruleBySport.get(match.category.sportId);
      const restMs = (rule?.minRestMinutes ?? 60) * 60_000;
      const durationMs = (rule?.matchDurationMinutes
        ?? Math.ceil((match.category.matchDurationSeconds || 600) / 60)) * 60_000;
      const predecessorIds = [...match.winnerFromMatches, ...match.loserFromMatches].map(({ id }) => id);
      const unresolvedPredecessor = predecessorIds.some((id) => !proposedEnd.has(id)
        && ![...match.winnerFromMatches, ...match.loserFromMatches].find((source) => source.id === id)?.endTime);
      if (unresolvedPredecessor) {
        unscheduled.push({ matchId: match.id, matchNumber: match.matchNumber, reason: 'Previous round is not scheduled' });
        continue;
      }
      const predecessorEnds = [...match.winnerFromMatches, ...match.loserFromMatches]
        .map((source) => proposedEnd.get(source.id) || source.endTime)
        .filter((value): value is Date => Boolean(value));
      const notBefore = predecessorEnds.length
        ? new Date(Math.max(...predecessorEnds.map((date) => date.getTime())) + restMs)
        : null;
      const participantKeys = this.participantKeys(match);

      const candidates = (slots as SlotCandidate[]).filter((slot) => {
        if (usedSlots.has(slot.id)) return false;
        if (slot.session.sportId && slot.session.sportId !== match.category.sportId) return false;
        if (slot.endTime.getTime() - slot.startTime.getTime() < durationMs) return false;
        if (notBefore && slot.startTime < notBefore) return false;
        if (!this.isInsideRuleWindow(slot, rule)) return false;
        return participantKeys.every((key) => (occupiedByParticipant.get(key) || []).every((interval) =>
          slot.startTime.getTime() >= interval.end.getTime() + restMs
          || slot.endTime.getTime() + restMs <= interval.start.getTime()));
      });
      if (!candidates.length) {
        unscheduled.push({ matchId: match.id, matchNumber: match.matchNumber, reason: 'No valid time slot satisfies all hard constraints' });
        continue;
      }

      candidates.sort((a, b) => this.slotScore(a, match, rule, dayLoad, lastCategorySession)
        - this.slotScore(b, match, rule, dayLoad, lastCategorySession));
      const slot = candidates[0];
      const endTime = new Date(slot.startTime.getTime() + durationMs);
      const assignment: ScheduleAssignment = {
        matchId: match.id,
        matchNumber: match.matchNumber,
        categoryId: match.categoryId,
        sportId: match.category.sportId,
        timeSlotId: slot.id,
        sessionId: slot.session.id,
        fopId: slot.fop.id,
        fop: slot.fop.name,
        startTime: slot.startTime,
        endTime,
      };
      assignments.push(assignment);
      usedSlots.add(slot.id);
      proposedEnd.set(match.id, endTime);
      const day = slot.startTime.toISOString().slice(0, 10);
      dayLoad.set(day, (dayLoad.get(day) || 0) + 1);
      lastCategorySession.set(match.categoryId, slot.session.id);
      for (const key of participantKeys) {
        const list = occupiedByParticipant.get(key) || [];
        list.push({ start: slot.startTime, end: endTime });
        occupiedByParticipant.set(key, list);
      }
    }

    if (!dryRun && assignments.length) {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${eventId}))`;
        for (const assignment of assignments) {
          const original = matches.find((match) => match.id === assignment.matchId)!;
          const written = await transaction.match.updateMany({
            where: { id: assignment.matchId, status: MatchStatus.SCHEDULED, scheduleLocked: false, updatedAt: original.updatedAt },
            data: {
              matchDate: assignment.startTime,
              startTime: assignment.startTime,
              endTime: assignment.endTime,
              fop: assignment.fop,
              fopId: assignment.fopId,
              sessionId: assignment.sessionId,
              timeSlotId: assignment.timeSlotId,
            },
          });
          if (written.count !== 1) throw new ConflictException('Trận đấu đã bắt đầu hoặc lịch đã thay đổi. Hãy xếp lịch lại.');
        }
        await assertContentSchedule(transaction, eventId, assignments.map((assignment) => assignment.matchId));
      });
    }
    return {
      dryRun,
      requested: matches.length,
      scheduled: assignments.length,
      unscheduled: unscheduled.length,
      assignments,
      conflicts: unscheduled,
    };
  }

  async reportConflicts(eventId: string) {
    const [matches, rules] = await Promise.all([
      this.prisma.match.findMany({
        where: { eventId, status: { not: MatchStatus.CANCELLED } },
        include: {
          category: { select: { sportId: true } },
          participants: { select: { athleteId: true, teamId: true } },
          winnerFromMatches: { select: { id: true, endTime: true } },
          loserFromMatches: { select: { id: true, endTime: true } },
          fopRecord: { select: { venue: { select: { timezone: true } } } },
        },
        orderBy: { startTime: 'asc' },
      }),
      this.prisma.sportSchedulingRule.findMany({ where: { eventId } }),
    ]);
    const ruleBySport = new Map(rules.map((rule) => [rule.sportId, rule]));
    const conflicts: Array<Record<string, unknown>> = [];
    const scheduled = matches.filter((match) => match.startTime && match.endTime);

    const byFop = new Map<string, typeof scheduled>();
    for (const match of scheduled) {
      if (!match.fopId) continue;
      const list = byFop.get(match.fopId) || [];
      list.push(match);
      byFop.set(match.fopId, list);
    }
    for (const [fopId, rows] of byFop) {
      rows.sort((a, b) => a.startTime!.getTime() - b.startTime!.getTime());
      for (let i = 0; i < rows.length; i += 1) {
        for (let j = i + 1; j < rows.length && rows[j].startTime! < rows[i].endTime!; j += 1) {
          conflicts.push({ type: 'FOP_OVERLAP', severity: 'ERROR', fopId, matchIds: [rows[i].id, rows[j].id] });
        }
      }
    }

    const byParticipant = new Map<string, typeof scheduled>();
    for (const match of scheduled) {
      for (const key of this.participantKeys(match)) {
        const list = byParticipant.get(key) || [];
        list.push(match);
        byParticipant.set(key, list);
      }
      const rule = ruleBySport.get(match.category.sportId);
      const slot = {
        startTime: match.startTime!,
        endTime: match.endTime!,
        fop: { venue: { timezone: match.fopRecord?.venue?.timezone || 'Asia/Ho_Chi_Minh' } },
      } as SlotCandidate;
      if (!this.isInsideRuleWindow(slot, rule)) {
        conflicts.push({ type: 'SPORT_WINDOW', severity: 'ERROR', matchIds: [match.id] });
      }
      for (const source of [...match.winnerFromMatches, ...match.loserFromMatches]) {
        const restMs = (rule?.minRestMinutes ?? 60) * 60_000;
        if (source.endTime && match.startTime!.getTime() < source.endTime.getTime() + restMs) {
          conflicts.push({ type: 'PROGRESSION_ORDER', severity: 'ERROR', matchIds: [source.id, match.id] });
        }
      }
    }
    for (const [participant, rows] of byParticipant) {
      rows.sort((a, b) => a.startTime!.getTime() - b.startTime!.getTime());
      for (let i = 1; i < rows.length; i += 1) {
        const previous = rows[i - 1];
        const current = rows[i];
        const restMinutes = Math.max(
          ruleBySport.get(previous.category.sportId)?.minRestMinutes ?? 60,
          ruleBySport.get(current.category.sportId)?.minRestMinutes ?? 60,
        );
        if (current.startTime!.getTime() < previous.endTime!.getTime() + restMinutes * 60_000) {
          conflicts.push({ type: 'PARTICIPANT_REST', severity: 'ERROR', participant, requiredMinutes: restMinutes, matchIds: [previous.id, current.id] });
        }
      }
    }
    return {
      eventId,
      checkedMatches: matches.length,
      conflictCount: conflicts.length,
      valid: conflicts.length === 0,
      conflicts,
    };
  }

  private participantKeys(match: {
    athlete1Id?: string | null;
    athlete2Id?: string | null;
    team1Id?: string | null;
    team2Id?: string | null;
    participants?: Array<{ athleteId: string | null; teamId: string | null }>;
  }) {
    return Array.from(new Set([
      match.athlete1Id ? `athlete:${match.athlete1Id}` : null,
      match.athlete2Id ? `athlete:${match.athlete2Id}` : null,
      match.team1Id ? `team:${match.team1Id}` : null,
      match.team2Id ? `team:${match.team2Id}` : null,
      ...(match.participants || []).flatMap((participant) => [
        participant.athleteId ? `athlete:${participant.athleteId}` : null,
        participant.teamId ? `team:${participant.teamId}` : null,
      ]),
    ].filter((value): value is string => Boolean(value))));
  }

  private isInsideRuleWindow(slot: SlotCandidate, rule?: {
    earliestStart: string;
    latestEnd: string;
    outdoor: boolean;
  }) {
    if (!rule) return true;
    const timezone = slot.fop.venue?.timezone || 'Asia/Ho_Chi_Minh';
    const start = this.localTime(slot.startTime, timezone);
    const end = this.localTime(slot.endTime, timezone);
    const earliest = rule.outdoor ? '05:00' : rule.earliestStart;
    const latest = rule.outdoor && rule.latestEnd === '22:00' ? '08:00' : rule.latestEnd;
    return start >= earliest && end <= latest;
  }

  private localTime(date: Date, timezone: string) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  private slotScore(
    slot: SlotCandidate,
    match: { categoryId: string; matchType: string },
    rule: { preferredStart: string | null; preferredEnd: string | null } | undefined,
    dayLoad: Map<string, number>,
    lastCategorySession: Map<string, string>,
  ) {
    const day = slot.startTime.toISOString().slice(0, 10);
    let score = (dayLoad.get(day) || 0) * 1_000 + slot.startTime.getTime() / 1e11;
    if (lastCategorySession.get(match.categoryId) === slot.session.id) score -= 120;
    const timezone = slot.fop.venue?.timezone || 'Asia/Ho_Chi_Minh';
    const local = this.localTime(slot.startTime, timezone);
    const preferredStart = rule?.preferredStart || '18:00';
    const preferredEnd = rule?.preferredEnd || '21:30';
    if (['FINAL', 'SEMIFINAL'].includes(match.matchType) && local >= preferredStart && local <= preferredEnd) score -= 500;
    return score;
  }
}
