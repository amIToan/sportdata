import { contentGroupKey, isAutomaticScheduleBye, scheduleParticipantIds, ScheduleGraphError } from './main-tree';

/** Follow actual outcomes when available, including the loser/repechage path. */
export function participantResolver(matches: any[], teams: Map<string, string[]>, draws: any[] = []) {
  const byId = new Map(matches.map((match) => [match.id, match]));
  const sources = new Map<string, Array<{ match: any; winner: boolean }>>();
  for (const match of matches) for (const winner of [true, false]) {
    const target = winner ? match.winnerToMatchId : match.loserToMatchId;
    if (target) sources.set(target, [...(sources.get(target) || []), { match, winner }]);
  }
  const cache = new Map<string, string[]>();
  const resolve = (id: string, visiting = new Set<string>()): string[] => {
    if (visiting.has(id)) throw new ScheduleGraphError('DEPENDENCY_CYCLE', 'Quan hệ trận nguồn tạo thành chu trình.', [id]);
    if (cache.has(id)) return cache.get(id)!;
    const match = byId.get(id);
    if (!match) throw new ScheduleGraphError('PREDECESSOR_NOT_AVAILABLE', 'Không tìm thấy trận nguồn.', [id]);
    const known = scheduleParticipantIds(match, teams);
    if ((match.athlete1Id || match.team1Id) && (match.athlete2Id || match.team2Id)) { cache.set(id, known); return known; }
    const next = new Set([...visiting, id]);
    const possible = (sources.get(id) || []).flatMap(({ match: source, winner }) => {
      if (isAutomaticScheduleBye(source) && !winner) return [];
      if (source.status === 'FINISHED' && (source.winnerId || source.winnerTeamId)) {
        const winners = scheduleParticipantIds({ athlete1Id: source.winnerId, team1Id: source.winnerTeamId }, teams);
        return winner ? winners : resolve(source.id, next).filter((key) => !winners.includes(key));
      }
      return resolve(source.id, next);
    });
    const draw = draws.find((draw) => draw.id === match.drawId) || match.draw;
    if (draw?.type === 'POOL_WINNER_TREE' && match.round === 1) {
      for (const pool of matches.filter((item) => item.categoryId === match.categoryId
        && (item.roundRobinGroupId || (draws.find((draw) => draw.id === item.drawId) || item.draw)?.type === 'ROUND_ROBIN_POOL'))) {
        possible.push(...resolve(pool.id, next));
      }
    }
    const result = [...new Set([...known, ...possible])].sort();
    cache.set(id, result); return result;
  };
  return resolve;
}

export type ContentRow = { contentKey?: string; matchId?: string; planId?: string; start: number; end: number;
  participantIds: string[]; candidateParticipantIds: string[]; minRestSeconds: number };
export type ContentSpan = { contentKey: string; participantId: string; start: number; end: number;
  matchIds: string[]; planIds: string[]; minRestSeconds: number };

/** A participant remains in a content from their first match to their last possible match, including gaps and nights. */
export function participantContentSpans(rows: ContentRow[]): ContentSpan[] {
  const spans = new Map<string, ContentSpan>();
  for (const row of rows) {
    if (!row.contentKey) continue;
    for (const participantId of new Set([...row.participantIds, ...row.candidateParticipantIds])) {
      const key = JSON.stringify([row.contentKey, participantId]);
      const span = spans.get(key) || { contentKey: row.contentKey, participantId, start: row.start, end: row.end,
        matchIds: [], planIds: [], minRestSeconds: 0 };
      span.start = Math.min(span.start, row.start); span.end = Math.max(span.end, row.end);
      span.minRestSeconds = Math.max(span.minRestSeconds, row.minRestSeconds);
      if (row.matchId && !span.matchIds.includes(row.matchId)) span.matchIds.push(row.matchId);
      if (row.planId && !span.planIds.includes(row.planId)) span.planIds.push(row.planId);
      spans.set(key, span);
    }
  }
  return [...spans.values()];
}

export function contentConflicts(own: ContentSpan[], others: ContentSpan[]) {
  return own.flatMap((left) => others.filter((right) => left.participantId === right.participantId && left.contentKey !== right.contentKey
    && left.start < right.end + Math.max(left.minRestSeconds, right.minRestSeconds) * 1000
    && left.end + Math.max(left.minRestSeconds, right.minRestSeconds) * 1000 > right.start).map((right) => ({ left, right })));
}

export function activeContentBlockers(matches: any[], teams: Map<string, string[]>, current: any) {
  const candidates = participantResolver(matches, teams);
  const currentKey = contentGroupKey(current.category);
  const result: Array<{ participantId: string; categoryId: string; matchIds: string[] }> = [];
  const real = matches.filter((match) => !isAutomaticScheduleBye(match) && match.status !== 'CANCELLED');
  for (const participantId of scheduleParticipantIds(current, teams)) {
    const started = real.filter((match) => contentGroupKey(match.category) !== currentKey
      && ['RUNNING', 'FINISHED'].includes(match.status) && scheduleParticipantIds(match, teams).includes(participantId));
    for (const categoryId of new Set(started.map((match) => match.categoryId))) {
      const pending = real.filter((match) => match.categoryId === categoryId && match.status !== 'FINISHED' && candidates(match.id).includes(participantId));
      if (pending.length) result.push({ participantId, categoryId, matchIds: pending.map((match) => match.id) });
    }
  }
  return result;
}
