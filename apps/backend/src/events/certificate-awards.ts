type Team = { id: string; members: { athleteId: string }[] };
type PlacementMatch = {
  id: string; status: string; resultStatus: string; matchType: string;
  athlete1Id: string | null; athlete2Id: string | null; winnerId: string | null; winnerTeamId: string | null;
  winnerToMatchId: string | null; loserToMatchId: string | null; team1: Team | null; team2: Team | null;
};
type PlacementDraw = { eventId: string; categoryId: string; divisionId: string | null; type: string; matches: PlacementMatch[] };

// Only explicit, published medal placements can prefill a certificate.
export function certificateAwards(draws: PlacementDraw[]): Map<string, string> {
  const awards = new Map<string, Set<string>>();
  const official = (match: PlacementMatch) => match.status === 'FINISHED' && ['PUBLISHED', 'LOCKED'].includes(match.resultStatus);
  const side = (match: PlacementMatch, winner: boolean) => {
    const first = match.winnerTeamId ? match.team1?.id : match.athlete1Id;
    const second = match.winnerTeamId ? match.team2?.id : match.athlete2Id;
    const win = match.winnerTeamId || match.winnerId;
    if (!win || (win !== first && win !== second)) return [];
    const target = winner ? win : win === first ? second : first;
    if (!target) return [];
    return match.winnerTeamId ? [match.team1, match.team2].find((team) => team?.id === target)?.members.map((member) => member.athleteId) || [] : [target];
  };
  const add = (draw: PlacementDraw, match: PlacementMatch, winner: boolean, label: string) => {
    for (const id of side(match, winner)) {
      const key = `${id}:${draw.categoryId}`;
      if (!awards.has(key)) awards.set(key, new Set());
      awards.get(key)!.add(label);
    }
  };
  for (const draw of draws) {
    const related = draws.filter((item) => item.eventId === draw.eventId && item.categoryId === draw.categoryId && item.divisionId === draw.divisionId);
    if (related.some((item) => item.type === 'DOUBLE_ELIMINATION')) continue;
    for (const match of draw.matches) {
      if (!official(match)) continue;
      if (['MAIN_TREE', 'POOL_WINNER_TREE'].includes(draw.type) && match.matchType === 'FINAL' && !match.winnerToMatchId) {
        add(draw, match, true, 'Huy chương Vàng'); add(draw, match, false, 'Huy chương Bạc');
      } else if (['REPECHAGE', 'REPECHAGE_QUARTERFINALS'].includes(draw.type) && match.matchType === 'ELIMINATION' && !match.winnerToMatchId) add(draw, match, true, 'Huy chương Đồng');
      else if (draw.type === 'MAIN_TREE' && match.matchType === 'SEMIFINAL' && !match.loserToMatchId && !related.some((item) => ['REPECHAGE', 'REPECHAGE_QUARTERFINALS'].includes(item.type))) {
        if (draw.matches.some((item) => item.id === match.winnerToMatchId && item.matchType === 'FINAL' && official(item))) add(draw, match, false, 'Huy chương Đồng');
      }
    }
  }
  return new Map([...awards].map(([key, labels]) => [key, [...labels].join(' / ')]));
}
