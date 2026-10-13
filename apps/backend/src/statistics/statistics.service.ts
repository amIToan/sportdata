import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AthleteRankingsDto } from './dto/athlete-rankings.dto';
import { EventStandingsDto } from './dto/event-standings.dto';
import { MedalCountsDto } from './dto/medal-counts.dto';

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);

    const [eventCount, matchCount, athleteCount, statistics, sports] = await Promise.all([
      this.prisma.event.count(),
      this.prisma.match.count(),
      this.prisma.athlete.count(),
      this.prisma.statistic.findMany({
        select: {
          sportId: true,
          athleteId: true,
          goldMedals: true,
          silverMedals: true,
          bronzeMedals: true,
          updatedAt: true,
        },
      }),
      this.prisma.sport.findMany({
        select: {
          id: true,
          name: true,
          _count: { select: { events: true } },
          categories: { select: { _count: { select: { matches: true } } } },
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    const totalMedals = statistics.reduce(
      (sum, stat) => sum + stat.goldMedals + stat.silverMedals + stat.bronzeMedals,
      0,
    );

    const bySport = sports.map((sport) => {
      const sportStatistics = statistics.filter((stat) => stat.sportId === sport.id);
      const athletes = new Set(sportStatistics.map((stat) => stat.athleteId)).size;
      const medals = sportStatistics.reduce(
        (sum, stat) => sum + stat.goldMedals + stat.silverMedals + stat.bronzeMedals,
        0,
      );
      const matches = sport.categories.reduce((sum, category) => sum + category._count.matches, 0);
      return {
        name: sport.name,
        events: sport._count.events,
        matches,
        athletes,
        medals,
      };
    });

    const months = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (6 - index), 1);
      return {
        key: `${date.getFullYear()}-${date.getMonth()}`,
        month: `T${date.getMonth() + 1}`,
        medals: 0,
      };
    });
    const monthMap = new Map(months.map((month) => [month.key, month]));
    statistics.forEach((stat) => {
      const key = `${stat.updatedAt.getFullYear()}-${stat.updatedAt.getMonth()}`;
      const bucket = monthMap.get(key);
      if (bucket) bucket.medals += stat.goldMedals + stat.silverMedals + stat.bronzeMedals;
    });

    return {
      overview: {
        total_events: eventCount,
        total_matches: matchCount,
        total_athletes: athleteCount,
        total_medals: totalMedals,
        events_change: await this.prisma.event.count({ where: { createdAt: { gte: startOfWeek } } }),
        matches_change: await this.prisma.match.count({ where: { createdAt: { gte: startOfWeek } } }),
        athletes_change: await this.prisma.athlete.count({ where: { createdAt: { gte: startOfWeek } } }),
        medals_change: 0,
      },
      bySport,
      monthlyPerformance: months.map(({ month, medals }) => ({ month, medals })),
    };
  }

  async getDashboardStats() {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [totalEvents, totalMatches, totalAthletes, liveMatches, eventsThisMonth, matchesThisMonth, athletesThisMonth] =
      await Promise.all([
        this.prisma.event.count(),
        this.prisma.match.count(),
        this.prisma.athlete.count(),
        this.prisma.match.count({ where: { status: 'RUNNING' } }),
        this.prisma.event.count({ where: { createdAt: { gte: startOfMonth } } }),
        this.prisma.match.count({ where: { createdAt: { gte: startOfMonth } } }),
        this.prisma.athlete.count({ where: { createdAt: { gte: startOfMonth } } }),
      ]);

    return { totalEvents, totalMatches, totalAthletes, liveMatches, eventsThisMonth, matchesThisMonth, athletesThisMonth };
  }

  async getRecentMatches() {
    const matches = await this.prisma.match.findMany({
      take: 5,
      orderBy: { updatedAt: 'desc' },
      include: {
        athlete1: { select: { fullName: true } },
        athlete2: { select: { fullName: true } },
        event: { include: { sport: { select: { name: true } } } },
      },
    });

    return matches.map((match) => ({
      id: match.id,
      team1: match.athlete1?.fullName || 'Chờ xác định',
      team2: match.athlete2?.fullName || 'Chờ xác định',
      score1: match.status === 'SCHEDULED' ? null : match.athlete1Score,
      score2: match.status === 'SCHEDULED' ? null : match.athlete2Score,
      status: match.status === 'RUNNING' ? 'live' : match.status === 'FINISHED' ? 'finished' : 'upcoming',
      start_time: (match.startTime || match.matchDate).toISOString(),
      venue: match.fop || match.event.location || 'Chưa cập nhật',
      sport_name: match.event.sport.name,
    }));
  }

  async getEventsChart() {
    const now = new Date();
    const months = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (6 - index), 1);
      return {
        key: `${date.getFullYear()}-${date.getMonth()}`,
        month: `T${date.getMonth() + 1}`,
        events: 0,
        matches: 0,
      };
    });
    const first = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    const [events, matches] = await Promise.all([
      this.prisma.event.findMany({ where: { startDate: { gte: first } }, select: { startDate: true } }),
      this.prisma.match.findMany({ where: { matchDate: { gte: first } }, select: { matchDate: true } }),
    ]);
    const monthMap = new Map(months.map((month) => [month.key, month]));
    events.forEach((event) => {
      const bucket = monthMap.get(`${event.startDate.getFullYear()}-${event.startDate.getMonth()}`);
      if (bucket) bucket.events += 1;
    });
    matches.forEach((match) => {
      const bucket = monthMap.get(`${match.matchDate.getFullYear()}-${match.matchDate.getMonth()}`);
      if (bucket) bucket.matches += 1;
    });
    return months.map(({ key, ...month }) => month);
  }

  async getAthleteRankings(query: AthleteRankingsDto) {
    const { sportId, eventId, categoryId, sortBy = 'winRate', limit = 100 } = query;

    const where: any = {};

    if (sportId) {
      where.sportId = sportId;
    }

    if (eventId) {
      where.eventId = eventId;
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    const statistics = await this.prisma.statistic.findMany({
      where,
      include: {
        athlete: {
          include: {
            country: true,
          },
        },
        sport: true,
        event: true,
      },
    });

    const rankedAthletes = statistics
      .map((stat) => {
        const totalMatches = stat.totalMatches || 1;
        const winRate = stat.totalWins / totalMatches;
        const totalMedals = stat.goldMedals + stat.silverMedals + stat.bronzeMedals;
        const medalScore =
          stat.goldMedals * 3 + stat.silverMedals * 2 + stat.bronzeMedals * 1;
        const totalPoints = stat.totalWins * 3 + stat.totalDraws + medalScore;

        return {
          ...stat,
          winRate,
          totalMedals,
          medalScore,
          totalPoints,
        };
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'totalWins':
            return b.totalWins - a.totalWins;
          case 'totalMatches':
            return b.totalMatches - a.totalMatches;
          case 'medals':
            return b.medalScore - a.medalScore;
          case 'points':
            return b.totalPoints - a.totalPoints;
          case 'winRate':
          default:
            return b.winRate - a.winRate;
        }
      })
      .slice(0, limit)
      .map((stat, index) => ({
        rank: index + 1,
        athleteId: stat.athleteId,
        athlete: stat.athlete,
        sport: stat.sport,
        event: stat.event,
        totalWins: stat.totalWins,
        totalLosses: stat.totalLosses,
        totalDraws: stat.totalDraws,
        totalMatches: stat.totalMatches,
        winRate: Number(stat.winRate.toFixed(4)),
        goldMedals: stat.goldMedals,
        silverMedals: stat.silverMedals,
        bronzeMedals: stat.bronzeMedals,
        totalMedals: stat.totalMedals,
        medalScore: stat.medalScore,
        totalPoints: stat.totalPoints,
      }));

    return {
      sortBy,
      count: rankedAthletes.length,
      items: rankedAthletes,
    };
  }

  async getEventStandings(eventId: string, query: EventStandingsDto) {
    const { categoryId, divisionId } = query;

    const matchesWhere: any = {
      eventId,
      status: 'FINISHED',
    };

    if (categoryId) {
      matchesWhere.categoryId = categoryId;
    }

    if (divisionId) {
      matchesWhere.divisionId = divisionId;
    }

    const matches = await this.prisma.match.findMany({
      where: matchesWhere,
      include: {
        athlete1: {
          include: {
            country: true,
            federation: true,
          },
        },
        athlete2: {
          include: {
            country: true,
            federation: true,
          },
        },
        team1: { include: { country: true, members: { include: { athlete: { include: { federation: true } } } } } },
        team2: { include: { country: true, members: { include: { athlete: { include: { federation: true } } } } } },
        category: true,
        division: true,
      },
      orderBy: { matchDate: 'desc' },
    });

    const athleteStandings = new Map<
      string,
      {
        athlete: any;
        wins: number;
        losses: number;
        draws: number;
        totalMatches: number;
        pointsFor: number;
        pointsAgainst: number;
        pointDifferential: number;
      }
    >();

    for (const match of matches) {
      for (const side of [1, 2] as const) {
        const team = side === 1 ? match.team1 : match.team2;
        if (team && ['PUBLISHED', 'LOCKED'].includes(match.resultStatus)) this.updateStandings(athleteStandings, { id: team.id, fullName: team.members.map((member) => member.athlete.fullName).join(' / '),
          country: team.country, federation: team.members[0]?.athlete.federation, isTeam: true },
          side === 1 ? match.athlete1Score : match.athlete2Score,
          side === 1 ? match.athlete2Score : match.athlete1Score, match.winnerTeamId === team.id, match.winnerTeamId === null);
      }
      if (match.athlete1Id) {
        this.updateStandings(
          athleteStandings,
          match.athlete1,
          match.athlete1Score,
          match.athlete2Score,
          match.winnerId === match.athlete1Id,
          match.winnerId === null,
        );
      }

      if (match.athlete2Id) {
        this.updateStandings(
          athleteStandings,
          match.athlete2,
          match.athlete2Score,
          match.athlete1Score,
          match.winnerId === match.athlete2Id,
          match.winnerId === null,
        );
      }
    }

    const standings = Array.from(athleteStandings.values())
      .sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.pointDifferential !== a.pointDifferential)
          return b.pointDifferential - a.pointDifferential;
        return b.pointsFor - a.pointsFor;
      })
      .map((entry, index) => ({
        rank: index + 1,
        athlete: entry.athlete,
        wins: entry.wins,
        losses: entry.losses,
        draws: entry.draws,
        totalMatches: entry.totalMatches,
        pointsFor: entry.pointsFor,
        pointsAgainst: entry.pointsAgainst,
        pointDifferential: entry.pointDifferential,
        winRate:
          entry.totalMatches > 0
            ? Number((entry.wins / entry.totalMatches).toFixed(4))
            : 0,
      }));

    return {
      eventId,
      categoryId: categoryId || null,
      divisionId: divisionId || null,
      totalMatches: matches.length,
      standings,
    };
  }

  async getMedalCounts(query: MedalCountsDto) {
    const { sportId, eventId, groupBy = 'athlete' } = query;

    const where: any = {};

    if (sportId) {
      where.sportId = sportId;
    }

    if (eventId) {
      where.eventId = eventId;
    }

    const statistics = await this.prisma.statistic.findMany({
      where,
      include: {
        athlete: {
          include: {
            country: true,
          },
        },
        sport: true,
        event: true,
      },
    });

    if (groupBy === 'country') {
      const countryMedals = new Map<
        string,
        {
          country: any;
          gold: number;
          silver: number;
          bronze: number;
          total: number;
          score: number;
        }
      >();

      for (const stat of statistics) {
        const countryId = stat.athlete.countryId;
        if (!countryMedals.has(countryId)) {
          countryMedals.set(countryId, {
            country: stat.athlete.country,
            gold: 0,
            silver: 0,
            bronze: 0,
            total: 0,
            score: 0,
          });
        }

        const entry = countryMedals.get(countryId)!;
        entry.gold += stat.goldMedals;
        entry.silver += stat.silverMedals;
        entry.bronze += stat.bronzeMedals;
        entry.total +=
          stat.goldMedals + stat.silverMedals + stat.bronzeMedals;
        entry.score += stat.goldMedals * 3 + stat.silverMedals * 2 + stat.bronzeMedals * 1;
      }

      const result = Array.from(countryMedals.values())
        .sort((a, b) => {
          if (b.gold !== a.gold) return b.gold - a.gold;
          if (b.silver !== a.silver) return b.silver - a.silver;
          if (b.bronze !== a.bronze) return b.bronze - a.bronze;
          return b.total - a.total;
        })
        .map((entry, index) => ({
          rank: index + 1,
          country: entry.country,
          gold: entry.gold,
          silver: entry.silver,
          bronze: entry.bronze,
          total: entry.total,
          score: entry.score,
        }));

      return {
        groupBy: 'country',
        items: result,
      };
    }

    const result = statistics
      .map((stat) => ({
        athlete: stat.athlete,
        sport: stat.sport,
        event: stat.event,
        gold: stat.goldMedals,
        silver: stat.silverMedals,
        bronze: stat.bronzeMedals,
        total: stat.goldMedals + stat.silverMedals + stat.bronzeMedals,
        score: stat.goldMedals * 3 + stat.silverMedals * 2 + stat.bronzeMedals * 1,
      }))
      .sort((a, b) => {
        if (b.gold !== a.gold) return b.gold - a.gold;
        if (b.silver !== a.silver) return b.silver - a.silver;
        if (b.bronze !== a.bronze) return b.bronze - a.bronze;
        return b.total - a.total;
      })
      .map((entry, index) => ({
        rank: index + 1,
        ...entry,
      }));

    return {
      groupBy: 'athlete',
      items: result,
    };
  }

  private updateStandings(
    standings: Map<
      string,
      {
        athlete: any;
        wins: number;
        losses: number;
        draws: number;
        totalMatches: number;
        pointsFor: number;
        pointsAgainst: number;
        pointDifferential: number;
      }
    >,
    athlete: any,
    pointsFor: number,
    pointsAgainst: number,
    isWinner: boolean,
    isDraw: boolean,
  ) {
    if (!standings.has(athlete.id)) {
      standings.set(athlete.id, {
        athlete,
        wins: 0,
        losses: 0,
        draws: 0,
        totalMatches: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
      });
    }

    const entry = standings.get(athlete.id)!;
    entry.totalMatches += 1;
    entry.pointsFor += pointsFor;
    entry.pointsAgainst += pointsAgainst;
    entry.pointDifferential += pointsFor - pointsAgainst;

    if (isDraw) {
      entry.draws += 1;
    } else if (isWinner) {
      entry.wins += 1;
    } else {
      entry.losses += 1;
    }
  }
}
