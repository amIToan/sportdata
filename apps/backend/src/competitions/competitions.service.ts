import { assertAthleteEligibility } from './athlete-eligibility';
import { resolveEventAgeLimits } from '../events/event-age-limits';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CompetitionFormat,
  DrawType,
  EntryStatus,
  EntryType,
  MatchStatus,
  MatchType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MatchesService } from '../matches/matches.service';
import {
  CreateEntryDto,
  CreateTeamDto,
  GenerateHeatsDto,
  GenerateRoundRobinDto,
} from './dto/competition.dto';

const ENTRY_INCLUDE = {
  country: { select: { id: true, code: true, name: true, flagUrl: true } },
  athlete: { select: { id: true, fullName: true, gender: true, birthDate: true, weight: true, federation: { select: { id: true, name: true } } } },
  team: {
    include: {
      members: {
        include: { athlete: { select: { id: true, fullName: true } } },
        orderBy: [{ relayLeg: 'asc' as const }, { createdAt: 'asc' as const }],
      },
    },
  },
} satisfies Prisma.CompetitionEntryInclude;

type EntryRow = Prisma.CompetitionEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

@Injectable()
export class CompetitionsService {
  constructor(private readonly prisma: PrismaService, private readonly matches: MatchesService) {}

  listTeams(eventId: string) {
    return this.prisma.team.findMany({
      where: { eventId },
      include: {
        sport: { select: { id: true, name: true, code: true } },
        country: { select: { id: true, name: true, code: true, flagUrl: true } },
        members: {
          include: { athlete: { select: { id: true, fullName: true, gender: true } } },
          orderBy: [{ relayLeg: 'asc' }, { createdAt: 'asc' }],
        },
        _count: { select: { entries: true } },
      },
      orderBy: [{ sport: { name: 'asc' } }, { country: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  async createTeam(eventId: string, dto: CreateTeamDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { sports: { where: { id: dto.sportId }, select: { id: true } } },
    });
    if (!event) throw new NotFoundException('Không tìm thấy sự kiện');
    if (!event.sports.length) throw new BadRequestException('Bộ môn không thuộc sự kiện này');
    const memberIds = dto.members.map(({ athleteId }) => athleteId);
    if (new Set(memberIds).size !== memberIds.length) throw new BadRequestException('Danh sách thành viên đội không được trùng lặp');
    const athletes = await this.prisma.athlete.findMany({
      where: { id: { in: memberIds }, countryId: dto.countryId },
      select: { id: true },
    });
    if (athletes.length !== memberIds.length) {
      throw new BadRequestException('Mọi thành viên phải tồn tại và đại diện đúng quốc gia đã chọn');
    }
    const relayLegs = dto.members.map(({ relayLeg }) => relayLeg).filter((leg): leg is number => Boolean(leg));
    if (new Set(relayLegs).size !== relayLegs.length) throw new BadRequestException('Thứ tự thi đấu tiếp sức không được trùng lặp');

    return this.prisma.$transaction(async (transaction) => {
      await transaction.event.update({
        where: { id: eventId },
        data: { athletes: { connect: memberIds.map((id) => ({ id })) } },
      });
      return transaction.team.create({
        data: {
          eventId,
          sportId: dto.sportId,
          countryId: dto.countryId,
          name: dto.name.trim(),
          code: dto.code?.trim(),
          gender: dto.gender,
          members: {
            create: dto.members.map((member) => ({
              athleteId: member.athleteId,
              role: member.role?.trim(),
              relayLeg: member.relayLeg,
            })),
          },
        },
        include: { country: true, sport: true, members: { include: { athlete: true } } },
      });
    });
  }

  listEntries(eventId: string, categoryId: string) {
    return this.prisma.competitionEntry.findMany({
      where: { eventId, categoryId },
      include: ENTRY_INCLUDE,
      orderBy: [{ seed: 'asc' }, { country: { name: 'asc' } }, { createdAt: 'asc' }],
    });
  }

  async updateEntrySeed(entryId: string, seed: number | null) {
    const entry = await this.prisma.competitionEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Không tìm thấy lượt thi đấu');
    if (seed !== null) {
      const duplicate = await this.prisma.competitionEntry.findFirst({
        where: {
          id: { not: entryId },
          eventId: entry.eventId,
          categoryId: entry.categoryId,
          seed,
          status: { not: EntryStatus.WITHDRAWN },
        },
        select: { id: true },
      });
      if (duplicate) throw new BadRequestException(`Hạt giống số ${seed} đã được sử dụng trong hạng đấu này`);
    }
    return this.prisma.competitionEntry.update({
      where: { id: entryId },
      data: { seed },
      include: ENTRY_INCLUDE,
    });
  }

  async createEntry(eventId: string, categoryId: string, dto: CreateEntryDto) {
    if (dto.type === EntryType.INDIVIDUAL && (!dto.athleteId || dto.teamId)) {
      throw new BadRequestException('Lượt đăng ký cá nhân chỉ được chọn một vận động viên');
    }
    if ((dto.type === EntryType.TEAM || dto.type === EntryType.RELAY) && (!dto.teamId || dto.athleteId)) {
      throw new BadRequestException('Lượt đăng ký đội hoặc tiếp sức phải chọn một đội');
    }
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, events: { some: { id: eventId } } },
      include: {
        sport: { select: { id: true } },
        events: {
          where: { id: eventId },
          select: { startDate: true, ageLimitMode: true, minAge: true, maxAge: true },
          take: 1,
        },
      },
    });
    if (!category) throw new NotFoundException('Hạng mục không thuộc sự kiện này');
    if (['DUO', 'SHOW'].includes(category.discipline || '') && dto.type !== EntryType.TEAM) throw new BadRequestException('DUO/SHOW chỉ nhận cặp thi đấu gồm hai VĐV');

    let countryId: string;
    if (dto.athleteId) {
      const athlete = await this.prisma.athlete.findUnique({ where: { id: dto.athleteId } });
      if (!athlete) throw new NotFoundException('Không tìm thấy vận động viên');
      assertAthleteEligibility(athlete, { ...category, ...resolveEventAgeLimits(category.events[0], category) }, category.events[0].startDate);
      countryId = athlete.countryId;
    } else {
      const team = await this.prisma.team.findFirst({
        where: { id: dto.teamId, eventId, sportId: category.sportId },
        include: { members: { include: { athlete: true } } },
      });
      if (!team) throw new BadRequestException('Đội không thuộc sự kiện hoặc bộ môn này');
      if (['DUO', 'SHOW'].includes(category.discipline || '')) {
        if (team.members.length !== 2) throw new BadRequestException('DUO/SHOW cần đúng hai thành viên');
        for (const member of team.members) assertAthleteEligibility(member.athlete, { ...category, ...resolveEventAgeLimits(category.events[0], category) }, category.events[0].startDate);
      }
      if (category.gender !== 'MIXED' && team.gender && team.gender !== category.gender) {
        throw new BadRequestException('Giới tính của đội không đáp ứng điều kiện hạng mục');
      }
      countryId = team.countryId;
    }

    return this.prisma.$transaction(async (transaction) => {
      if (category.maxEntriesPerCountry) {
        await transaction.$queryRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`${eventId}:${categoryId}:${countryId}`}, 0)
          )
        `);
        const currentCountryEntries = await transaction.competitionEntry.count({
          where: {
            eventId,
            categoryId,
            countryId,
            status: { in: [EntryStatus.REGISTERED, EntryStatus.VERIFIED] },
          },
        });
        if (currentCountryEntries >= category.maxEntriesPerCountry) {
          throw new BadRequestException(
            `Quốc gia đã đạt giới hạn ${category.maxEntriesPerCountry} entry cho hạng mục này`,
          );
        }
      }
      if (dto.athleteId) {
        await transaction.event.update({ where: { id: eventId }, data: { athletes: { connect: { id: dto.athleteId } } } });
        await transaction.category.update({ where: { id: categoryId }, data: { athletes: { connect: { id: dto.athleteId } } } });
      }
      return transaction.competitionEntry.create({
        data: {
          eventId,
          categoryId,
          countryId,
          type: dto.type,
          status: dto.status || EntryStatus.REGISTERED,
          athleteId: dto.athleteId,
          teamId: dto.teamId,
          seed: dto.seed,
          bib: dto.bib?.trim(),
          notes: dto.notes?.trim(),
        },
        include: ENTRY_INCLUDE,
      });
    });
  }

  async generateHeats(eventId: string, categoryId: string, dto: GenerateHeatsDto) {
    const [event, category, entries] = await Promise.all([
      this.prisma.event.findUnique({ where: { id: eventId }, select: { startDate: true, endDate: true } }),
      this.prisma.category.findFirst({
        where: { id: categoryId, events: { some: { id: eventId } } },
        select: { id: true, laneCount: true },
      }),
      this.loadEntries(eventId, categoryId, dto.entryIds),
    ]);
    if (!event || !category) throw new NotFoundException('Không tìm thấy sự kiện hoặc hạng mục');
    const laneCount = dto.laneCount || category.laneCount || 8;
    const heatCount = Math.ceil(entries.length / laneCount);
    const buckets = this.distributeEntries(entries, heatCount, 'lượt chạy');
    const maximum = await this.prisma.match.aggregate({ where: { eventId }, _max: { matchNumber: true } });
    let matchNumber = (maximum._max.matchNumber || 0) + 1;
    const round = dto.round || 1;
    const prefix = dto.namePrefix?.trim() || 'Heat';

    return this.prisma.$transaction(async (transaction) => {
      await transaction.category.update({ where: { id: categoryId }, data: { format: CompetitionFormat.HEAT, laneCount } });
      const generated = [];
      for (let index = 0; index < buckets.length; index += 1) {
        const members = buckets[index];
        const laneOrder = this.laneOrder(laneCount);
        const match = await transaction.match.create({
          data: {
            eventId,
            categoryId,
            matchDate: this.evenEventDate(event.startDate, event.endDate, index, buckets.length),
            matchNumber: matchNumber++,
            matchType: MatchType.HEAT,
            status: MatchStatus.SCHEDULED,
            athlete1Id: members[0]?.athleteId,
            athlete2Id: members[1]?.athleteId,
            team1Id: members[0]?.teamId,
            team2Id: members[1]?.teamId,
            participants: {
              create: members.map((entry, memberIndex) => ({
                entryId: entry.id,
                athleteId: entry.athleteId,
                teamId: entry.teamId,
                lane: laneOrder[memberIndex],
                position: memberIndex + 1,
              })),
            },
          },
        });
        generated.push(await transaction.heat.create({
          data: {
            eventId,
            categoryId,
            matchId: match.id,
            name: `${prefix} ${index + 1}`,
            round,
            sequence: index + 1,
            lanes: {
              create: members.map((entry, memberIndex) => ({
                entryId: entry.id,
                athleteId: entry.athleteId,
                lane: laneOrder[memberIndex],
              })),
            },
          },
          include: { match: true, lanes: { include: { entry: { include: ENTRY_INCLUDE } } } },
        }));
      }
      return generated;
    });
  }

  async generateRoundRobin(eventId: string, categoryId: string, dto: GenerateRoundRobinDto, actorUserId?: string) {
    const [event, category, entries] = await Promise.all([
      this.prisma.event.findUnique({ where: { id: eventId }, select: { startDate: true, endDate: true } }),
      this.prisma.category.findFirst({ where: { id: categoryId, events: { some: { id: eventId } } }, select: { id: true } }),
      this.loadEntries(eventId, categoryId, dto.entryIds),
    ]);
    if (!event || !category) throw new NotFoundException('Không tìm thấy sự kiện hoặc hạng mục');
    const configuration = await this.prisma.drawPreconfiguration.findUnique({
      where: { eventId_categoryId_drawType: { eventId, categoryId, drawType: DrawType.ROUND_ROBIN_POOL } },
    });
    if (configuration) {
      const result = await this.matches.generateDraw(eventId, categoryId, {
        type: DrawType.ROUND_ROBIN_POOL, athleteIds: entries.map((entry) => (entry.teamId || entry.athleteId)!),
        groupCount: dto.groupCount, name: dto.namePrefix,
      }, actorUserId);
      const groups = await this.prisma.roundRobinGroup.findMany({ where: { eventId, categoryId }, include: { _count: { select: { members: true } } } });
      return { groups: groups.map((group) => ({ groupId: group.id, name: group.name, entries: group._count.members,
        rounds: group._count.members % 2 ? group._count.members : group._count.members - 1 })),
        matches: result.draws.reduce((sum, draw) => sum + draw.matches.length, 0) };
    }
    const groupCount = dto.groupCount || 1;
    if (groupCount > Math.floor(entries.length / 2)) throw new BadRequestException('Mỗi bảng vòng tròn phải có ít nhất hai lượt đăng ký');
    const groups = this.distributeEntries(entries, groupCount, 'bảng đấu');
    const groupRounds = groups.map((members) => this.roundRobinRounds(members));
    const totalMatches = groupRounds.reduce(
      (sum, rounds) => sum + rounds.reduce((roundSum, pairs) => roundSum + pairs.length, 0),
      0,
    );
    let generatedMatchIndex = 0;
    const maximum = await this.prisma.match.aggregate({ where: { eventId }, _max: { matchNumber: true } });
    let matchNumber = (maximum._max.matchNumber || 0) + 1;
    const prefix = dto.namePrefix?.trim() || 'Bảng';

    return this.prisma.$transaction(async (transaction) => {
      await transaction.category.update({ where: { id: categoryId }, data: { format: CompetitionFormat.ROUND_ROBIN } });
      const generated = [];
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        const members = groups[groupIndex];
        const group = await transaction.roundRobinGroup.create({
          data: {
            eventId,
            categoryId,
            name: `${prefix} ${String.fromCharCode(65 + groupIndex)}`,
            members: { create: members.map((entry) => ({ entryId: entry.id, seed: entry.seed })) },
          },
        });
        const rounds = groupRounds[groupIndex];
        for (let roundIndex = 0; roundIndex < rounds.length; roundIndex += 1) {
          for (const [first, second] of rounds[roundIndex]) {
            await transaction.match.create({
              data: {
                eventId,
                categoryId,
                roundRobinGroupId: group.id,
                matchDate: this.evenEventDate(
                  event.startDate,
                  event.endDate,
                  generatedMatchIndex++,
                  totalMatches,
                ),
                matchNumber: matchNumber++,
                matchType: MatchType.GROUP_STAGE,
                round: roundIndex + 1,
                pool: group.name,
                status: MatchStatus.SCHEDULED,
                athlete1Id: first.athleteId,
                athlete2Id: second.athleteId,
                team1Id: first.teamId,
                team2Id: second.teamId,
                participants: {
                  create: [first, second].map((entry, index) => ({
                    entryId: entry.id,
                    athleteId: entry.athleteId,
                    teamId: entry.teamId,
                    position: index + 1,
                  })),
                },
              },
            });
          }
        }
        generated.push({ groupId: group.id, name: group.name, entries: members.length, rounds: rounds.length });
      }
      return { groups: generated, matches: matchNumber - (maximum._max.matchNumber || 0) - 1 };
    });
  }

  private async loadEntries(eventId: string, categoryId: string, entryIds: string[]) {
    const entries = await this.prisma.competitionEntry.findMany({
      where: {
        id: { in: entryIds },
        eventId,
        categoryId,
        status: { in: [EntryStatus.REGISTERED, EntryStatus.VERIFIED] },
      },
      include: ENTRY_INCLUDE,
    });
    if (entries.length !== entryIds.length) throw new BadRequestException('Có lượt đăng ký không hợp lệ hoặc đã ngừng tham gia');
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    return entryIds.map((id) => byId.get(id) as EntryRow);
  }

  /**
   * Distribute seeds before unseeded entries. Seeded athletes from the same
   * federation/club are never put in the same pool. Unseeded athletes keep the
   * usual balanced snake distribution and are not subject to this constraint.
   */
  private distributeEntries(entries: EntryRow[], bucketCount: number, bucketLabel: string) {
    const ordered = [...entries].sort((left, right) => (
      (left.seed ?? Number.MAX_SAFE_INTEGER) - (right.seed ?? Number.MAX_SAFE_INTEGER)
    ));
    const buckets: EntryRow[][] = Array.from({ length: bucketCount }, () => []);
    const seeded = ordered.filter((entry) => entry.seed !== null);
    const unseeded = ordered.filter((entry) => entry.seed === null);
    const federationSeeds = new Map<string, { name: string; count: number }>();

    seeded.forEach((entry) => {
      const federation = entry.athlete?.federation;
      if (!federation) return;
      const current = federationSeeds.get(federation.id);
      federationSeeds.set(federation.id, {
        name: federation.name,
        count: (current?.count || 0) + 1,
      });
    });

    const impossible = [...federationSeeds.values()].find(({ count }) => count > bucketCount);
    if (impossible) {
      throw new BadRequestException(
        `Đơn vị/CLB "${impossible.name}" có ${impossible.count} vận động viên hạt giống nhưng chỉ có ${bucketCount} ${bucketLabel}. Vui lòng tăng số ${bucketLabel} hoặc bỏ bớt hạt giống.`,
      );
    }

    const preferredBucket = (position: number) => {
      const block = Math.floor(position / bucketCount);
      const offset = position % bucketCount;
      return block % 2 === 0 ? offset : bucketCount - 1 - offset;
    };
    const chooseBucket = (entry: EntryRow, position: number) => {
      const federationId = entry.athlete?.federation?.id;
      const eligible = buckets
        .map((bucket, index) => ({ bucket, index }))
        .filter(({ bucket }) => !federationId || !bucket.some((member) => member.athlete?.federation?.id === federationId));
      if (!eligible.length) {
        throw new BadRequestException('Không thể tách các vận động viên hạt giống cùng đơn vị/CLB sang các bảng khác nhau.');
      }
      const smallestSize = Math.min(...eligible.map(({ bucket }) => bucket.length));
      const balanced = eligible.filter(({ bucket }) => bucket.length === smallestSize);
      const preferred = preferredBucket(position);
      return balanced.find(({ index }) => index === preferred)?.index ?? balanced[0].index;
    };

    seeded.forEach((entry, index) => buckets[chooseBucket(entry, index)].push(entry));
    unseeded.forEach((entry, index) => {
      const smallestSize = Math.min(...buckets.map((bucket) => bucket.length));
      const candidates = buckets
        .map((bucket, bucketIndex) => ({ bucket, bucketIndex }))
        .filter(({ bucket }) => bucket.length === smallestSize);
      const preferred = preferredBucket(seeded.length + index);
      const bucketIndex = candidates.find((candidate) => candidate.bucketIndex === preferred)?.bucketIndex
        ?? candidates[0].bucketIndex;
      buckets[bucketIndex].push(entry);
    });

    return buckets;
  }

  private laneOrder(laneCount: number) {
    const result: number[] = [];
    let left = Math.ceil(laneCount / 2);
    let right = left + 1;
    while (result.length < laneCount) {
      if (left >= 1) result.push(left--);
      if (right <= laneCount) result.push(right++);
    }
    return result;
  }

  private roundRobinRounds(entries: EntryRow[]) {
    const rotation: Array<EntryRow | null> = [...entries];
    if (rotation.length % 2) rotation.push(null);
    const rounds: Array<Array<[EntryRow, EntryRow]>> = [];
    for (let round = 0; round < rotation.length - 1; round += 1) {
      const pairs: Array<[EntryRow, EntryRow]> = [];
      for (let index = 0; index < rotation.length / 2; index += 1) {
        const first = rotation[index];
        const second = rotation[rotation.length - 1 - index];
        if (first && second) pairs.push(round % 2 ? [second, first] : [first, second]);
      }
      rounds.push(pairs);
      rotation.splice(1, 0, rotation.pop() || null);
    }
    return rounds;
  }

  private evenEventDate(startDate: Date, endDate: Date, index: number, total: number) {
    const dayMs = 86_400_000;
    const dayCount = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / dayMs) + 1);
    const dayIndex = total <= 1
      ? 0
      : Math.round((index * (dayCount - 1)) / (total - 1));
    return new Date(startDate.getTime() + dayIndex * dayMs);
  }
}
