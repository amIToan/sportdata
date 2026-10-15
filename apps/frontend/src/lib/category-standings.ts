interface PlacementMatch {
  id: string;
  status: string;
  matchType: string;
  athlete1?: { id: string } | null;
  athlete2?: { id: string } | null;
  team1?: { id: string } | null;
  team2?: { id: string } | null;
  winnerId?: string | null;
  winnerTeamId?: string | null;
  winnerToMatchId?: string | null;
  loserToMatchId?: string | null;
}

interface PlacementDraw {
  type: string;
  matches: PlacementMatch[];
}

// Bout totals are useful statistics, but medal places come from the bracket.
export function categoryMedalStandings<T extends { rank: number; athlete: { id: string } }>(
  standings: T[], draws: PlacementDraw[],
): T[] {
  if (draws.some((draw) => draw.type === 'DOUBLE_ELIMINATION')) return standings;
  const mainMatches = draws.filter((draw) => ['MAIN_TREE', 'POOL_WINNER_TREE'].includes(draw.type))
    .flatMap((draw) => draw.matches);
  const finals = mainMatches.filter((match) => match.matchType === 'FINAL' && !match.winnerToMatchId);
  if (finals.length !== 1) return standings;

  const winner = (match: PlacementMatch) => match.status === 'FINISHED'
    ? match.winnerTeamId || match.winnerId : null;
  const loser = (match: PlacementMatch) => {
    const id = winner(match);
    const first = match.team1?.id || match.athlete1?.id;
    const second = match.team2?.id || match.athlete2?.id;
    return id && first && second ? (id === first ? second : id === second ? first : null) : null;
  };
  const final = finals[0];
  const gold = winner(final);
  const silver = loser(final);
  if (!gold || !silver) return standings;

  const repechage = draws.filter((draw) => ['REPECHAGE', 'REPECHAGE_QUARTERFINALS'].includes(draw.type));
  let bronze: (string | null | undefined)[];
  if (repechage.length) {
    const bronzeMatches = repechage.flatMap((draw) => draw.matches)
      .filter((match) => match.matchType === 'ELIMINATION' && !match.winnerToMatchId);
    if (bronzeMatches.length !== 2) return standings;
    bronze = bronzeMatches.map(winner);
  } else {
    const semifinals = mainMatches.filter((match) => match.winnerToMatchId === final.id);
    if (semifinals.some((match) => match.loserToMatchId)) return standings;
    bronze = semifinals.map(loser);
  }
  if (bronze.some((id) => !id)) return standings;
  const medalIds = [gold, silver, ...bronze] as string[];
  if (new Set(medalIds).size !== medalIds.length
    || medalIds.some((id) => !standings.some((entry) => entry.athlete.id === id))) return standings;

  const ranks = new Map(medalIds.map((id, index) => [id, Math.min(index + 1, 3)]));
  return [...standings]
    .sort((left, right) => (ranks.get(left.athlete.id) ?? Infinity) - (ranks.get(right.athlete.id) ?? Infinity))
    .map((entry, index) => ({ ...entry, rank: ranks.get(entry.athlete.id) ?? index + 1 }));
}
