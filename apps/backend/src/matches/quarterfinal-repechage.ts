type BracketMatch = {
  id: string;
  drawId?: string | null;
  round?: number | null;
  winnerToMatchId?: string | null;
  loserToMatchId?: string | null;
};

export function repechageSemifinalIds(match: BracketMatch, matches: BracketMatch[], draws: { id: string; type: string }[]) {
  if (match.round !== 1 || !draws.some((draw) => draw.id === match.drawId && draw.type === 'REPECHAGE_QUARTERFINALS')) return [];
  const repechageIds = new Set(matches.filter((item) => item.drawId === match.drawId && item.round === 1).map((item) => item.id));
  return [...new Set(matches.filter((item) => item.loserToMatchId && repechageIds.has(item.loserToMatchId))
    .map((item) => item.winnerToMatchId).filter((id): id is string => Boolean(id)))];
}
