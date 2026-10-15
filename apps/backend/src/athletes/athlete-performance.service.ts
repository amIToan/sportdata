import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const eventSelect = { id: true, name: true, startDate: true, endDate: true, location: true } as const;
const official = (match: { resultStatus: string }) => ['PUBLISHED', 'LOCKED'].includes(match.resultStatus);
export function matchOutcome(match: any, athleteId: string): 'win' | 'loss' | 'draw' | 'pending' {
  if (!official(match)) return 'pending';
  const teamIds = [match.team1, match.team2, ...((match.participants || []).map((p: any) => p.team))]
    .filter((team: any) => team?.members.some((member: any) => member.athleteId === athleteId)).map((team: any) => team.id);
  if (match.winnerId) return match.winnerId === athleteId ? 'win' : 'loss';
  if (match.winnerTeamId) return teamIds.includes(match.winnerTeamId) ? 'win' : 'loss';
  const participant = match.participants?.find((p: any) => p.athleteId === athleteId || teamIds.includes(p.teamId));
  if (participant?.rank) return participant.rank === 1 ? 'win' : 'loss';
  // Timed/scored multi-participant events without a published rank are not draws.
  if (['HEAT', 'QUALIFIER'].includes(match.matchType)) return 'pending';
  return 'draw';
}

@Injectable()
export class AthletePerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  async get(id: string) {
    const athlete = await this.prisma.athlete.findUnique({ where: { id }, select: {
      events: { select: eventSelect },
      statistics: { select: { eventId: true, sportId: true, goldMedals: true, silverMedals: true, bronzeMedals: true, event: { select: eventSelect } } },
    } });
    if (!athlete) throw new NotFoundException('Không tìm thấy vận động viên');
    const involvement = { OR: [
      { athlete1Id: id }, { athlete2Id: id },
      { team1: { members: { some: { athleteId: id } } } }, { team2: { members: { some: { athleteId: id } } } },
      { participants: { some: { OR: [{ athleteId: id }, { team: { members: { some: { athleteId: id } } } }] } } },
    ] };
    const team = { select: { id: true, members: { select: { athleteId: true } } } } as const;
    const [matches, registrations, entries] = await Promise.all([
      this.prisma.match.findMany({ where: involvement, select: {
        id: true, eventId: true, categoryId: true, status: true, matchType: true, resultStatus: true, winMethod: true,
        athlete1Id: true, athlete2Id: true, team1Id: true, team2Id: true, winnerId: true, winnerTeamId: true,
        event: { select: eventSelect }, category: { select: { id: true, name: true, sportId: true } },
        team1: team, team2: team, participants: { select: { athleteId: true, teamId: true, rank: true, team } },
      } }),
      this.prisma.eventRegistration.findMany({ where: { athleteId: id, status: 'CONFIRMED' }, select: { event: { select: eventSelect }, category: { select: { id: true, name: true } } } }),
      this.prisma.competitionEntry.findMany({ where: { OR: [{ athleteId: id }, { team: { members: { some: { athleteId: id } } } }], status: { in: ['REGISTERED', 'VERIFIED'] } }, select: { event: { select: eventSelect }, category: { select: { id: true, name: true } } } }),
    ]);
    type Row = { event: typeof athlete.events[number]; totalMatches: number; wins: number; losses: number; draws: number; pendingResults: number; upcomingMatches: number; goldMedals: number; silverMedals: number; bronzeMedals: number; categories: { id: string; name: string }[]; achievements: { category: string; label: string }[] };
    const events = new Map<string, Row>();
    const row = (event: typeof athlete.events[number]) => {
      if (!events.has(event.id)) events.set(event.id, { event, totalMatches: 0, wins: 0, losses: 0, draws: 0, pendingResults: 0, upcomingMatches: 0, goldMedals: 0, silverMedals: 0, bronzeMedals: 0, categories: [], achievements: [] });
      return events.get(event.id)!;
    };
    const addCategory = (target: Row, category: { id: string; name: string }) => { if (!target.categories.some((item) => item.id === category.id)) target.categories.push({ id: category.id, name: category.name }); };
    athlete.events.forEach(row);
    [...registrations, ...entries].forEach((item) => addCategory(row(item.event), item.category));
    for (const match of matches) {
      if (match.status === 'CANCELLED') continue;
      const target = row(match.event); addCategory(target, match.category);
      // Automatic advancement with an empty side is not a contested bout.
      const bye = !['HEAT', 'QUALIFIER'].includes(match.matchType) && ((!match.athlete1Id && !match.team1Id) || (!match.athlete2Id && !match.team2Id));
      if (bye && match.participants.length < 2) continue;
      if (match.status !== 'FINISHED') { target.upcomingMatches++; continue; }
      target.totalMatches++;
      const outcome = matchOutcome(match, id);
      if (outcome === 'pending') target.pendingResults++;
      else if (outcome === 'win') target.wins++;
      else if (outcome === 'loss') target.losses++;
      else target.draws++;
    }
    // Award only from completed, published placement matches; never rank by win totals.
    const scopes = [...new Map(matches.map((match) => [`${match.eventId}:${match.categoryId}`, { eventId: match.eventId, categoryId: match.categoryId }])).values()];
    const draws = scopes.length ? await this.prisma.draw.findMany({ where: { OR: scopes }, include: { matches: { select: {
      id: true, status: true, resultStatus: true, matchType: true, winnerToMatchId: true, loserToMatchId: true,
      athlete1Id: true, athlete2Id: true, winnerId: true, winnerTeamId: true, team1: team, team2: team,
      category: { select: { name: true, sportId: true } },
    } } } }) : [];
    const derived = new Map<string, { goldMedals: number; silverMedals: number; bronzeMedals: number }>();
    const awarded = new Set<string>();
    const award = (draw: typeof draws[number], match: typeof draws[number]['matches'][number], medal: 'goldMedals' | 'silverMedals' | 'bronzeMedals') => {
      const key = `${draw.eventId}:${draw.categoryId}:${draw.divisionId || ''}`;
      if (awarded.has(key)) return;
      awarded.add(key);
      const target = events.get(draw.eventId); if (!target) return;
      const sportKey = `${draw.eventId}:${match.category.sportId}`;
      const tally = derived.get(sportKey) || { goldMedals: 0, silverMedals: 0, bronzeMedals: 0 };
      tally[medal]++; derived.set(sportKey, tally);
      target.achievements.push({ category: match.category.name, label: { goldMedals: 'Huy chương Vàng', silverMedals: 'Huy chương Bạc', bronzeMedals: 'Huy chương Đồng' }[medal] });
    };
    for (const draw of draws) {
      const related = draws.filter((item) => item.eventId === draw.eventId && item.categoryId === draw.categoryId && item.divisionId === draw.divisionId);
      if (related.some((item) => item.type === 'DOUBLE_ELIMINATION')) continue;
      for (const match of draw.matches) {
        if (match.status !== 'FINISHED' || !official(match) || (!match.winnerId && !match.winnerTeamId)) continue;
        const involved = match.athlete1Id === id || match.athlete2Id === id || [match.team1, match.team2].some((item) => item?.members.some((member) => member.athleteId === id));
        if (!involved) continue;
        const won = matchOutcome(match, id) === 'win';
        if (['MAIN_TREE', 'POOL_WINNER_TREE'].includes(draw.type) && match.matchType === 'FINAL' && !match.winnerToMatchId) award(draw, match, won ? 'goldMedals' : 'silverMedals');
        else if (['REPECHAGE', 'REPECHAGE_QUARTERFINALS'].includes(draw.type) && match.matchType === 'ELIMINATION' && !match.winnerToMatchId && won) award(draw, match, 'bronzeMedals');
        else if (draw.type === 'MAIN_TREE' && match.matchType === 'SEMIFINAL' && !won && !match.loserToMatchId && !related.some((item) => ['REPECHAGE', 'REPECHAGE_QUARTERFINALS'].includes(item.type))) {
          const final = draw.matches.find((item) => item.id === match.winnerToMatchId && item.matchType === 'FINAL' && official(item) && item.status === 'FINISHED');
          if (final) award(draw, match, 'bronzeMedals');
        }
      }
    }
    // Published placements supersede the legacy medal cache for the same event/sport.
    const medals = new Map(derived);
    for (const stat of athlete.statistics) {
      if (!stat.event) continue;
      row(stat.event);
      const key = `${stat.eventId}:${stat.sportId}`;
      if (derived.has(key)) continue;
      const previous = medals.get(key) || { goldMedals: 0, silverMedals: 0, bronzeMedals: 0 };
      medals.set(key, { goldMedals: Math.max(previous.goldMedals, stat.goldMedals), silverMedals: Math.max(previous.silverMedals, stat.silverMedals), bronzeMedals: Math.max(previous.bronzeMedals, stat.bronzeMedals) });
    }
    for (const [key, tally] of medals) {
      const target = events.get(key.split(':')[0]); if (target) for (const medal of ['goldMedals', 'silverMedals', 'bronzeMedals'] as const) target[medal] += tally[medal];
    }
    const history = [...events.values()].sort((a, b) => b.event.startDate.getTime() - a.event.startDate.getTime());
    const totals = { totalMatches: 0, wins: 0, losses: 0, draws: 0, pendingResults: 0, upcomingMatches: 0, goldMedals: 0, silverMedals: 0, bronzeMedals: 0 };
    for (const item of history) for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += item[key];
    return { ...totals, eventCount: history.length, winRate: totals.wins + totals.losses + totals.draws ? Math.round(totals.wins / (totals.wins + totals.losses + totals.draws) * 100) : 0, events: history };
  }
}
