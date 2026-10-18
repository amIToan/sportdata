import { repechageSemifinalIds } from './quarterfinal-repechage';
import { assertAthleteEligibility } from '../competitions/athlete-eligibility';
import { resolveEventAgeLimits } from '../events/event-age-limits';
import { isAutomaticScheduleBye } from '../scheduling/planner/main-tree';
import { activeContentBlockers } from '../scheduling/planner/participant-content';
import { assertContentSchedule } from '../scheduling/content-schedule-guard';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PreconfiguredPairDto, SaveDrawPreconfigurationDto, PreviewDrawDto, preconfigurationDrawTypes } from './dto/draw-preconfiguration.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMatchDto } from './dto/create-match.dto';
import { UpdateMatchDto } from './dto/update-match.dto';
import { QueryMatchDto } from './dto/query-match.dto';
import { GenerateDrawDto, SeedingMode } from './dto/generate-draw.dto';
import {
  BracketSide,
  DrawType,
  EntryStatus,
  Match,
  MatchStatus,
  MatchType,
  Prisma,
  ResultStatus,
  WinMethod,
} from '@prisma/client';

const MATCH_INCLUDE = {
  event: { select: { id: true, name: true } },
  category: {
    select: {
      id: true,
      name: true,
      gender: true,
      discipline: true,
      uniform: true,
      beltLevel: true,
      matchDurationSeconds: true,
      minAge: true,
      maxAge: true,
      minWeight: true,
      maxWeight: true,
      sport: { select: { id: true, name: true, code: true } },
    },
  },
  division: { select: { id: true, name: true } },
  fopRecord: { select: { id: true, name: true } },
  draw: { select: { id: true, name: true, type: true, bracketSize: true, sortOrder: true } },
  athlete1: {
    select: {
      id: true,
      fullName: true,
      photoUrl: true,
      country: { select: { code: true, name: true, flagUrl: true } },
      federation: { select: { id: true, name: true } },
    },
  },
  athlete2: {
    select: {
      id: true,
      fullName: true,
      photoUrl: true,
      country: { select: { code: true, name: true, flagUrl: true } },
      federation: { select: { id: true, name: true } },
    },
  },
  team1: {
    select: {
      id: true,
      name: true,
      code: true,
      members: { select: { athlete: { select: { id: true, fullName: true } } } },
      country: { select: { code: true, name: true, flagUrl: true } },
    },
  },
  team2: {
    select: {
      id: true,
      name: true,
      code: true,
      members: { select: { athlete: { select: { id: true, fullName: true } } } },
      country: { select: { code: true, name: true, flagUrl: true } },
    },
  },
  winner: {
    select: {
      id: true,
      fullName: true,
    },
  },
  winnerTeam: { select: { id: true, name: true, code: true } },
  session: { select: { id: true, name: true, startTime: true, endTime: true } },
};

type SeedAthlete = {
  id: string;
  countryId: string;
  federationId: string | null;
  seed?: number | null;
};

type GeneratedMatch = Prisma.MatchCreateManyInput;

type ScheduledFop = {
  id: string;
  name: string;
};

type PlannedRoundRobinGroup = {
  id: string;
  name: string;
  members: Array<{ entryId: string; seed: number | null }>;
};

type DateAssignableMatch = {
  id: string;
  matchNumber?: number | null;
  round?: number | null;
  winnerToMatchId?: string | null;
  loserToMatchId?: string | null;
  matchDate: Date | string;
};

@Injectable()
export class MatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async assertRepechageReady(db: PrismaService | Prisma.TransactionClient, match: Match) {
    if (!match.drawId || match.round !== 1) return;
    const draw = await db.draw.findUnique({ where: { id: match.drawId } });
    if (draw?.type !== DrawType.REPECHAGE_QUARTERFINALS) return;
    const matches = await db.match.findMany({ where: { eventId: match.eventId, categoryId: match.categoryId } });
    const ids = repechageSemifinalIds(match, matches, [draw]);
    if (ids.length !== 2 || ids.some((id) => {
      const semifinal = matches.find((item) => item.id === id);
      return !semifinal || semifinal.status !== MatchStatus.FINISHED
        || !this.isGeneratedWalkover(semifinal) && !new Set<ResultStatus>([ResultStatus.REFEREE_CONFIRMED, ResultStatus.APPROVED,
          ResultStatus.PUBLISHED, ResultStatus.LOCKED]).has(semifinal.resultStatus);
    })) throw new BadRequestException('Phải hoàn tất cả hai trận bán kết và xác nhận kết quả trước khi bắt đầu repechage');
  }

  async assertScoreboardReady(db: PrismaService | Prisma.TransactionClient, match: Match) {
    await this.assertRepechageReady(db, match);
    if (match.schedulePlanId && match.scheduleRevisionId) {
      const current = await db.matchScheduleItem.findUnique({ where: { revisionId_matchId: { revisionId: match.scheduleRevisionId, matchId: match.id } } });
      if (!current) throw new ConflictException('Lịch thi đấu không nhất quán. Hãy mở lịch để kiểm tra.');
      const earlier = await db.matchScheduleItem.findMany({ where: { revisionId: match.scheduleRevisionId,
        chainSequence: { lt: current.chainSequence } }, include: { match: true } });
      const unfinished = earlier.find((item) => (item.blockId !== current.blockId || item.stageKey !== current.stageKey)
        && item.match.status !== 'FINISHED' && !isAutomaticScheduleBye(item.match));
      if (unfinished) throw new ConflictException(`Vòng/nội dung trước còn trận #${unfinished.match.matchNumber || unfinished.matchId} chưa hoàn tất.`);
    }
    if (!match.athlete1Id || !match.athlete2Id || match.athlete1Id === match.athlete2Id) {
      throw new BadRequestException('Cần đủ hai VĐV khác nhau trước khi bắt đầu');
    }
    const [contentMatches, contentTeams] = await Promise.all([
      db.match.findMany({ where: { eventId: match.eventId }, include: { category: true, draw: true, participants: true,
        athlete1: { select: { fullName: true } }, athlete2: { select: { fullName: true } } } }),
      db.team.findMany({ where: { eventId: match.eventId }, include: { members: true } }),
    ]);
    const currentContentMatch = contentMatches.find((item) => item.id === match.id);
    if (currentContentMatch) {
      const blocked = activeContentBlockers(contentMatches, new Map(contentTeams.map((team) => [team.id, team.members.map((member) => member.athleteId)])), currentContentMatch)[0];
      if (blocked) {
        const previous = contentMatches.find((item) => item.categoryId === blocked.categoryId)!;
        const name = blocked.participantId === `athlete:${match.athlete1Id}` ? currentContentMatch.athlete1?.fullName : currentContentMatch.athlete2?.fullName;
        throw new ConflictException(`${name || 'VĐV'} chưa hoàn tất nội dung ${previous.category.name}; còn trận/nhánh có thể thi đấu. Phải bị loại hoàn toàn hoặc hoàn tất trận cuối rồi mới được bắt đầu ${currentContentMatch.category.name}.`);
      }
    }
    if (!match.fopId || !match.startTime || !match.endTime || match.endTime <= match.startTime) {
      throw new BadRequestException('Cần xếp sân/FOP, giờ bắt đầu và kết thúc trước khi thi đấu');
    }
    const event = await db.event.findUnique({ where: { id: match.eventId }, select: { startDate: true, endDate: true } });
    if (!event) throw new BadRequestException('Không tìm thấy sự kiện');
    this.assertInsideEventDates(event, match.matchDate, match.startTime, match.endTime);
    const fop = await db.fop.findFirst({ where: { id: match.fopId, eventId: match.eventId }, include: { venue: true } });
    if (!fop || fop.venue?.isActive === false) throw new BadRequestException('Sân/FOP không khả dụng');
    if (match.sessionId) {
      const session = await db.competitionSession.findUnique({ where: { id: match.sessionId } });
      if (!session || session.eventId !== match.eventId || match.startTime < session.startTime || match.endTime > session.endTime) {
        throw new BadRequestException('Giờ thi đấu không nằm trong ca đã xếp');
      }
    }
    if (match.timeSlotId) {
      const slot = await db.timeSlot.findUnique({ where: { id: match.timeSlotId } });
      if (!slot || slot.fopId !== match.fopId || match.startTime < slot.startTime || match.endTime > slot.endTime) {
        throw new BadRequestException('Trận đấu không khớp sân hoặc khung giờ đã xếp');
      }
    }
    // Scheduled times are estimates; operators may start a ready match early.
    const feeder = await db.match.findFirst({ where: {
      OR: [{ winnerToMatchId: match.id }, { loserToMatchId: match.id }], status: { not: MatchStatus.FINISHED },
    } });
    if (feeder) throw new BadRequestException('Trận đấu nguồn chưa hoàn thành');
    const athletes = [match.athlete1Id, match.athlete2Id];
    const live = await db.match.findFirst({ where: {
      id: { not: match.id }, status: MatchStatus.RUNNING,
      OR: [{ athlete1Id: { in: athletes } }, { athlete2Id: { in: athletes } }],
    } });
    if (live) throw new ConflictException('VĐV đang thi đấu ở trận khác');
    // Starting is controlled by the operator, independent of planned mat occupancy.
    await this.assertParticipantAvailability(db, match.eventId, match.categoryId, athletes, match.startTime, match.endTime, match.id);
    const category = await db.category.findUnique({ where: { id: match.categoryId } });
    const rule = await db.sportSchedulingRule.findUnique({ where: { eventId_sportId: { eventId: match.eventId, sportId: category.sportId } } });
    const recent = await db.match.findMany({ where: { eventId: match.eventId, status: MatchStatus.FINISHED,
      id: { not: match.id }, OR: [{ athlete1Id: { in: athletes } }, { athlete2Id: { in: athletes } },
        { team1: { members: { some: { athleteId: { in: athletes } } } } },
        { team2: { members: { some: { athleteId: { in: athletes } } } } },
        { participants: { some: { OR: [{ athleteId: { in: athletes } }, { team: { members: { some: { athleteId: { in: athletes } } } } }] } } }],
    }, include: { category: { select: { sportId: true } } } });
    const rules = await db.sportSchedulingRule.findMany({ where: { eventId: match.eventId } });
    if (recent.filter((item) => !isAutomaticScheduleBye(item)).some((item) => {
      const actual = (item.resultData as any)?.scoreboard?.finishedAt;
      const finishedAt = actual ? Date.parse(actual) : item.endTime?.getTime();
      const restMs = Math.max(rule?.minRestMinutes ?? 60, rules.find((entry) => entry.sportId === item.category.sportId)?.minRestMinutes ?? 60) * 60_000;
      return finishedAt && Date.now() - finishedAt < restMs;
    })) throw new ConflictException('VĐV chưa đủ thời gian nghỉ sau trận vừa kết thúc');
  }

  async findAll(query: QueryMatchDto, includeUnpublishedResults = false, allRows = false) {
    const {
      search,
      athleteName,
      opponentName,
      matchNumber,
      round,
      eventId,
      categoryId,
      sportId,
      fopId,
      venue,
      athleteId,
      date,
      status,
      page = 1,
      limit = 20,
      pagination = 'page',
      cursor,
    } = query;

    const where: Prisma.MatchWhereInput = {};

    if (eventId) where.eventId = eventId;
    if (categoryId) where.categoryId = categoryId;
    if (query.categoryIds) {
      const categoryIds = query.categoryIds.split(',').map((id) => id.trim()).filter(Boolean);
      if (categoryIds.length) where.categoryId = { in: categoryIds };
    }
    if (sportId) where.category = { sportId };
    if (fopId) where.fopId = fopId;
    const additionalFilters: Prisma.MatchWhereInput[] = [];
    let byeFilter: Prisma.MatchWhereInput | undefined;
    if (query.federationId) {
      additionalFilters.push({ OR: [
        { athlete1: { federationId: query.federationId } },
        { athlete2: { federationId: query.federationId } },
        { participants: { some: { athlete: { federationId: query.federationId } } } },
      ] });
    }
    if (query.hideByes === 'true') {
      byeFilter = {
        OR: [
          { winMethod: null },
          { NOT: {
            drawId: { not: null },
            status: MatchStatus.FINISHED,
            winMethod: WinMethod.WALKOVVER,
            resultStatus: ResultStatus.DRAFT,
            resultEnteredAt: null,
            OR: [
              { athlete1Id: null, team1Id: null },
              { athlete2Id: null, team2Id: null },
            ],
          } },
        ],
      };
      additionalFilters.push(byeFilter);
    }
    const name = athleteName?.trim();
    const opponent = opponentName?.trim();
    if (name && opponent) {
      additionalFilters.push({
        OR: [
          {
            athlete1: { fullName: { contains: name, mode: 'insensitive' } },
            athlete2: { fullName: { contains: opponent, mode: 'insensitive' } },
          },
          {
            athlete1: { fullName: { contains: opponent, mode: 'insensitive' } },
            athlete2: { fullName: { contains: name, mode: 'insensitive' } },
          },
        ],
      });
    } else if (name || opponent) {
      additionalFilters.push({
        OR: [
          { athlete1: { fullName: { contains: name || opponent, mode: 'insensitive' } } },
          { athlete2: { fullName: { contains: name || opponent, mode: 'insensitive' } } },
        ],
      });
    }
    if (matchNumber !== undefined) where.matchNumber = matchNumber;
    if (round !== undefined) where.round = round;
    if (search?.trim()) {
      const keyword = search.trim();
      additionalFilters.push({
        OR: [
          { athlete1: { fullName: { contains: keyword, mode: 'insensitive' } } },
          { athlete2: { fullName: { contains: keyword, mode: 'insensitive' } } },
          { event: { name: { contains: keyword, mode: 'insensitive' } } },
        ],
      });
    }
    if (athleteId) {
      additionalFilters.push({ OR: [
        { athlete1Id: athleteId }, { athlete2Id: athleteId },
        { team1: { members: { some: { athleteId } } } },
        { team2: { members: { some: { athleteId } } } },
        { participants: { some: { OR: [{ athleteId }, { team: { members: { some: { athleteId } } } }] } } },
      ] });
    }
    if (venue?.trim()) {
      additionalFilters.push({
        OR: [
          { fop: { contains: venue.trim(), mode: 'insensitive' } },
          { fopRecord: { name: { contains: venue.trim(), mode: 'insensitive' } } },
        ],
      });
    }
    if (additionalFilters.length) where.AND = additionalFilters;
    if (status) where.status = status;
    if (date) {
      const startOfDay = new Date(`${date}T00:00:00+07:00`);
      const endOfDay = new Date(startOfDay.getTime() + 86_400_000);
      where.matchDate = {
        gte: startOfDay,
        lt: endOfDay,
      };
    }

    const orderBy: Prisma.MatchOrderByWithRelationInput[] = query.matchNumberOrder ? [
      { matchNumber: { sort: query.matchNumberOrder, nulls: 'last' } },
      { id: 'asc' },
    ] : [
      { matchDate: 'asc' },
      { startTime: 'asc' },
      { matchNumber: 'asc' },
      { id: 'asc' },
    ];

    if (query.scheduleOrder) {
      if (!eventId) throw new BadRequestException('Thứ tự thi đấu cần được lọc theo sự kiện.');
      // Rank the selected categories before applying column filters or pagination.
      const scope: Prisma.MatchWhereInput = {
        eventId, categoryId: where.categoryId, category: where.category,
        ...(byeFilter ? { AND: [byeFilter] } : {}),
      };
      const [scheduled, filtered] = await Promise.all([
        this.prisma.match.findMany({ where: scope, select: { id: true, startTime: true }, orderBy: [
          { startTime: { sort: 'asc', nulls: 'last' } }, { matchDate: 'asc' }, { matchNumber: 'asc' }, { id: 'asc' },
        ] }),
        this.prisma.match.findMany({ where, select: { id: true } }),
      ]);
      const ranks = new Map(scheduled.filter((match) => match.startTime).map((match, index) => [match.id, index + 1]));
      const positions = new Map(scheduled.map((match, index) => [match.id, index]));
      const ordered = filtered.sort((left, right) => {
        const leftRank = ranks.get(left.id);
        const rightRank = ranks.get(right.id);
        if (leftRank === undefined || rightRank === undefined) {
          if (leftRank !== undefined) return -1;
          if (rightRank !== undefined) return 1;
          return (positions.get(left.id) ?? 0) - (positions.get(right.id) ?? 0);
        }
        return query.scheduleOrder === 'desc' ? rightRank - leftRank : leftRank - rightRank;
      });
      const ids = (allRows ? ordered : ordered.slice((page - 1) * limit, page * limit)).map((match) => match.id);
      const rows = await this.prisma.match.findMany({ where: { id: { in: ids } }, include: MATCH_INCLUDE });
      const byId = new Map(rows.map((match) => [match.id, match]));
      return {
        items: ids.map((id) => {
          const match = byId.get(id);
          return match ? { ...(includeUnpublishedResults ? match : this.hideUnpublishedResult(match)), scheduleOrder: ranks.get(id) ?? null } : null;
        }).filter(Boolean),
        meta: { total: ordered.length, page, limit, totalPages: Math.ceil(ordered.length / limit) },
      };
    }

    if (pagination === 'cursor') {
      const rows = await this.prisma.match.findMany({
        where,
        include: MATCH_INCLUDE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: limit + 1,
        orderBy,
      });
      const hasMore = rows.length > limit;
      const rawItems = hasMore ? rows.slice(0, limit) : rows;
      const items = includeUnpublishedResults
        ? rawItems
        : rawItems.map((match) => this.hideUnpublishedResult(match));
      return {
        items,
        meta: {
          limit,
          hasMore,
          nextCursor: hasMore ? rawItems.at(-1)?.id || null : null,
        },
      };
    }

    const skip = (page - 1) * limit;

    const [rawItems, total] = await Promise.all([
      this.prisma.match.findMany({
        where,
        include: MATCH_INCLUDE,
        ...(allRows ? {} : { skip, take: limit }),
        orderBy,
      }),
      this.prisma.match.count({ where }),
    ]);

    return {
      items: includeUnpublishedResults
        ? rawItems
        : rawItems.map((match) => this.hideUnpublishedResult(match)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findScheduleSummary(eventId: string, hideByes = false) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException(`Không tìm thấy sự kiện có mã ${eventId}`);

    const dates = await this.prisma.$queryRaw<Array<{ date: string; count: number }>>(Prisma.sql`
      SELECT (("matchDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS "date",
        COUNT(*)::int AS "count"
      FROM "Match"
      WHERE "eventId" = ${eventId}
        AND (${hideByes} = false OR NOT (
          "drawId" IS NOT NULL AND "status" = 'FINISHED'
          AND "winMethod" IS NOT DISTINCT FROM 'WALKOVVER'::"WinMethod"
          AND "resultStatus" = 'DRAFT' AND "resultEnteredAt" IS NULL
          AND (("athlete1Id" IS NULL AND "team1Id" IS NULL)
            OR ("athlete2Id" IS NULL AND "team2Id" IS NULL))
        ))
      GROUP BY 1
      ORDER BY 1 ASC
    `);
    const liveMatch = await this.prisma.match.findFirst({
      where: { eventId, status: MatchStatus.RUNNING },
      orderBy: [{ matchDate: 'asc' }, { matchNumber: 'asc' }],
      select: {
        id: true,
        categoryId: true,
        matchDate: true,
        category: { select: { sportId: true } },
      },
    });

    return {
      dates,
      total: dates.reduce((sum, item) => sum + Number(item.count), 0),
      liveMatch: liveMatch
        ? {
          id: liveMatch.id,
          date: new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Ho_Chi_Minh',
          }).format(liveMatch.matchDate),
          categoryId: liveMatch.categoryId,
          sportId: liveMatch.category.sportId,
        }
        : null,
    };
  }

  async findOne(id: string, includeUnpublishedResults = false) {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: MATCH_INCLUDE,
    });

    if (!match) {
      throw new NotFoundException(`Không tìm thấy trận đấu có mã ${id}`);
    }

    return includeUnpublishedResults ? match : this.hideUnpublishedResult(match);
  }

  async create(createMatchDto: CreateMatchDto) {
    if (createMatchDto.status === MatchStatus.RUNNING) throw new BadRequestException('Bắt đầu trận qua bảng điểm sau khi xếp lịch');
    const createsResult = [
      'athlete1Score',
      'athlete2Score',
      'athlete1Advantages',
      'athlete2Advantages',
      'athlete1Penalties',
      'athlete2Penalties',
      'winnerId',
      'winMethod',
    ].some((field) => (createMatchDto as unknown as Record<string, unknown>)[field] !== undefined);
    if (createsResult || createMatchDto.status === MatchStatus.FINISHED) {
      throw new BadRequestException(
        'Hãy tạo trận ở trạng thái chưa hoàn thành và nhập kết quả qua quy trình Kết quả & phê duyệt',
      );
    }
    if (createMatchDto.athlete1Id && createMatchDto.athlete1Id === createMatchDto.athlete2Id) {
      throw new BadRequestException('Hai vận động viên của một trận phải khác nhau');
    }
    const [category, event] = await Promise.all([
      this.prisma.category.findFirst({
        where: {
          id: createMatchDto.categoryId,
          events: { some: { id: createMatchDto.eventId } },
        },
        select: { matchDurationSeconds: true },
      }),
      this.prisma.event.findUnique({
        where: { id: createMatchDto.eventId },
        select: { startDate: true, endDate: true },
      }),
    ]);
    if (!category) {
      throw new BadRequestException('Hạng đấu không thuộc sự kiện đã chọn');
    }
    if (!event) throw new NotFoundException('Không tìm thấy sự kiện đã chọn');

    if (createMatchDto.fopId) {
      const fopExists = await this.prisma.fop.count({
        where: { id: createMatchDto.fopId, eventId: createMatchDto.eventId },
      });
      if (!fopExists) {
        throw new BadRequestException('Sân/FOP không thuộc sự kiện đã chọn');
      }
    }

    const participantIds = Array.from(new Set([
      createMatchDto.athlete1Id,
      createMatchDto.athlete2Id,
      createMatchDto.winnerId,
    ].filter((id): id is string => Boolean(id))));
    await this.assertParticipantsRegistered(
      this.prisma,
      createMatchDto.eventId,
      createMatchDto.categoryId,
      participantIds,
    );

    const startTime = createMatchDto.startTime
      ? new Date(createMatchDto.startTime)
      : undefined;
    let endTime = createMatchDto.endTime
      ? new Date(createMatchDto.endTime)
      : undefined;
    if (startTime && !endTime) {
      const durationSeconds = category.matchDurationSeconds || 300;
      endTime = new Date(startTime.getTime() + durationSeconds * 1_000);
    }
    const matchDate = new Date(createMatchDto.matchDate);
    this.assertInsideEventDates(event, matchDate, startTime, endTime);
    if (startTime && endTime) {
      await this.assertFopAvailability(
        this.prisma,
        createMatchDto.eventId,
        createMatchDto.fopId,
        startTime,
        endTime,
      );
      await this.assertParticipantAvailability(
        this.prisma,
        createMatchDto.eventId,
        createMatchDto.categoryId,
        participantIds,
        startTime,
        endTime,
      );
    }

    const data: Prisma.MatchCreateInput = {
      event: { connect: { id: createMatchDto.eventId } },
      category: { connect: { id: createMatchDto.categoryId } },
      matchDate,
      ...(createMatchDto.divisionId && {
        division: { connect: { id: createMatchDto.divisionId } },
      }),
      ...(createMatchDto.drawId && {
        draw: { connect: { id: createMatchDto.drawId } },
      }),
      matchNumber: createMatchDto.matchNumber,
      fop: createMatchDto.fop,
      ...(createMatchDto.fopId && {
        fopRecord: { connect: { id: createMatchDto.fopId } },
      }),
      startTime,
      endTime,
      athlete1: createMatchDto.athlete1Id
        ? { connect: { id: createMatchDto.athlete1Id } }
        : undefined,
      athlete2: createMatchDto.athlete2Id
        ? { connect: { id: createMatchDto.athlete2Id } }
        : undefined,
      athlete1Score: createMatchDto.athlete1Score ?? 0,
      athlete2Score: createMatchDto.athlete2Score ?? 0,
      athlete1Advantages: createMatchDto.athlete1Advantages ?? 0,
      athlete2Advantages: createMatchDto.athlete2Advantages ?? 0,
      athlete1Penalties: createMatchDto.athlete1Penalties ?? 0,
      athlete2Penalties: createMatchDto.athlete2Penalties ?? 0,
      status: createMatchDto.status,
      matchType: createMatchDto.matchType,
      winner: createMatchDto.winnerId
        ? { connect: { id: createMatchDto.winnerId } }
        : undefined,
      winMethod: createMatchDto.winMethod,
      round: createMatchDto.round,
      bracketPosition: createMatchDto.bracketPosition,
      winnerToMatch: createMatchDto.winnerToMatchId
        ? { connect: { id: createMatchDto.winnerToMatchId } }
        : undefined,
      winnerToSide: createMatchDto.winnerToSide,
      loserToMatch: createMatchDto.loserToMatchId
        ? { connect: { id: createMatchDto.loserToMatchId } }
        : undefined,
      loserToSide: createMatchDto.loserToSide,
      pool: createMatchDto.pool,
      notes: createMatchDto.notes,
    };

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${createMatchDto.eventId}))`;
        const created = await transaction.match.create({ data, include: MATCH_INCLUDE });
        if (startTime && endTime) await assertContentSchedule(transaction, createMatchDto.eventId, [created.id]);
        return created;
      });
    } catch (error) {
      this.rethrowScheduleConstraint(error);
    }
  }

  async update(id: string, updateMatchDto: UpdateMatchDto) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM "Match" WHERE id = ${id} FOR UPDATE`;
      const previous = await transaction.match.findUnique({ where: { id } });
      if (!previous) {
        throw new NotFoundException(`Không tìm thấy trận đấu có mã ${id}`);
      }
      if (updateMatchDto.status === MatchStatus.RUNNING) throw new BadRequestException('Bắt đầu trận qua bảng điểm');
      if (previous.status === MatchStatus.RUNNING) throw new BadRequestException('Trận đang thi đấu; sử dụng bảng điểm để điều hành');
      const changesResult = [
        'athlete1Score',
        'athlete2Score',
        'athlete1Advantages',
        'athlete2Advantages',
        'athlete1Penalties',
        'athlete2Penalties',
        'winnerId',
        'winMethod',
      ].some((field) => (updateMatchDto as Record<string, unknown>)[field] !== undefined);
      const changesFinishedStatus = updateMatchDto.status !== undefined
        && updateMatchDto.status !== previous.status
        && (updateMatchDto.status === MatchStatus.FINISHED || previous.status === MatchStatus.FINISHED);
      if (changesResult || changesFinishedStatus) {
        throw new BadRequestException(
          'Kết quả và trạng thái hoàn thành chỉ được thay đổi qua quy trình Kết quả & phê duyệt',
        );
      }
      if (previous.resultStatus === ResultStatus.LOCKED && changesResult) {
        throw new BadRequestException('Kết quả đã khóa; phải mở khóa qua quy trình phê duyệt trước khi sửa');
      }
      const changesSchedule = [
        'eventId',
        'categoryId',
        'matchDate',
        'startTime',
        'endTime',
        'fopId',
        'fop',
      ].some((field) => (updateMatchDto as Record<string, unknown>)[field] !== undefined);
      if (previous.schedulePlanId && (changesSchedule || ['drawId', 'round', 'bracketPosition', 'matchNumber', 'winnerToMatchId', 'loserToMatchId']
        .some((field) => (updateMatchDto as Record<string, unknown>)[field] !== undefined))) {
        throw new ConflictException(`Trận thuộc lịch ${previous.schedulePlanId}. Mở Sắp xếp trận đấu để chỉnh sửa.`);
      }
      if (previous.status === MatchStatus.FINISHED && changesSchedule) throw new BadRequestException('Không đổi lịch sử thời gian của trận đã kết thúc.');
      if (previous.scheduleLocked && changesSchedule) {
        throw new BadRequestException('Lịch thi đấu đã khóa; hãy mở khóa lịch trước khi thay đổi');
      }

      const resultingEventId = updateMatchDto.eventId || previous.eventId;
      const resultingCategoryId = updateMatchDto.categoryId || previous.categoryId;
      const resultingAthlete1Id = updateMatchDto.athlete1Id !== undefined
        ? updateMatchDto.athlete1Id
        : previous.athlete1Id;
      const resultingAthlete2Id = updateMatchDto.athlete2Id !== undefined
        ? updateMatchDto.athlete2Id
        : previous.athlete2Id;
      if (resultingAthlete1Id && resultingAthlete1Id === resultingAthlete2Id) {
        throw new BadRequestException('Hai vận động viên của một trận phải khác nhau');
      }
      const [category, event] = await Promise.all([
        transaction.category.findFirst({
          where: {
            id: resultingCategoryId,
            events: { some: { id: resultingEventId } },
          },
          select: { matchDurationSeconds: true },
        }),
        transaction.event.findUnique({
          where: { id: resultingEventId },
          select: { startDate: true, endDate: true },
        }),
      ]);
      if (!category) {
        throw new BadRequestException('Hạng đấu không thuộc sự kiện đã chọn');
      }
      if (!event) throw new NotFoundException('Không tìm thấy sự kiện đã chọn');

      const resultingFopId = updateMatchDto.fopId !== undefined
        ? updateMatchDto.fopId
        : previous.fopId;
      if (resultingFopId) {
        const fopExists = await transaction.fop.count({
          where: { id: resultingFopId, eventId: resultingEventId },
        });
        if (!fopExists) {
          throw new BadRequestException('Sân/FOP không thuộc sự kiện đã chọn');
        }
      }

      const participantIds = Array.from(new Set([
        updateMatchDto.athlete1Id !== undefined
          ? updateMatchDto.athlete1Id
          : previous.athlete1Id,
        updateMatchDto.athlete2Id !== undefined
          ? updateMatchDto.athlete2Id
          : previous.athlete2Id,
        updateMatchDto.winnerId !== undefined
          ? updateMatchDto.winnerId
          : previous.winnerId,
      ].filter((athleteId): athleteId is string => Boolean(athleteId))));
      await this.assertParticipantsRegistered(
        transaction,
        resultingEventId,
        resultingCategoryId,
        participantIds,
      );

      const resultingStartTime = updateMatchDto.startTime !== undefined
        ? updateMatchDto.startTime ? new Date(updateMatchDto.startTime) : null
        : previous.startTime;
      let resultingEndTime = updateMatchDto.endTime !== undefined
        ? updateMatchDto.endTime ? new Date(updateMatchDto.endTime) : null
        : previous.endTime;
      if (updateMatchDto.startTime && updateMatchDto.endTime === undefined) {
        resultingEndTime = new Date(
          new Date(updateMatchDto.startTime).getTime() + (category.matchDurationSeconds || 300) * 1_000,
        );
      }
      const resultingMatchDate = updateMatchDto.matchDate
        ? new Date(updateMatchDto.matchDate)
        : previous.matchDate;
      this.assertInsideEventDates(event, resultingMatchDate, resultingStartTime, resultingEndTime);
      if (resultingStartTime && resultingEndTime) {
        await this.assertFopAvailability(
          transaction,
          resultingEventId,
          resultingFopId,
          resultingStartTime,
          resultingEndTime,
          id,
        );
        const scheduledAthleteIds = Array.from(new Set([
          resultingAthlete1Id,
          resultingAthlete2Id,
        ].filter((athleteId): athleteId is string => Boolean(athleteId))));
        await this.assertParticipantAvailability(
          transaction,
          resultingEventId,
          resultingCategoryId,
          scheduledAthleteIds,
          resultingStartTime,
          resultingEndTime,
          id,
        );
      }

      const data: Prisma.MatchUpdateInput = {};

      if (updateMatchDto.eventId) {
        data.event = { connect: { id: updateMatchDto.eventId } };
      }
      if (updateMatchDto.categoryId) {
        data.category = { connect: { id: updateMatchDto.categoryId } };
      }
      if (updateMatchDto.divisionId !== undefined) {
        data.division = updateMatchDto.divisionId
          ? { connect: { id: updateMatchDto.divisionId } }
          : { disconnect: true };
      }
      if (updateMatchDto.drawId !== undefined) {
        data.draw = updateMatchDto.drawId
          ? { connect: { id: updateMatchDto.drawId } }
          : { disconnect: true };
      }
      if (updateMatchDto.matchNumber !== undefined) {
        data.matchNumber = updateMatchDto.matchNumber;
      }
      if (updateMatchDto.fop !== undefined) data.fop = updateMatchDto.fop;
      if (updateMatchDto.fopId !== undefined) {
        data.fopRecord = updateMatchDto.fopId
          ? { connect: { id: updateMatchDto.fopId } }
          : { disconnect: true };
      }
      if (updateMatchDto.matchDate) data.matchDate = new Date(updateMatchDto.matchDate);
      if (updateMatchDto.startTime !== undefined) {
        data.startTime = updateMatchDto.startTime
          ? new Date(updateMatchDto.startTime)
          : null;
      }
      if (updateMatchDto.endTime !== undefined) {
        data.endTime = updateMatchDto.endTime ? new Date(updateMatchDto.endTime) : null;
      } else if (updateMatchDto.startTime) {
        const durationSeconds = category.matchDurationSeconds || 300;
        data.endTime = new Date(
          new Date(updateMatchDto.startTime).getTime() + durationSeconds * 1_000,
        );
      }
      if (updateMatchDto.athlete1Id !== undefined) {
        data.athlete1 = updateMatchDto.athlete1Id
          ? { connect: { id: updateMatchDto.athlete1Id } }
          : { disconnect: true };
      }
      if (updateMatchDto.athlete2Id !== undefined) {
        data.athlete2 = updateMatchDto.athlete2Id
          ? { connect: { id: updateMatchDto.athlete2Id } }
          : { disconnect: true };
      }
      if (updateMatchDto.athlete1Score !== undefined) data.athlete1Score = updateMatchDto.athlete1Score;
      if (updateMatchDto.athlete2Score !== undefined) data.athlete2Score = updateMatchDto.athlete2Score;
      if (updateMatchDto.athlete1Advantages !== undefined) data.athlete1Advantages = updateMatchDto.athlete1Advantages;
      if (updateMatchDto.athlete2Advantages !== undefined) data.athlete2Advantages = updateMatchDto.athlete2Advantages;
      if (updateMatchDto.athlete1Penalties !== undefined) data.athlete1Penalties = updateMatchDto.athlete1Penalties;
      if (updateMatchDto.athlete2Penalties !== undefined) data.athlete2Penalties = updateMatchDto.athlete2Penalties;
      if (updateMatchDto.status) data.status = updateMatchDto.status;
      if (updateMatchDto.matchType) data.matchType = updateMatchDto.matchType;
      if (updateMatchDto.winnerId !== undefined) {
        data.winner = updateMatchDto.winnerId
          ? { connect: { id: updateMatchDto.winnerId } }
          : { disconnect: true };
      }
      if (updateMatchDto.winMethod !== undefined) data.winMethod = updateMatchDto.winMethod;
      if (updateMatchDto.round !== undefined) data.round = updateMatchDto.round;
      if (updateMatchDto.bracketPosition !== undefined) data.bracketPosition = updateMatchDto.bracketPosition;
      if (updateMatchDto.winnerToMatchId !== undefined) {
        data.winnerToMatch = updateMatchDto.winnerToMatchId
          ? { connect: { id: updateMatchDto.winnerToMatchId } }
          : { disconnect: true };
      }
      if (updateMatchDto.winnerToSide !== undefined) data.winnerToSide = updateMatchDto.winnerToSide;
      if (updateMatchDto.loserToMatchId !== undefined) {
        data.loserToMatch = updateMatchDto.loserToMatchId
          ? { connect: { id: updateMatchDto.loserToMatchId } }
          : { disconnect: true };
      }
      if (updateMatchDto.loserToSide !== undefined) data.loserToSide = updateMatchDto.loserToSide;
      if (updateMatchDto.pool !== undefined) data.pool = updateMatchDto.pool;
      if (updateMatchDto.notes !== undefined) data.notes = updateMatchDto.notes;

      const updated = await transaction.match.update({ where: { id }, data });
      if (updated.startTime && updated.endTime && (changesSchedule || updateMatchDto.athlete1Id !== undefined || updateMatchDto.athlete2Id !== undefined)) {
        await assertContentSchedule(transaction, updated.eventId, [id]);
      }
      await this.syncProgression(transaction, previous, updated);

      return transaction.match.findUnique({
        where: { id },
        include: MATCH_INCLUDE,
      });
      });
    } catch (error) {
      this.rethrowScheduleConstraint(error);
    }
  }

  async remove(id: string) {
    const match = await this.findOne(id);
    if (match.schedulePlanId) throw new ConflictException('Trận thuộc lịch đã áp dụng; mở Sắp xếp trận đấu để kiểm tra.');
    return this.prisma.match.delete({ where: { id } });
  }

  async findGroupedByEventId(eventId: string, includeUnpublishedResults = false) {
    const matches = await this.prisma.match.findMany({
      where: { eventId },
      include: MATCH_INCLUDE,
      orderBy: [{ matchDate: 'asc' }, { categoryId: 'asc' }, { matchNumber: 'asc' }],
    });

    const grouped: Record<string, Record<string, Match[]>> = {};

    for (const match of matches) {
      const dateKey = new Date(match.matchDate).toISOString().split('T')[0];
      const categoryKey = match.category?.name || match.categoryId;

      if (!grouped[dateKey]) {
        grouped[dateKey] = {};
      }
      if (!grouped[dateKey][categoryKey]) {
        grouped[dateKey][categoryKey] = [];
      }
      grouped[dateKey][categoryKey].push(
        (includeUnpublishedResults ? match : this.hideUnpublishedResult(match)) as Match,
      );
    }

    return grouped;
  }

  async findDraws(eventId: string, categoryId: string, includeUnpublishedResults = false) {
    const draws = await this.prisma.draw.findMany({
      where: { eventId, categoryId },
      include: {
        fops: {
          orderBy: { name: 'asc' },
        },
        matches: {
          include: MATCH_INCLUDE,
          orderBy: [{ round: 'asc' }, { bracketPosition: 'asc' }, { matchNumber: 'asc' }],
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return {
      eventId,
      categoryId,
      draws: includeUnpublishedResults
        ? draws
        : draws.map((draw) => ({
          ...draw,
          matches: draw.matches.map((match) => this.hideUnpublishedResult(match)),
        })),
    };
  }

  private hasCompetitionActivity(match: Match & { _count: { resultRevisions: number } }) {
    if (match.status === MatchStatus.RUNNING || match.resultVersion > 0 || match._count.resultRevisions > 0
      || match.resultStatus !== ResultStatus.DRAFT || match.resultEnteredAt || match.refereeConfirmedAt
      || match.approvedAt || match.resultPublishedAt || match.resultLockedAt
      || (match.resultData as Record<string, unknown> | null)?.scoreboard
      || [match.athlete1Score, match.athlete2Score, match.athlete1Advantages, match.athlete2Advantages,
        match.athlete1Penalties, match.athlete2Penalties].some((value) => value !== 0)) return true;
    // Generated byes (including empty loser paths) finish without a real bout.
    const automaticBye = match.status === MatchStatus.FINISHED && match.winMethod === WinMethod.WALKOVVER
      && [match.athlete1Id, match.athlete2Id, match.team1Id, match.team2Id].filter(Boolean).length <= 1;
    return !automaticBye && (match.status === MatchStatus.FINISHED || !!match.winnerId || !!match.winnerTeamId || !!match.winMethod);
  }

  private async loadDrawState(db: PrismaService | Prisma.TransactionClient, eventId: string, categoryId: string) {
    const category = await db.category.count({ where: { id: categoryId, events: { some: { id: eventId } } } });
    if (!category) throw new NotFoundException('Không tìm thấy hạng đấu trong sự kiện');
    const [draws, groups, matches] = await Promise.all([
      db.draw.findMany({ where: { eventId, categoryId }, select: { id: true, name: true, createdAt: true }, orderBy: { id: 'asc' } }),
      db.roundRobinGroup.findMany({ where: { eventId, categoryId }, select: { id: true, name: true, createdAt: true }, orderBy: { id: 'asc' } }),
      db.match.findMany({ where: { eventId, categoryId }, include: { _count: { select: { resultRevisions: true } } }, orderBy: { id: 'asc' } }),
    ]);
    const drawIds = new Set(draws.map((draw) => draw.id));
    const groupIds = new Set(groups.map((group) => group.id));
    const generatedMatches = matches.filter((match) => (match.drawId && drawIds.has(match.drawId))
      || (match.roundRobinGroupId && groupIds.has(match.roundRobinGroupId)));
    const matchIds = generatedMatches.map((match) => match.id);
    const matchIdSet = new Set(matchIds);
    const started = matches.some((match) => this.hasCompetitionActivity(match));
    const externalLinks = generatedMatches.some((match) => [match.winnerToMatchId, match.loserToMatchId]
      .some((id) => id && !matchIdSet.has(id))) || !!await db.match.count({ where: {
      id: { notIn: matchIds }, OR: [
        { winnerToMatchId: { in: matchIds } }, { loserToMatchId: { in: matchIds } },
        { drawId: { in: [...drawIds] } }, { roundRobinGroupId: { in: [...groupIds] } },
      ],
    } });
    const hasDraws = draws.length > 0 || groups.length > 0;
    const reason = !hasDraws ? 'Chưa có nhánh đấu để thu hồi.' : started
      ? 'Hạng đấu đã có trận bắt đầu hoặc ghi nhận kết quả; không thể thu hồi nhánh.' : externalLinks
        ? 'Nhánh đang liên kết với trận ngoài phạm vi thu hồi; không thể thu hồi.' : null;
    const version = createHash('sha256').update(JSON.stringify({ draws, groups,
      matches: generatedMatches.map((match) => ({ id: match.id, createdAt: match.createdAt })) })).digest('hex');
    return { draws, groups, generatedMatches, state: { version, canRevert: hasDraws && !reason,
      drawCount: draws.length, groupCount: groups.length, matchCount: generatedMatches.length, reason } };
  }

  async getDrawState(eventId: string, categoryId: string) {
    return (await this.loadDrawState(this.prisma, eventId, categoryId)).state;
  }

  async revertDraw(eventId: string, categoryId: string, version: string, actorUserId: string) {
    return this.drawTransaction(eventId, async (db) => {
      if (await db.matchScheduleCategory.findUnique({ where: { eventId_categoryId: { eventId, categoryId } } })) {
        throw new ConflictException('Hạng đấu đang thuộc lịch đã áp dụng; không thể thu hồi nhánh.');
      }
      // Result entry also locks individual matches. Lock every match of this
      // category before checking, so an in-flight result cannot be deleted.
      await db.$queryRaw`SELECT "id" FROM "Match" WHERE "eventId" = ${eventId}
        AND "categoryId" = ${categoryId} ORDER BY "id" FOR UPDATE`;
      const { draws, groups, generatedMatches, state } = await this.loadDrawState(db, eventId, categoryId);
      if (!state.canRevert) throw new ConflictException(state.reason);
      if (state.version !== version) throw new ConflictException('Nhánh đấu đã thay đổi. Hãy tải lại trước khi thu hồi');
      const configurations = await db.drawPreconfiguration.findMany({ where: { eventId, categoryId } });
      for (const configuration of configurations) {
        const revision = configuration.revision + 1;
        await db.drawPreconfiguration.update({ where: { id: configuration.id }, data: {
          revision, inputVersion: null, plan: Prisma.DbNull, slots: Prisma.DbNull, previewedAt: null,
        } });
        await db.drawPreconfigurationHistory.create({ data: { configurationId: configuration.id,
          actorUserId, action: 'REVERT', revision,
          snapshot: this.json({ draws, groups, removedMatchIds: generatedMatches.map((match) => match.id),
            previousInputVersion: configuration.inputVersion }) } });
      }
      await db.match.deleteMany({ where: { id: { in: generatedMatches.map((match) => match.id) } } });
      await db.draw.deleteMany({ where: { id: { in: draws.map((draw) => draw.id) } } });
      await db.roundRobinGroup.deleteMany({ where: { id: { in: groups.map((group) => group.id) } } });
      await db.auditLog.create({ data: { actorUserId, action: 'REVERT_DRAW', entityType: 'CategoryDraw', entityId: categoryId,
        metadata: { eventId, drawCount: draws.length, groupCount: groups.length, matchCount: generatedMatches.length } } });
      return { eventId, categoryId, removedDraws: draws.length, removedGroups: groups.length,
        removedMatches: generatedMatches.length };
    });
  }

  private preconfigurationKey(eventId: string, categoryId: string, drawType: DrawType) {
    return { eventId_categoryId_drawType: { eventId, categoryId, drawType } };
  }

  private assertPreconfigurationType(drawType: DrawType) {
    if (!preconfigurationDrawTypes.includes(drawType)) {
      throw new BadRequestException('Thể thức cấu hình trận đấu không được hỗ trợ');
    }
  }

  // Serialize draw operations per event, including allocation of match numbers.
  private async drawTransaction<T>(eventId: string, work: (db: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await this.prisma.$transaction(async (db) => {
        // Use the same event lock as scoreboard START/FINISH before locking matches.
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${eventId}))`;
        await db.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
        return work(db);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (['P2034', 'P2002'].includes(error.code)
        || (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))))) {
        throw new ConflictException('Dữ liệu vừa thay đổi. Hãy tải lại và thử lại');
      }
      throw error;
    }
  }

  private async loadDrawInput(db: Prisma.TransactionClient | PrismaService, eventId: string, categoryId: string) {
    const [event, category, storedEntries, fops] = await Promise.all([
      db.event.findUnique({ where: { id: eventId }, select: { id: true, startDate: true, endDate: true, ageLimitMode: true, minAge: true, maxAge: true } }),
      db.category.findFirst({ where: { id: categoryId, events: { some: { id: eventId } } } }),
      db.competitionEntry.findMany({
        where: { eventId, categoryId }, orderBy: { id: 'asc' },
        include: { team: { include: { members: { include: { athlete: { include: { country: { select: { code: true, name: true, flagUrl: true } }, federation: { select: { id: true, name: true } } } } } } } }, athlete: { include: {
          country: { select: { code: true, name: true, flagUrl: true } },
          federation: { select: { id: true, name: true } },
        } } },
      }),
      db.fop.findMany({ where: { eventId }, orderBy: { id: 'asc' }, select: { id: true, name: true } }),
    ]);
    if (!event) throw new NotFoundException('Không tìm thấy sự kiện');
    if (!category) throw new BadRequestException('Hạng đấu không thuộc sự kiện');
    const pairCategory = ['DUO', 'SHOW'].includes(category.discipline || '');
    // The placement algorithm uses a participant ID for either an athlete or a team.
    // Team IDs are translated back to team foreign keys when persisting matches.
    const entries = storedEntries.map((entry) => pairCategory && entry.team ? { ...entry,
      athleteId: entry.teamId,
      athlete: entry.team.members[0] ? { ...entry.team.members[0].athlete, id: entry.team.id,
        fullName: entry.team.members.map((member) => member.athlete.fullName).join(' / '),
        countryId: entry.team.countryId, federationId: entry.team.members[0].athlete.federationId } : null,
    } : entry);
    // CompetitionEntry records registration for this event/category; legacy
    // athlete links must not exclude verified entries from the draw roster.
    const eligibleEntries = entries.filter((entry) => entry.status === EntryStatus.VERIFIED
      && (pairCategory ? entry.type === 'TEAM' && entry.team?.members.length === 2 : entry.type === 'INDIVIDUAL') && entry.athlete);
    return { event, category, entries, eligibleEntries, fops };
  }

  private assertDrawEntryEligibility(entry: Awaited<ReturnType<MatchesService['loadDrawInput']>>['entries'][number],
    input: Awaited<ReturnType<MatchesService['loadDrawInput']>>) {
    const category = { ...input.category, ...resolveEventAgeLimits(input.event, input.category) };
    if (['DUO', 'SHOW'].includes(category.discipline || '')) {
      if (!entry.team || entry.team.members.length !== 2 || new Set(entry.team.members.map((member) => member.athleteId)).size !== 2) {
        throw new BadRequestException('DUO/SHOW cần đội có đúng hai VĐV khác nhau');
      }
      if (category.gender === 'MIXED' && new Set(entry.team.members.map((member) => member.athlete.gender)).size !== 2) {
        throw new BadRequestException('Hạng đôi nam nữ cần một VĐV nam và một VĐV nữ');
      }
      for (const member of entry.team.members) assertAthleteEligibility(member.athlete, category, input.event.startDate);
    } else assertAthleteEligibility(entry.athlete!, category, input.event.startDate);
  }

  private inputVersion(input: Awaited<ReturnType<MatchesService['loadDrawInput']>>, pairs: unknown, options: unknown) {
    // Include the whole roster (also ineligible entries) to detect additions,
    // withdrawals, eligibility edits, seed edits and restored values after edits.
    const canonical = (value: any): any => {
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) return value.map(canonical);
      if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
      return value;
    };
    const type = (options as { type?: DrawType })?.type;
    return createHash('sha256').update(JSON.stringify(canonical({
      algorithm: type === DrawType.REPECHAGE || type === DrawType.REPECHAGE_QUARTERFINALS ? 5 : 3,
      event: input.event, category: input.category, entries: input.entries, fops: input.fops, pairs, options,
    }))).digest('hex');
  }

  private validatePairs(input: Awaited<ReturnType<MatchesService['loadDrawInput']>>, pairs: PreconfiguredPairDto[],
    drawType: DrawType, groupCount = 1) {
    const eligible = new Set(input.eligibleEntries.map((entry) => entry.id));
    const used = new Set<string>();
    for (const pair of pairs) {
      for (const id of [pair.entry1Id, pair.entry2Id]) {
        if (!eligible.has(id)) throw new BadRequestException('Cặp đặt trước phải dùng lượt đăng ký đã xác minh đúng sự kiện và hạng đấu');
        const entry = input.eligibleEntries.find((item) => item.id === id)!;
        this.assertDrawEntryEligibility(entry, input);
        if (used.has(id)) throw new BadRequestException('VĐV không được xuất hiện trong nhiều cặp hoặc đấu với chính mình');
        used.add(id);
      }
    }
    if (drawType === DrawType.ROUND_ROBIN_POOL || ((drawType === DrawType.REPECHAGE || drawType === DrawType.REPECHAGE_QUARTERFINALS) && input.eligibleEntries.length < 6)) {
      // Empty rosters can still have an empty configuration while registrations arrive.
      if (!pairs.length && input.eligibleEntries.length < 2) return;
      const sizes = this.roundRobinGroupSizes(input.eligibleEntries.length, drawType !== DrawType.ROUND_ROBIN_POOL ? 1 : groupCount);
      if (pairs.length > sizes.reduce((sum, size) => sum + Math.floor(size / 2), 0)) {
        throw new BadRequestException('Quá nhiều cặp đặt trước cho lượt đầu của các bảng; hãy giảm số cặp hoặc số bảng');
      }
      return;
    }
    const size = this.nextPowerOfTwo(input.eligibleEntries.length);
    if (pairs.length > Math.max(0, input.eligibleEntries.length - size / 2)) {
      throw new BadRequestException('Số cặp đặt trước không cho phép phân bổ miễn đấu hợp lệ; hãy giảm số cặp');
    }
  }

  private placePreconfiguredPairs(athletes: SeedAthlete[], size: number, mode: SeedingMode, pairs: string[][]) {
    const baseline = this.seedAthletes(athletes, size, mode);
    if (!pairs.length) return baseline;
    const positions = new Map(baseline.flatMap((athlete, index) => athlete ? [[athlete.id, index] as const] : []));
    const byId = new Map(athletes.map((athlete) => [athlete.id, athlete]));
    const pairedIds = new Set(pairs.flat());
    const units = [
      ...pairs.map((pair) => pair.map((id) => byId.get(id)!)),
      ...baseline.filter((athlete): athlete is SeedAthlete => !!athlete && !pairedIds.has(athlete.id)).map((athlete) => [athlete]),
    ].sort((left, right) => Math.min(...left.map((athlete) => athlete.seed ?? Number.MAX_SAFE_INTEGER))
      - Math.min(...right.map((athlete) => athlete.seed ?? Number.MAX_SAFE_INTEGER)) || right.length - left.length);
    const slots: Array<SeedAthlete | null> = Array(size).fill(null);
    const roundCount = Math.log2(size);
    const seedCounts = Array.from({ length: roundCount + 1 }, (_, round) => Array<number>(size / 2 ** round).fill(0));
    let remaining = athletes.length;
    let remainingPairs = pairs.length;
    for (const unit of units) {
      const anchor = [...unit].sort((left, right) => (left.seed ?? Number.MAX_SAFE_INTEGER)
        - (right.seed ?? Number.MAX_SAFE_INTEGER))[0];
      const preferred = positions.get(anchor.id)!;
      remaining -= unit.length;
      if (unit.length === 2) remainingPairs -= 1;
      const emptyMatches = slots.filter((value, index) => index % 2 === 0 && !value && !slots[index + 1]).length;
      const candidates = slots.flatMap((value, index) => {
        if (value || (unit.length === 2 && (index % 2 !== 0 || slots[index + 1]))) return [];
        const empty = !slots[index ^ 1];
        const emptyAfter = emptyMatches - (empty ? 1 : 0);
        // Leave a whole match for every pending pair, and an athlete for every
        // empty match. This prevents empty-vs-empty matches even with many byes.
        if (emptyAfter < remainingPairs || emptyAfter > remaining) return [];
        const seedEncounters = anchor.seed == null ? [] : Array.from({ length: roundCount }, (_, round) =>
          seedCounts[round + 1][Math.floor(index / 2 ** (round + 1))] - seedCounts[round][Math.floor(index / 2 ** round)]);
        const partner = slots[index ^ 1];
        const groupKey = (athlete: SeedAthlete) => mode === 'COUNTRY_SEPARATED'
          ? athlete.countryId : athlete.federationId || athlete.countryId;
        const sameGroup = unit.length === 1 && partner && (mode === 'COUNTRY_SEPARATED' || mode === 'FEDERATION_SEPARATED')
          && groupKey(anchor) === groupKey(partner) ? 1 : 0;
        return [{ index, seedEncounters, sameGroup, preference: unit.length === 2
          ? Math.floor(index / 2) === Math.floor(preferred / 2) : index === preferred }];
      });
      candidates.sort((left, right) => {
        // Maximize the earliest possible meeting with already placed seeds,
        // then the next earliest. A forced pair is indivisible and takes priority.
        for (let index = 0; index < left.seedEncounters.length; index += 1) {
          if (left.seedEncounters[index] !== right.seedEncounters[index]) return left.seedEncounters[index] - right.seedEncounters[index];
        }
        return left.sameGroup - right.sameGroup || Number(right.preference) - Number(left.preference) || left.index - right.index;
      });
      const selected = candidates[0];
      if (!selected) throw new BadRequestException('Không thể bố trí miễn đấu với các cặp đã chọn');
      unit.forEach((athlete, offset) => {
        slots[selected.index + offset] = athlete;
        if (athlete.seed != null) seedCounts.forEach((counts, round) => {
          counts[Math.floor((selected.index + offset) / 2 ** round)] += 1;
        });
      });
    }
    return slots;
  }

  private buildDrawPlan(input: Awaited<ReturnType<MatchesService['loadDrawInput']>>, dto: GenerateDrawDto,
    pairs: PreconfiguredPairDto[]) {
    if (dto.type === DrawType.ROUND_ROBIN_POOL) return this.buildRoundRobinPlan(input, dto, pairs);
    const isRepechage = dto.type === DrawType.REPECHAGE || dto.type === DrawType.REPECHAGE_QUARTERFINALS;
    if (isRepechage && input.eligibleEntries.length < 6) return this.buildRoundRobinPlan(input, { ...dto, groupCount: 1 }, pairs);
    const type = dto.type || DrawType.MAIN_TREE;
    const athletes = dto.athleteIds.map((id) => {
      const entry = input.eligibleEntries.find((entry) => entry.athleteId === id)!;
      return { id, countryId: entry.athlete!.countryId, federationId: entry.athlete!.federationId, seed: entry.seed };
    });
    const size = this.nextPowerOfTwo(athletes.length);
    const pairAthletes = pairs.map((pair) => [pair.entry1Id, pair.entry2Id]
      .map((id) => input.eligibleEntries.find((entry) => entry.id === id)!.athleteId!));
    const slots = this.placePreconfiguredPairs(athletes, size, dto.seedingMode || 'STANDARD', pairAthletes);
    const names = [...new Set((dto.fops?.length ? dto.fops : dto.fop ? [dto.fop] : []).map((name) => name.trim()).filter(Boolean))];
    const fops = names.map((name) => {
      const fop = input.fops.find((item) => item.name === name);
      if (!fop) throw new BadRequestException('Sàn/FOP không thuộc sự kiện');
      return fop;
    });
    const baseName = dto.name?.trim() || `${input.category.name} - MAIN TREE POOL 1`;
    const mainId = randomUUID();
    const number = { value: dto.startMatchNumber || 1 };
    const common = { eventId: input.event.id, categoryId: input.category.id, divisionId: dto.divisionId,
      matchDate: input.event.startDate, fops, fopCursor: { value: 0 }, number };
    const rounds = this.buildWinnerBracket({ ...common, drawId: mainId, slots });
    const matches = rounds.flat();
    const draws = [{ id: mainId, name: baseName, type: DrawType.MAIN_TREE as DrawType, bracketSize: size, sortOrder: 10 }];
    if (type === DrawType.DOUBLE_ELIMINATION || isRepechage) {
      const loserId = randomUUID();
      const secondary = { ...common, drawId: loserId, winnersRounds: rounds, fromQuarterfinals: type === DrawType.REPECHAGE_QUARTERFINALS };
      matches.push(...(type === DrawType.DOUBLE_ELIMINATION
        ? this.buildDoubleEliminationBracket(secondary) : this.buildRepechageBracket(secondary)));
      draws.push({ id: loserId, name: `${baseName} - ${isRepechage ? (type === DrawType.REPECHAGE_QUARTERFINALS ? 'Quaterfinals Repechage' : 'REPECHAGE') : 'DOUBLE-ELIMINATION TREE'}`,
        type, bracketSize: Math.max(2, (isRepechage ? Math.min(type === DrawType.REPECHAGE_QUARTERFINALS ? 8 : 32, size) : size) / 2), sortOrder: 20 });
    }
    if (isRepechage) {
      const final = rounds.at(-1)![0];
      matches.splice(matches.indexOf(final), 1);
      matches.push(final);
      matches.forEach((match, index) => { match.matchNumber = (dto.startMatchNumber || 1) + index; });
    }
    this.resolveGeneratedWalkovers(matches);
    this.assignEvenMatchDates(matches as Array<GeneratedMatch & DateAssignableMatch>, input.event.startDate, input.event.endDate);
    if (isRepechage) {
      rounds.at(-1)![0].matchDate = new Date(Math.max(...matches.map((match) => +new Date(match.matchDate))));
    }
    return { draws, matches, fops, groups: [] as PlannedRoundRobinGroup[], slots: slots.map((athlete) => athlete
      ? input.eligibleEntries.find((entry) => entry.athleteId === athlete.id)!.id : null) };
  }

  private roundRobinGroupSizes(count: number, groupCount: number) {
    if (groupCount > Math.floor(count / 2)) throw new BadRequestException('Mỗi bảng vòng tròn phải có ít nhất hai VĐV');
    return Array.from({ length: groupCount }, (_, index) => Math.floor(count / groupCount) + (index < count % groupCount ? 1 : 0));
  }

  private buildRoundRobinPlan(input: Awaited<ReturnType<MatchesService['loadDrawInput']>>, dto: GenerateDrawDto,
    pairs: PreconfiguredPairDto[]) {
    const sizes = this.roundRobinGroupSizes(input.eligibleEntries.length, dto.groupCount || 1);
    const entries = input.eligibleEntries;
    const pairedIds = new Set(pairs.flatMap((pair) => [pair.entry1Id, pair.entry2Id]));
    const athletes = dto.athleteIds.map((id) => {
      const entry = entries.find((entry) => entry.athleteId === id)!;
      return { id, countryId: entry.athlete!.countryId, federationId: entry.athlete!.federationId, seed: entry.seed };
    });
    const ordered = this.seedAthletes(athletes, this.nextPowerOfTwo(athletes.length), dto.seedingMode || 'STANDARD')
      .filter((athlete): athlete is SeedAthlete => !!athlete).map((athlete) => entries.find((entry) => entry.athleteId === athlete.id)!);
    const buckets: typeof entries[] = sizes.map(() => []);
    const bucketPairs: PreconfiguredPairDto[][] = sizes.map(() => []);
    const chooseBucket = (unitSize: number) => buckets.map((bucket, index) => ({ index, length: bucket.length }))
      .filter(({ index, length }) => length + unitSize <= sizes[index])
      .sort((left, right) => left.length - right.length || left.index - right.index)[0].index;
    for (const pair of pairs) {
      const index = chooseBucket(2);
      buckets[index].push(entries.find((entry) => entry.id === pair.entry1Id)!, entries.find((entry) => entry.id === pair.entry2Id)!);
      bucketPairs[index].push(pair);
    }
    for (const entry of ordered.filter((entry) => !pairedIds.has(entry.id))) buckets[chooseBucket(1)].push(entry);
    const names = [...new Set((dto.fops?.length ? dto.fops : dto.fop ? [dto.fop] : []).map((name) => name.trim()).filter(Boolean))];
    const fops = names.map((name) => {
      const fop = input.fops.find((item) => item.name === name);
      if (!fop) throw new BadRequestException('Sàn/FOP không thuộc sự kiện');
      return fop;
    });
    const groups: PlannedRoundRobinGroup[] = [];
    const draws: Array<{ id: string; name: string; type: DrawType; bracketSize: number; sortOrder: number }> = [];
    const matches: GeneratedMatch[] = [];
    let number = dto.startMatchNumber || 1;
    buckets.forEach((members, index) => {
      const name = `${dto.name?.trim() || 'Bảng'} ${String.fromCharCode(65 + index)}`;
      const groupId = randomUUID();
      const drawId = randomUUID();
      groups.push({ id: groupId, name, members: members.map((entry) => ({ entryId: entry.id, seed: entry.seed })) });
      draws.push({ id: drawId, name, type: DrawType.ROUND_ROBIN_POOL, bracketSize: members.length, sortOrder: index + 10 });
      // Opposite positions meet in the first rotation. Reserve those positions for fixed pairs.
      const rotation: Array<(typeof entries)[number] | null> = Array(members.length + members.length % 2).fill(null);
      bucketPairs[index].forEach((pair, position) => {
        rotation[position] = members.find((entry) => entry.id === pair.entry1Id)!;
        rotation[rotation.length - 1 - position] = members.find((entry) => entry.id === pair.entry2Id)!;
      });
      const remaining = members.filter((entry) => !pairedIds.has(entry.id));
      for (let position = 0; position < rotation.length; position++) {
        if (!rotation[position] && remaining.length) rotation[position] = remaining.shift()!;
      }
      for (let round = 1; round < rotation.length; round++) {
        for (let position = 0; position < rotation.length / 2; position++) {
          const first = rotation[position];
          const second = rotation[rotation.length - 1 - position];
          if (!first || !second) continue;
          const fop = fops.length ? fops[matches.length % fops.length] : undefined;
          matches.push({ id: randomUUID(), eventId: input.event.id, categoryId: input.category.id,
            divisionId: dto.divisionId, drawId, roundRobinGroupId: groupId, pool: name,
            matchNumber: number++, matchDate: input.event.startDate, matchType: MatchType.GROUP_STAGE,
            status: MatchStatus.SCHEDULED, round, bracketPosition: position,
            athlete1Id: first.athleteId, athlete2Id: second.athleteId, fop: fop?.name, fopId: fop?.id });
        }
        rotation.splice(1, 0, rotation.pop() || null);
      }
    });
    this.assignEvenMatchDates(matches as Array<GeneratedMatch & DateAssignableMatch>, input.event.startDate, input.event.endDate);
    return { draws, matches, fops, groups, slots: buckets.flat().map((entry) => entry.id) };
  }

  private renderPreview(plan: ReturnType<MatchesService['buildDrawPlan']>, input: Awaited<ReturnType<MatchesService['loadDrawInput']>>) {
    const athlete = (id?: string | null) => {
      const entry = input.entries.find((entry) => entry.athleteId === id);
      const value = entry?.athlete;
      return value ? { id: value.id, fullName: value.fullName, photoUrl: value.photoUrl, country: value.country, federation: value.federation } : null;
    };
    return plan.draws.map((draw) => ({ ...draw, matches: plan.matches.filter((match) => match.drawId === draw.id)
      .map((match) => ({ ...match, athlete1Score: 0, athlete2Score: 0,
        athlete1: athlete(match.athlete1Id), athlete2: athlete(match.athlete2Id) })) }));
  }

  private async assertDrawRequest(db: Prisma.TransactionClient, input: Awaited<ReturnType<MatchesService['loadDrawInput']>>, dto: GenerateDrawDto) {
    const type = dto.type || DrawType.MAIN_TREE;
    if (!preconfigurationDrawTypes.includes(type)) {
      throw new BadRequestException('Thể thức sinh cây không được hỗ trợ');
    }
    for (const entry of input.eligibleEntries) {
      this.assertDrawEntryEligibility(entry, input);
    }
    const ids = new Set(dto.athleteIds);
    if (ids.size !== dto.athleteIds.length || ids.size !== input.eligibleEntries.length
      || input.eligibleEntries.some((entry) => !entry.athleteId || !ids.has(entry.athleteId))) {
      throw new ConflictException('Danh sách phải gồm toàn bộ VĐV hoặc cặp thi đấu đã xác minh của hạng đấu. Hãy tải lại');
    }
    if (ids.size < (type === DrawType.DOUBLE_ELIMINATION ? 4 : 2)) {
      throw new BadRequestException('Không đủ VĐV hợp lệ cho thể thức này');
    }
    if (type === DrawType.ROUND_ROBIN_POOL) this.roundRobinGroupSizes(ids.size, dto.groupCount || 1);
    if (dto.divisionId && !await db.division.count({ where: { id: dto.divisionId, categoryId: input.category.id } })) {
      throw new BadRequestException('Phân hạng không thuộc hạng đấu');
    }
  }

  async getPreconfiguration(eventId: string, categoryId: string, drawType: DrawType) {
    this.assertPreconfigurationType(drawType);
    const input = await this.loadDrawInput(this.prisma, eventId, categoryId);
    const config = await this.prisma.drawPreconfiguration.findUnique({ where: this.preconfigurationKey(eventId, categoryId, drawType) });
    if (!config) return { pairs: [], revision: 0, seedingMode: 'STANDARD', groupCount: 1, preview: [], stale: true };
    const stale = !config.plan || config.inputVersion !== this.inputVersion(input, config.pairs, config.options);
    return { pairs: config.pairs, revision: config.revision, seedingMode: (config.options as any).seedingMode, groupCount: (config.options as any).groupCount || 1, name: (config.options as any).name,
      inputVersion: config.inputVersion, previewedAt: config.previewedAt, stale,
      preview: !stale ? this.renderPreview(config.plan as any, input) : [] };
  }

  async savePreconfiguration(eventId: string, categoryId: string, dto: SaveDrawPreconfigurationDto, actorUserId: string) {
    this.assertPreconfigurationType(dto.drawType);
    return this.drawTransaction(eventId, async (db) => {
      const input = await this.loadDrawInput(db, eventId, categoryId);
      this.validatePairs(input, dto.pairs, dto.drawType, dto.groupCount);
      const where = this.preconfigurationKey(eventId, categoryId, dto.drawType);
      const previous = await db.drawPreconfiguration.findUnique({ where });
      if ((previous?.revision || 0) !== dto.revision) throw new ConflictException('Cấu hình đã được sửa bởi người khác; hãy tải lại');
      const data = { pairs: this.json(dto.pairs), options: this.json({ type: dto.drawType, seedingMode: dto.seedingMode, groupCount: dto.groupCount || 1 }),
        revision: dto.revision + 1, inputVersion: null, slots: Prisma.DbNull, plan: Prisma.DbNull, previewedAt: null };
      const config = await db.drawPreconfiguration.upsert({ where, update: data,
        create: { eventId, categoryId, drawType: dto.drawType, ...data } });
      await db.drawPreconfigurationHistory.create({ data: { configurationId: config.id, actorUserId, action: 'CONFIGURE',
        revision: config.revision, snapshot: this.json({ before: previous, after: config }) } });
      return { pairs: config.pairs, revision: config.revision, seedingMode: dto.seedingMode, groupCount: dto.groupCount || 1, stale: true, preview: [] };
    });
  }

  async previewDraw(eventId: string, categoryId: string, dto: PreviewDrawDto, actorUserId: string) {
    const type = dto.type || DrawType.MAIN_TREE;
    this.assertPreconfigurationType(type);
    return this.drawTransaction(eventId, async (db) => {
      const input = await this.loadDrawInput(db, eventId, categoryId);
      await this.assertDrawRequest(db, input, dto);
      const where = this.preconfigurationKey(eventId, categoryId, type);
      const previous = await db.drawPreconfiguration.findUnique({ where });
      if ((previous?.revision || 0) !== (dto.revision ?? 0)) throw new ConflictException('Cấu hình đã thay đổi; hãy tải lại trước khi preview');
      const pairs = (previous?.pairs || []) as unknown as PreconfiguredPairDto[];
      this.validatePairs(input, pairs, type, dto.groupCount);
      const maximum = await db.match.aggregate({ where: { eventId }, _max: { matchNumber: true } });
      const startMatchNumber = dto.startMatchNumber || (maximum._max.matchNumber || 0) + 1;
      if (startMatchNumber <= (maximum._max.matchNumber || 0)) throw new ConflictException('Số trận bắt đầu đã được sử dụng');
      const options = { type, seedingMode: dto.seedingMode || 'STANDARD', name: dto.name, divisionId: dto.divisionId,
        fops: dto.fops, fop: dto.fop, startMatchNumber, groupCount: dto.groupCount || 1 };
      const plan = this.buildDrawPlan(input, { ...dto, startMatchNumber }, pairs);
      const inputVersion = this.inputVersion(input, pairs, this.json(options));
      const data = { pairs: this.json(pairs), options: this.json(options), inputVersion,
        slots: this.json(plan.slots), plan: this.json(plan), previewedAt: new Date(), revision: (previous?.revision || 0) + 1 };
      const config = await db.drawPreconfiguration.upsert({ where, update: data, create: { eventId, categoryId, drawType: type, ...data } });
      await db.drawPreconfigurationHistory.create({ data: { configurationId: config.id, actorUserId, action: 'PREVIEW',
        revision: config.revision, snapshot: this.json({ inputVersion, pairs, options, plan }) } });
      return { pairs, revision: config.revision, seedingMode: options.seedingMode, groupCount: options.groupCount, name: options.name, inputVersion,
        previewedAt: config.previewedAt, stale: false, preview: this.renderPreview(plan, input) };
    });
  }

  async getPreconfigurationHistory(eventId: string, categoryId: string, drawType: DrawType) {
    this.assertPreconfigurationType(drawType);
    return this.prisma.drawPreconfigurationHistory.findMany({
      where: { configuration: { eventId, categoryId, drawType } }, orderBy: { createdAt: 'desc' }, take: 100,
    });
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value));
  }

  async generateDraw(eventId: string, categoryId: string, dto: GenerateDrawDto, actorUserId?: string) {
    await this.drawTransaction(eventId, async (db) => {
      const type = dto.type || DrawType.MAIN_TREE;
      const config = await db.drawPreconfiguration.findUnique({ where: this.preconfigurationKey(eventId, categoryId, type) });
      if (!config) {
        const names = [...new Set((dto.fops?.length ? dto.fops : dto.fop ? [dto.fop] : []).map((name) => name.trim()).filter(Boolean))];
        for (const name of names) await db.fop.upsert({
          where: { eventId_name: { eventId, name } }, update: {}, create: { eventId, name },
        });
      }
      const input = await this.loadDrawInput(db, eventId, categoryId);
      await this.assertDrawRequest(db, input, dto);
      // An ordinary caller supplies the current roster, but cannot override the
      // saved arrangement or its seeding/options. Private data stays server-side.
      if (config && (!config.plan || config.inputVersion !== this.inputVersion(input, config.pairs, config.options))) {
        throw new ConflictException('Dữ liệu đầu vào đã thay đổi hoặc chưa được preview. Cần người có quyền preview lại trước khi sinh nhánh');
      }
      const plan = config ? config.plan as unknown as ReturnType<MatchesService['buildDrawPlan']>
        : this.buildDrawPlan(input, dto, []);
      const conflict = await db.draw.findFirst({ where: { eventId, categoryId,
        name: { in: plan.draws.map((draw) => draw.name) } } });
      if (conflict) throw new ConflictException('Hạng đấu đã có nhánh; không thể tạo trùng');
      const maximum = await db.match.aggregate({ where: { eventId }, _max: { matchNumber: true } });
      let number = (config ? (config.options as any).startMatchNumber : dto.startMatchNumber) || (maximum._max.matchNumber || 0) + 1;
      if (number <= (maximum._max.matchNumber || 0)) throw new ConflictException(config
        ? 'Số trận trong phương án đã được sử dụng. Cần người có quyền preview lại trước khi sinh nhánh'
        : 'Số trận bắt đầu đã được sử dụng');
      for (const draw of plan.draws) {
        await db.draw.create({ data: { ...draw, eventId, categoryId,
          divisionId: config ? (config.options as any).divisionId : dto.divisionId,
          fops: plan.fops.length ? { connect: plan.fops.map(({ id }) => ({ id })) } : undefined } });
      }
      for (const group of plan.groups || []) {
        await db.roundRobinGroup.create({ data: { id: group.id, eventId, categoryId, name: group.name,
          members: { create: group.members } } });
      }
      const pairCategory = ['DUO', 'SHOW'].includes(input.category.discipline || '');
      await db.match.createMany({ data: plan.matches.map((match) => ({ ...match,
        ...(pairCategory ? { team1Id: match.athlete1Id, team2Id: match.athlete2Id, winnerTeamId: match.winnerId, athlete1Id: null, athlete2Id: null, winnerId: null } : {}),
        matchNumber: number++, matchDate: new Date(match.matchDate) })) });
      const groupMatches = plan.matches.filter((match) => match.roundRobinGroupId);
      if (groupMatches.length) await db.matchParticipant.createMany({ data: groupMatches.flatMap((match) =>
        [match.athlete1Id, match.athlete2Id].map((athleteId, index) => ({ matchId: match.id!, athleteId: pairCategory ? null : athleteId, teamId: pairCategory ? athleteId : null,
          entryId: input.eligibleEntries.find((entry) => entry.athleteId === athleteId)!.id, position: index + 1 }))) });
      if (config && actorUserId) await db.drawPreconfigurationHistory.create({ data: { configurationId: config.id, actorUserId,
        action: 'GENERATE', revision: config.revision, snapshot: this.json({ inputVersion: config.inputVersion, draws: plan.draws }) } });
    });
    return this.findDraws(eventId, categoryId);
  }

  async distributeEventMatchDates(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, startDate: true, endDate: true },
    });
    if (!event) throw new NotFoundException('Không tìm thấy sự kiện');

    const daySlots = this.eventDaySlots(event.startDate, event.endDate);
    if (daySlots.length < 2) {
      throw new BadRequestException('Sự kiện chỉ diễn ra trong một ngày, không thể chia lịch theo nhiều ngày');
    }

    const [matches, activeMatchCount] = await Promise.all([
      this.prisma.match.findMany({
        where: {
          eventId,
          startTime: null,
          schedulePlanId: null,
          scheduleLocked: false,
          status: { not: MatchStatus.CANCELLED },
        },
        orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.match.count({
        where: { eventId, status: { not: MatchStatus.CANCELLED } },
      }),
    ]);
    if (!matches.length) {
      throw new BadRequestException('Không có trận chưa xếp giờ để chia đều theo ngày');
    }

    const assignments = this.evenMatchDateAssignments(matches, event.startDate, event.endDate);
    const changed = assignments.filter(({ match, matchDate }) => (
      new Date(match.matchDate).getTime() !== matchDate.getTime()
    ));
    if (changed.length) {
      await this.prisma.$transaction(changed.map(({ match, matchDate }) => this.prisma.match.update({
        where: { id: match.id },
        data: { matchDate },
      })));
    }

    const distribution = assignments.reduce<Record<string, number>>((result, { matchDate }) => {
      const date = this.localDateKey(matchDate);
      result[date] = (result[date] || 0) + 1;
      return result;
    }, {});
    return {
      eventId,
      eligible: matches.length,
      updated: changed.length,
      skippedScheduledOrLocked: Math.max(0, activeMatchCount - matches.length),
      eventDayCount: daySlots.length,
      usedDayCount: Object.keys(distribution).length,
      distribution,
    };
  }

  private buildWinnerBracket(input: {
    drawId: string;
    eventId: string;
    categoryId: string;
    divisionId?: string;
    matchDate: Date;
    fops: ScheduledFop[];
    fopCursor: { value: number };
    slots: Array<SeedAthlete | null>;
    number: { value: number };
  }) {
    const roundCount = Math.log2(input.slots.length);
    const rounds: GeneratedMatch[][] = [];

    for (let round = 1; round <= roundCount; round += 1) {
      const matchCount = input.slots.length / 2 ** round;
      const roundMatches = Array.from({ length: matchCount }, (_, position) => {
        const fop = this.takeNextFop(input.fops, input.fopCursor);
        return {
          id: randomUUID(),
          eventId: input.eventId,
          categoryId: input.categoryId,
          divisionId: input.divisionId,
          drawId: input.drawId,
          matchNumber: input.number.value++,
          fop: fop?.name,
          fopId: fop?.id,
          matchDate: input.matchDate,
          athlete1Id: round === 1 ? input.slots[position * 2]?.id || null : null,
          athlete2Id: round === 1 ? input.slots[position * 2 + 1]?.id || null : null,
          status: MatchStatus.SCHEDULED,
          matchType: this.matchTypeForCount(matchCount),
          round,
          bracketPosition: position,
          notes: `Generated winner bracket · round ${round}`,
        } satisfies GeneratedMatch;
      });
      rounds.push(roundMatches);
    }

    for (let roundIndex = 0; roundIndex < rounds.length; roundIndex += 1) {
      for (let position = 0; position < rounds[roundIndex].length; position += 1) {
        const match = rounds[roundIndex][position];
        if (roundIndex < rounds.length - 1) {
          const target = rounds[roundIndex + 1][Math.floor(position / 2)];
          match.winnerToMatchId = target.id;
          match.winnerToSide = position % 2 === 0 ? BracketSide.ATHLETE1 : BracketSide.ATHLETE2;
        }
      }
    }

    return rounds;
  }

  private buildDoubleEliminationBracket(input: {
    drawId: string;
    eventId: string;
    categoryId: string;
    divisionId?: string;
    matchDate: Date;
    fops: ScheduledFop[];
    fopCursor: { value: number };
    winnersRounds: GeneratedMatch[][];
    number: { value: number };
  }) {
    const winnerRoundCount = input.winnersRounds.length;
    const loserRoundCount = winnerRoundCount * 2 - 2;
    const loserRounds: GeneratedMatch[][] = [];

    for (let stage = 1; stage <= loserRoundCount; stage += 1) {
      const pair = Math.ceil(stage / 2);
      const matchCount = input.winnersRounds[0].length / 2 ** pair;
      loserRounds.push(Array.from({ length: matchCount }, (_, position) => {
        const fop = this.takeNextFop(input.fops, input.fopCursor);
        return {
          id: randomUUID(),
          eventId: input.eventId,
          categoryId: input.categoryId,
          divisionId: input.divisionId,
          drawId: input.drawId,
          matchNumber: input.number.value++,
          fop: fop?.name,
          fopId: fop?.id,
          matchDate: input.matchDate,
          status: MatchStatus.SCHEDULED,
          matchType: MatchType.ELIMINATION,
          round: stage,
          bracketPosition: position,
          notes: `Generated double-elimination loser bracket · round ${stage}`,
        } satisfies GeneratedMatch;
      }));
    }

    const finalFop = this.takeNextFop(input.fops, input.fopCursor);
    const grandFinal: GeneratedMatch = {
      id: randomUUID(),
      eventId: input.eventId,
      categoryId: input.categoryId,
      divisionId: input.divisionId,
      drawId: input.drawId,
      matchNumber: input.number.value++,
      fop: finalFop?.name,
      fopId: finalFop?.id,
      matchDate: input.matchDate,
      status: MatchStatus.SCHEDULED,
      matchType: MatchType.FINAL,
      round: loserRoundCount + 1,
      bracketPosition: 0,
      notes: 'Generated double-elimination grand final',
    };

    input.winnersRounds[0].forEach((match, position) => {
      const target = loserRounds[0][Math.floor(position / 2)];
      match.loserToMatchId = target.id;
      match.loserToSide = position % 2 === 0 ? BracketSide.ATHLETE1 : BracketSide.ATHLETE2;
    });

    for (let stageIndex = 0; stageIndex < loserRounds.length; stageIndex += 1) {
      const stage = stageIndex + 1;
      const current = loserRounds[stageIndex];
      const next = loserRounds[stageIndex + 1];

      if (next) {
        current.forEach((match, position) => {
          match.winnerToMatchId = next[stage % 2 === 1 ? position : Math.floor(position / 2)].id;
          match.winnerToSide = stage % 2 === 1
            ? BracketSide.ATHLETE1
            : position % 2 === 0
              ? BracketSide.ATHLETE1
              : BracketSide.ATHLETE2;
        });
      }

      if (stage % 2 === 0) {
        const winnerRoundIndex = stage / 2;
        input.winnersRounds[winnerRoundIndex].forEach((match, position) => {
          match.loserToMatchId = current[position].id;
          match.loserToSide = BracketSide.ATHLETE2;
        });
      }
    }

    const winnerFinal = input.winnersRounds.at(-1)?.[0];
    const loserFinal = loserRounds.at(-1)?.[0];
    if (winnerFinal && loserFinal) {
      winnerFinal.winnerToMatchId = grandFinal.id;
      winnerFinal.winnerToSide = BracketSide.ATHLETE1;
      loserFinal.winnerToMatchId = grandFinal.id;
      loserFinal.winnerToSide = BracketSide.ATHLETE2;
    }

    return [...loserRounds.flat(), grandFinal];
  }

  private buildRepechageBracket(input: {
    drawId: string;
    eventId: string;
    categoryId: string;
    divisionId?: string;
    matchDate: Date;
    fops: ScheduledFop[];
    fopCursor: { value: number };
    winnersRounds: GeneratedMatch[][];
    fromQuarterfinals?: boolean;
    number: { value: number };
  }) {
    // Locate quarterfinals by bracket depth, including brackets with byes.
    // The separate legacy repechage format retains its round-of-32 entry point.
    const eligibleRounds = input.winnersRounds.slice(input.fromQuarterfinals ? -3 : -5);
    const roundCount = eligibleRounds.length * 2 - 4;
    const rounds: GeneratedMatch[][] = [];
    for (let stage = 1; stage <= roundCount; stage += 1) {
      const matchCount = eligibleRounds[0].length / 2 ** Math.ceil(stage / 2);
      rounds.push(Array.from({ length: matchCount }, (_, position) => {
        const fop = this.takeNextFop(input.fops, input.fopCursor);
        return {
          id: randomUUID(), eventId: input.eventId, categoryId: input.categoryId,
          divisionId: input.divisionId, drawId: input.drawId,
          matchNumber: input.number.value++, fop: fop?.name, fopId: fop?.id,
          matchDate: input.matchDate, status: MatchStatus.SCHEDULED,
          matchType: MatchType.ELIMINATION, round: stage, bracketPosition: position,
          notes: stage === roundCount
            ? `Generated repechage bronze medal ${position === 0 ? 'A' : 'B'}`
            : `Generated repechage · round ${stage}`,
        } satisfies GeneratedMatch;
      }));
    }
    eligibleRounds[0].forEach((match, position) => {
      match.loserToMatchId = rounds[0][Math.floor(position / 2)].id;
      match.loserToSide = position % 2 === 0 ? BracketSide.ATHLETE1 : BracketSide.ATHLETE2;
    });
    rounds.forEach((current, index) => {
      const stage = index + 1;
      const next = rounds[index + 1];
      if (next) current.forEach((match, position) => {
        match.winnerToMatchId = next[stage % 2 === 1 ? position : Math.floor(position / 2)].id;
        match.winnerToSide = stage % 2 === 1 || position % 2 === 0 ? BracketSide.ATHLETE1 : BracketSide.ATHLETE2;
      });
      if (stage % 2 === 0) eligibleRounds[stage / 2].forEach((match, position) => {
        // Cross the semifinal losers into the opposite bronze path (Appendix 9.2–9.4).
        const destination = stage === roundCount ? position ^ 1 : position;
        match.loserToMatchId = current[destination].id;
        match.loserToSide = BracketSide.ATHLETE2;
      });
    });
    return rounds.flat();
  }

  private seedAthletes(
    athletes: SeedAthlete[],
    bracketSize: number,
    mode: SeedingMode,
  ): Array<SeedAthlete | null> {
    const seeded = athletes.filter((athlete) => athlete.seed != null)
      .sort((left, right) => left.seed! - right.seed! || left.id.localeCompare(right.id));
    const unseeded = athletes.filter((athlete) => athlete.seed == null);
    // Random/order/group preferences apply to unseeded athletes only. Explicit
    // seeds always use the same recursive placement: halves, quarters, eighths.
    const ordered = [...seeded, ...(mode === 'RANDOM' ? this.shuffle(unseeded) : unseeded)];
    const slots = this.standardSeedOrder(bracketSize).map((seed) => ordered[seed - 1] || null);
    if (mode === 'COUNTRY_SEPARATED' || mode === 'FEDERATION_SEPARATED') {
      this.separateUnseededOpponents(slots, (athlete) => mode === 'COUNTRY_SEPARATED'
        ? athlete.countryId : athlete.federationId || athlete.countryId);
    }
    return slots;
  }

  private standardSeedOrder(size: number) {
    let order = [1, 2];
    while (order.length < size) {
      const sum = order.length * 2 + 1;
      order = order.flatMap((seed) => [seed, sum - seed]);
    }
    return order;
  }

  private separateUnseededOpponents(slots: Array<SeedAthlete | null>, groupKey: (athlete: SeedAthlete) => string) {
    const collision = (first: SeedAthlete | null, second: SeedAthlete | null) =>
      first && second && groupKey(first) === groupKey(second) ? 1 : 0;
    // Only swap actual unseeded athletes: seeded positions and the allocation
    // of byes remain unchanged. Every swap strictly reduces first-round clashes.
    let improved = true;
    while (improved) {
      improved = false;
      for (let first = 0; first < slots.length; first += 1) {
        const athlete = slots[first];
        if (!athlete || athlete.seed != null || !collision(athlete, slots[first ^ 1])) continue;
        for (let second = 0; second < slots.length; second += 1) {
          const other = slots[second];
          if (!other || other.seed != null || Math.floor(first / 2) === Math.floor(second / 2)) continue;
          const before = collision(athlete, slots[first ^ 1]) + collision(other, slots[second ^ 1]);
          const after = collision(other, slots[first ^ 1]) + collision(athlete, slots[second ^ 1]);
          if (after >= before) continue;
          [slots[first], slots[second]] = [other, athlete];
          improved = true;
          break;
        }
      }
    }
  }

  private shuffle<T>(items: T[]) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }

  private takeNextFop(fops: ScheduledFop[], cursor: { value: number }) {
    if (!fops.length) return undefined;
    const fop = fops[cursor.value % fops.length];
    cursor.value += 1;
    return fop;
  }

  private assignEvenMatchDates<T extends DateAssignableMatch>(matches: T[], startDate: Date, endDate: Date) {
    this.evenMatchDateAssignments(matches, startDate, endDate).forEach(({ match, matchDate }) => {
      match.matchDate = matchDate;
    });
  }

  private evenMatchDateAssignments<T extends DateAssignableMatch>(matches: T[], startDate: Date, endDate: Date) {
    const ordered = this.orderMatchesByProgression(matches);
    const dates = this.eventDaySlots(startDate, endDate);
    return ordered.map((match, index) => {
      const dayIndex = ordered.length <= 1
        ? 0
        : Math.round((index * (dates.length - 1)) / (ordered.length - 1));
      return { match, matchDate: new Date(dates[dayIndex]) };
    });
  }

  private orderMatchesByProgression<T extends DateAssignableMatch>(matches: T[]) {
    const byId = new Map(matches.map((match) => [match.id, match]));
    const outgoing = new Map<string, Set<string>>();
    const incoming = new Map(matches.map((match) => [match.id, 0]));
    for (const match of matches) {
      for (const targetId of [match.winnerToMatchId, match.loserToMatchId]) {
        if (!targetId || targetId === match.id || !byId.has(targetId)) continue;
        const targets = outgoing.get(match.id) || new Set<string>();
        if (targets.has(targetId)) continue;
        targets.add(targetId);
        outgoing.set(match.id, targets);
        incoming.set(targetId, (incoming.get(targetId) || 0) + 1);
      }
    }
    const compare = (left: T, right: T) => (
      (left.round ?? Number.MAX_SAFE_INTEGER) - (right.round ?? Number.MAX_SAFE_INTEGER)
      || (left.matchNumber ?? Number.MAX_SAFE_INTEGER) - (right.matchNumber ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id)
    );
    const ready = matches.filter((match) => incoming.get(match.id) === 0).sort(compare);
    const ordered: T[] = [];
    while (ready.length) {
      const match = ready.shift()!;
      ordered.push(match);
      for (const targetId of outgoing.get(match.id) || []) {
        const remaining = (incoming.get(targetId) || 0) - 1;
        incoming.set(targetId, remaining);
        if (remaining === 0) {
          ready.push(byId.get(targetId)!);
          ready.sort(compare);
        }
      }
    }
    if (ordered.length < matches.length) {
      const scheduledIds = new Set(ordered.map(({ id }) => id));
      ordered.push(...matches.filter(({ id }) => !scheduledIds.has(id)).sort(compare));
    }
    return ordered;
  }

  private eventDaySlots(startDate: Date, endDate: Date) {
    const dayMs = 86_400_000;
    const dayCount = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / dayMs) + 1);
    return Array.from({ length: dayCount }, (_, index) => new Date(startDate.getTime() + index * dayMs));
  }

  private localDateKey(date: Date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  private assertInsideEventDates(
    event: { startDate: Date; endDate: Date },
    matchDate: Date,
    startTime?: Date | null,
    endTime?: Date | null,
  ) {
    const firstDay = this.localDateKey(event.startDate);
    const lastDay = this.localDateKey(event.endDate);
    const values = [matchDate, startTime, endTime].filter((value): value is Date => Boolean(value));
    if (values.some((value) => {
      const day = this.localDateKey(value);
      return day < firstDay || day > lastDay;
    })) {
      throw new BadRequestException(
        `Thời gian thi đấu phải nằm trong thời gian sự kiện (${firstDay} đến ${lastDay})`,
      );
    }
  }

  private async assertFopAvailability(
    database: PrismaService | Prisma.TransactionClient,
    eventId: string,
    fopId: string | null | undefined,
    startTime: Date,
    endTime: Date,
    excludeMatchId?: string,
  ) {
    if (!fopId || endTime <= startTime) return;
    const conflict = await (database as any).match.findFirst({
      where: {
        eventId,
        fopId,
        ...(excludeMatchId ? { id: { not: excludeMatchId } } : {}),
        status: { not: MatchStatus.CANCELLED },
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
      select: {
        id: true,
        matchNumber: true,
        startTime: true,
        endTime: true,
        fopRecord: { select: { name: true } },
      },
    });
    if (conflict) {
      const range = [conflict.startTime, conflict.endTime]
        .filter(Boolean)
        .map((value) => new Intl.DateTimeFormat('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(value))
        .join(' – ');
      throw new ConflictException(
        `${conflict.fopRecord?.name || 'Sân/FOP'} đã có trận #${conflict.matchNumber || conflict.id} lúc ${range}`,
      );
    }
  }

  private nextPowerOfTwo(value: number) {
    return 2 ** Math.ceil(Math.log2(value));
  }

  private matchTypeForCount(matchCount: number) {
    if (matchCount === 1) return MatchType.FINAL;
    if (matchCount === 2) return MatchType.SEMIFINAL;
    if (matchCount === 4) return MatchType.QUARTERFINAL;
    if (matchCount === 8) return MatchType.ROUND_OF_16;
    if (matchCount === 16) return MatchType.ROUND_OF_32;
    return MatchType.ELIMINATION;
  }

  private resolveGeneratedWalkovers(matches: GeneratedMatch[]) {
    const matchById = new Map(matches.map((match) => [match.id as string, match]));
    let changed = true;
    let iteration = 0;

    while (changed && iteration < matches.length * 2) {
      changed = false;
      iteration += 1;

      for (const source of matches) {
        if (source.status !== MatchStatus.FINISHED || !source.winnerId) continue;
        const loserId = source.winnerId === source.athlete1Id ? source.athlete2Id : source.athlete1Id;
        const assignments: Array<[string | null | undefined, BracketSide | null | undefined, string | null | undefined]> = [
          [source.winnerToMatchId, source.winnerToSide, source.winnerId],
          [source.loserToMatchId, source.loserToSide, loserId],
        ];
        assignments.forEach(([targetId, side, athleteId]) => {
          if (!targetId || !side || !athleteId) return;
          const target = matchById.get(targetId);
          if (!target) return;
          const key = side === BracketSide.ATHLETE1 ? 'athlete1Id' : 'athlete2Id';
          if (!target[key]) {
            target[key] = athleteId;
            changed = true;
          }
        });
      }

      for (const match of matches) {
        if (match.status !== MatchStatus.SCHEDULED) continue;
        if ('resultStatus' in match && match.resultStatus !== ResultStatus.DRAFT) continue;
        const incoming = matches.filter((source) => (
          source.winnerToMatchId === match.id || source.loserToMatchId === match.id
        ));
        const sideResolved = (side: BracketSide) => {
          const athleteId = side === BracketSide.ATHLETE1 ? match.athlete1Id : match.athlete2Id;
          if (athleteId) return true;
          const feeders = incoming.filter((source) => (
            (source.winnerToMatchId === match.id && source.winnerToSide === side)
            || (source.loserToMatchId === match.id && source.loserToSide === side)
          ));
          return feeders.every((source) => {
            if (source.status !== MatchStatus.FINISHED) return false;
            const routedAthlete = source.winnerToMatchId === match.id && source.winnerToSide === side
              ? source.winnerId
              : !source.winnerId ? null : source.winnerId === source.athlete1Id ? source.athlete2Id : source.athlete1Id;
            // A newly resolved bye may still need to propagate on the next pass.
            return !routedAthlete;
          });
        };
        const athleteIds = [match.athlete1Id, match.athlete2Id].filter(Boolean) as string[];
        if (
          athleteIds.length <= 1
          && sideResolved(BracketSide.ATHLETE1)
          && sideResolved(BracketSide.ATHLETE2)
        ) {
          match.status = MatchStatus.FINISHED;
          match.winnerId = athleteIds[0] || null;
          match.winMethod = WinMethod.WALKOVVER;
          changed = true;
        }
      }
    }
  }

  async syncProgression(
    transaction: Prisma.TransactionClient,
    previous: Match,
    updated: Match,
  ) {
    const progressionFields: Array<keyof Match> = ['status', 'winnerId', 'winnerTeamId', 'athlete1Id', 'athlete2Id', 'team1Id', 'team2Id', 'winnerToMatchId', 'winnerToSide', 'loserToMatchId', 'loserToSide'];
    if (progressionFields.every((field) => previous[field] === updated[field])) return;
    await this.invalidateQuarterfinalDescendants(transaction, previous, updated);
    await this.clearProgressionTarget(transaction, previous.winnerToMatchId, previous.winnerToSide, previous.winnerId);
    await this.clearProgressionTarget(
      transaction,
      previous.loserToMatchId,
      previous.loserToSide,
      this.getLoserId(previous),
    );
    await this.clearTeamProgressionTarget(
      transaction,
      previous.winnerToMatchId,
      previous.winnerToSide,
      previous.winnerTeamId,
    );
    await this.clearTeamProgressionTarget(
      transaction,
      previous.loserToMatchId,
      previous.loserToSide,
      this.getLoserTeamId(previous),
    );

    if (updated.status !== 'FINISHED') return;

    await this.assignProgressionTarget(
      transaction,
      updated.winnerToMatchId,
      updated.winnerToSide,
      updated.winnerId,
    );
    await this.assignProgressionTarget(
      transaction,
      updated.loserToMatchId,
      updated.loserToSide,
      this.getLoserId(updated),
    );
    await this.assignTeamProgressionTarget(
      transaction,
      updated.winnerToMatchId,
      updated.winnerToSide,
      updated.winnerTeamId,
    );
    await this.assignTeamProgressionTarget(
      transaction,
      updated.loserToMatchId,
      updated.loserToSide,
      this.getLoserTeamId(updated),
    );
    await this.resolveProgressionWalkovers(transaction, [updated.winnerToMatchId, updated.loserToMatchId]);
  }

  private async invalidateQuarterfinalDescendants(transaction: Prisma.TransactionClient, previous: Match, updated: Match) {
    if (previous.status !== MatchStatus.FINISHED || previous.winnerId === updated.winnerId && previous.winnerTeamId === updated.winnerTeamId && previous.status === updated.status) return;
    const graph = await transaction.match.findMany({ where: { eventId: previous.eventId, categoryId: previous.categoryId }, include: { draw: true } });
    const selected = graph.filter((match) => match.draw?.type === DrawType.REPECHAGE_QUARTERFINALS);
    const selectedIds = new Set(selected.map((match) => match.id));
    const mainIds = new Set(graph.filter((match) => match.loserToMatchId && selectedIds.has(match.loserToMatchId)).map((match) => match.drawId));
    if (!selectedIds.has(previous.id) && !mainIds.has(previous.drawId)) return;
    const visited = new Set<string>();
    const invalidate = async (id: string | null) => {
      if (!id || visited.has(id)) return;
      visited.add(id);
      await transaction.$queryRaw`SELECT id FROM "Match" WHERE id = ${id} FOR UPDATE`;
      const target = await transaction.match.findUnique({ where: { id } });
      if (!target) return;
      for (const [nextId, side] of [[target.winnerToMatchId, target.winnerToSide], [target.loserToMatchId, target.loserToSide]]) {
        await invalidate(nextId);
        if (nextId && side) await transaction.match.update({ where: { id: nextId },
          data: side === BracketSide.ATHLETE1 ? { athlete1Id: null, team1Id: null } : { athlete2Id: null, team2Id: null } });
      }
      const after = await transaction.match.update({ where: { id }, data: {
        status: MatchStatus.SCHEDULED, resultStatus: ResultStatus.DRAFT, winnerId: null, winnerTeamId: null, winMethod: null,
        athlete1Score: 0, athlete2Score: 0, athlete1Advantages: 0, athlete2Advantages: 0, athlete1Penalties: 0, athlete2Penalties: 0,
        resultData: Prisma.DbNull, resultVersion: { increment: 1 }, resultEnteredAt: null, resultEnteredBy: null,
        refereeConfirmedAt: null, refereeConfirmedBy: null, approvedAt: null, approvedBy: null,
        resultPublishedAt: null, resultPublishedBy: null, resultLockedAt: null, resultLockedBy: null,
      } });
      await transaction.resultRevision.create({ data: { matchId: id, version: after.resultVersion,
        status: ResultStatus.DRAFT, action: 'INVALIDATE_PROGRESSION',
        reason: `Kết quả trận nguồn #${previous.matchNumber || previous.id} thay đổi`,
        actorUserId: updated.resultEnteredBy, before: this.json(target),
        after: { winnerId: null, resultStatus: ResultStatus.DRAFT },
      } });
    };
    await invalidate(previous.winnerToMatchId);
    await invalidate(previous.loserToMatchId);
  }

  private async resolveProgressionWalkovers(transaction: Prisma.TransactionClient, targetIds: Array<string | null>) {
    const pending = targetIds.filter((id): id is string => Boolean(id));
    const visited = new Set<string>();
    while (pending.length) {
      const id = pending.shift()!;
      if (visited.has(id)) continue;
      await transaction.$queryRaw`SELECT id FROM "Match" WHERE id = ${id} FOR UPDATE`;
      const target = await transaction.match.findUnique({ where: { id } });
      if (!target || target.status !== MatchStatus.SCHEDULED || target.resultStatus !== ResultStatus.DRAFT
        || !target.drawId || !target.notes?.startsWith('Generated ') || target.resultEnteredAt) continue;
      const incoming = await transaction.match.findMany({
        where: { OR: [{ winnerToMatchId: id }, { loserToMatchId: id }] },
      });
      const resolved = (side: BracketSide) => {
        const occupant = side === BracketSide.ATHLETE1 ? target.athlete1Id : target.athlete2Id;
        if (occupant) return true;
        return incoming.filter((source) => (
          source.winnerToMatchId === id && source.winnerToSide === side
          || source.loserToMatchId === id && source.loserToSide === side
        )).every((source) => {
          if (source.status !== MatchStatus.FINISHED) return false;
          const routedAthlete = source.winnerToMatchId === id && source.winnerToSide === side
            ? source.winnerId : this.getLoserId(source);
          return !routedAthlete;
        });
      };
      const athletes = [target.athlete1Id, target.athlete2Id].filter(Boolean);
      if (athletes.length > 1 || !resolved(BracketSide.ATHLETE1) || !resolved(BracketSide.ATHLETE2)) continue;
      visited.add(id);
      const winnerId = athletes[0] || null;
      await transaction.match.update({
        where: { id },
        data: { status: MatchStatus.FINISHED, winnerId, winMethod: WinMethod.WALKOVVER, resultVersion: { increment: 1 } },
      });
      await this.assignProgressionTarget(transaction, target.winnerToMatchId, target.winnerToSide, winnerId);
      pending.push(...[target.winnerToMatchId, target.loserToMatchId].filter((next): next is string => Boolean(next)));
    }
  }

  private async assertProgressionTargetEditable(transaction: Prisma.TransactionClient, id: string) {
    await transaction.$queryRaw`SELECT id FROM "Match" WHERE id = ${id} FOR UPDATE`;
    let target = await transaction.match.findUnique({ where: { id } });
    if (target && this.isGeneratedWalkover(target)) {
      await this.reopenGeneratedWalkover(transaction, target, new Set());
      target = await transaction.match.findUnique({ where: { id } });
    }
    if (!target || target.status !== MatchStatus.SCHEDULED || target.resultStatus !== ResultStatus.DRAFT) {
      throw new ConflictException(`Trận đích đã bắt đầu hoặc đã có kết quả; không thể thay đổi VĐV của nhánh đấu (trận #${target?.matchNumber || id})`);
    }
    return target;
  }

  private isGeneratedWalkover(match: Match) {
    return match.status === MatchStatus.FINISHED
      && match.resultStatus === ResultStatus.DRAFT
      && match.winMethod === WinMethod.WALKOVVER
      && !match.resultEnteredAt
      && Boolean(match.notes?.startsWith('Generated '));
  }

  private async reopenGeneratedWalkover(
    transaction: Prisma.TransactionClient,
    match: Match,
    visited: Set<string>,
  ) {
    if (!this.isGeneratedWalkover(match) || visited.has(match.id)) return;
    visited.add(match.id);

    if (match.winnerToMatchId && match.winnerToSide && match.winnerId) {
      await transaction.$queryRaw`SELECT id FROM "Match" WHERE id = ${match.winnerToMatchId} FOR UPDATE`;
      let next = await transaction.match.findUnique({ where: { id: match.winnerToMatchId } });
      if (next && this.isGeneratedWalkover(next)) {
        await this.reopenGeneratedWalkover(transaction, next, visited);
        next = await transaction.match.findUnique({ where: { id: match.winnerToMatchId } });
      }
      if (!next || next.status !== MatchStatus.SCHEDULED || next.resultStatus !== ResultStatus.DRAFT) {
        throw new ConflictException(`Không thể sửa walkover tự động vì trận kế tiếp đã bắt đầu hoặc có kết quả (trận #${next?.matchNumber || match.winnerToMatchId})`);
      }
      const field = match.winnerToSide === BracketSide.ATHLETE1 ? 'athlete1Id' : 'athlete2Id';
      if (next[field] === match.winnerId) {
        await transaction.match.update({
          where: { id: next.id },
          data: match.winnerToSide === BracketSide.ATHLETE1 ? { athlete1Id: null } : { athlete2Id: null },
        });
      }
    }

    await transaction.match.update({
      where: { id: match.id },
      data: { status: MatchStatus.SCHEDULED, winnerId: null, winMethod: null },
    });
  }

  private getLoserId(match: Match) {
    if (!match.winnerId) return null;
    return match.athlete1Id === match.winnerId ? match.athlete2Id : match.athlete1Id;
  }

  private getLoserTeamId(match: Match) {
    if (!match.winnerTeamId) return null;
    return match.team1Id === match.winnerTeamId ? match.team2Id : match.team1Id;
  }

  private async clearProgressionTarget(
    transaction: Prisma.TransactionClient,
    targetMatchId: string | null,
    targetSide: 'ATHLETE1' | 'ATHLETE2' | null,
    athleteId: string | null,
  ) {
    if (!targetMatchId || !targetSide || !athleteId) return;
    await this.assertProgressionTargetEditable(transaction, targetMatchId);
    await transaction.match.updateMany({
      where: {
        id: targetMatchId,
        ...(targetSide === 'ATHLETE1' ? { athlete1Id: athleteId } : { athlete2Id: athleteId }),
      },
      data: targetSide === 'ATHLETE1' ? { athlete1Id: null } : { athlete2Id: null },
    });
  }

  private async assignProgressionTarget(
    transaction: Prisma.TransactionClient,
    targetMatchId: string | null,
    targetSide: 'ATHLETE1' | 'ATHLETE2' | null,
    athleteId: string | null,
  ) {
    if (!targetMatchId || !targetSide || !athleteId) return;
    const target = await this.assertProgressionTargetEditable(transaction, targetMatchId);
    const occupant = targetSide === 'ATHLETE1' ? target.athlete1Id : target.athlete2Id;
    if (occupant && occupant !== athleteId) throw new ConflictException('Ô nhánh đấu đã có VĐV khác');
    await transaction.match.update({
      where: { id: targetMatchId },
      data: targetSide === 'ATHLETE1' ? { athlete1Id: athleteId } : { athlete2Id: athleteId },
    });
  }

  private async clearTeamProgressionTarget(
    transaction: Prisma.TransactionClient,
    targetMatchId: string | null,
    targetSide: 'ATHLETE1' | 'ATHLETE2' | null,
    teamId: string | null,
  ) {
    if (!targetMatchId || !targetSide || !teamId) return;
    await this.assertProgressionTargetEditable(transaction, targetMatchId);
    await transaction.match.updateMany({
      where: {
        id: targetMatchId,
        ...(targetSide === 'ATHLETE1' ? { team1Id: teamId } : { team2Id: teamId }),
      },
      data: targetSide === 'ATHLETE1' ? { team1Id: null } : { team2Id: null },
    });
  }

  private async assignTeamProgressionTarget(
    transaction: Prisma.TransactionClient,
    targetMatchId: string | null,
    targetSide: 'ATHLETE1' | 'ATHLETE2' | null,
    teamId: string | null,
  ) {
    if (!targetMatchId || !targetSide || !teamId) return;
    await this.assertProgressionTargetEditable(transaction, targetMatchId);
    await transaction.match.update({
      where: { id: targetMatchId },
      data: targetSide === 'ATHLETE1' ? { team1Id: teamId } : { team2Id: teamId },
    });
  }

  private rethrowScheduleConstraint(error: unknown): never {
    const prismaError = error as {
      code?: string;
      message?: string;
      meta?: { database_error?: string; reason?: string; constraint?: string };
    };
    const details = [
      prismaError.message,
      prismaError.meta?.database_error,
      prismaError.meta?.reason,
      prismaError.meta?.constraint,
    ].filter(Boolean).join(' ').toLowerCase();

    if (
      details.includes('match_fop_time_no_overlap')
      || (prismaError.code === 'P2004' && details.includes('exclusion'))
    ) {
      throw new ConflictException(
        'Sân/FOP đã có trận đấu khác trong khoảng thời gian này',
      );
    }
    if (details.includes('match_valid_time_range')) {
      throw new BadRequestException('Giờ kết thúc phải sau giờ bắt đầu');
    }
    throw error;
  }

  private hideUnpublishedResult<T extends Record<string, any>>(match: T): T {
    if (match.resultStatus === ResultStatus.PUBLISHED || match.resultStatus === ResultStatus.LOCKED) {
      return match;
    }
    return {
      ...match,
      athlete1Score: 0,
      athlete2Score: 0,
      athlete1Advantages: 0,
      athlete2Advantages: 0,
      athlete1Penalties: 0,
      athlete2Penalties: 0,
      winnerId: null,
      winner: null,
      winnerTeamId: null,
      winnerTeam: null,
      winMethod: null,
      resultData: null,
    };
  }

  private async assertParticipantsRegistered(
    database: PrismaService | Prisma.TransactionClient,
    eventId: string,
    categoryId: string,
    athleteIds: string[],
  ) {
    if (!athleteIds.length) return;
    const eligibleCount = await database.athlete.count({
      where: {
        id: { in: athleteIds },
        OR: [
          // Entries identify registration for the event/category used by draws.
          // Verified athletes may have no legacy event/category links.
          { entries: { some: {
            eventId,
            categoryId,
            type: 'INDIVIDUAL',
            status: { in: [EntryStatus.REGISTERED, EntryStatus.VERIFIED] },
          } } },
          // Preserve legacy registrations only when no entry exists for this
          // event/category, so stale links cannot bypass a withdrawn entry.
          {
            entries: { none: { eventId, categoryId } },
            events: { some: { id: eventId } },
            categories: { some: { id: categoryId } },
          },
        ],
      },
    });
    if (eligibleCount !== athleteIds.length) {
      throw new BadRequestException(
        'Vận động viên chưa đăng ký hạng đấu này trong sự kiện',
      );
    }
  }

  private async assertParticipantAvailability(
    database: PrismaService | Prisma.TransactionClient,
    eventId: string,
    categoryId: string,
    athleteIds: string[],
    startTime: Date,
    endTime: Date,
    excludeMatchId?: string,
  ) {
    if (!athleteIds.length) return;
    const category = await database.category.findUnique({ where: { id: categoryId }, select: { sportId: true } });
    const rules = await database.sportSchedulingRule.findMany({ where: { eventId } });
    const restMinutes = rules.find((rule) => rule.sportId === category?.sportId)?.minRestMinutes ?? 60;
    const restMs = restMinutes * 60_000;
    const conflict = await (database as any).match.findFirst({
      where: {
        eventId,
        ...(excludeMatchId ? { id: { not: excludeMatchId } } : {}),
        status: { not: MatchStatus.CANCELLED },
        startTime: { lt: new Date(endTime.getTime() + restMs) },
        endTime: { gt: new Date(startTime.getTime() - restMs) },
        OR: [
          { athlete1Id: { in: athleteIds } },
          { athlete2Id: { in: athleteIds } },
          { participants: { some: { athleteId: { in: athleteIds } } } },
          { team1: { members: { some: { athleteId: { in: athleteIds } } } } },
          { team2: { members: { some: { athleteId: { in: athleteIds } } } } },
          { participants: { some: { team: { members: { some: { athleteId: { in: athleteIds } } } } } } },
        ],
      },
      select: { id: true, matchNumber: true },
    });
    if (conflict) {
      throw new ConflictException(
        `Vận động viên bị trùng giờ thi đấu với trận #${conflict.matchNumber || conflict.id}`,
      );
    }
  }
}
