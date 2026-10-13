export const SCOREBOARD_REVIEW_AWARDS = ['REVIEW_REQUEST', 'REVIEW_ACCEPTED', 'REVIEW_REJECTED'];

export function scoreboardReviewState(actions: { side: number; award: string; undone?: boolean }[], initialCards = { 1: true, 2: true }) {
  const cards = { ...initialCards };
  let pendingSide: 1 | 2 | null = null;
  for (const action of actions) {
    if (action.undone || (action.side !== 1 && action.side !== 2)) continue;
    if (action.award === 'REVIEW_REQUEST') pendingSide = action.side;
    if (action.award === 'REVIEW_ACCEPTED') pendingSide = null;
    if (action.award === 'REVIEW_REJECTED') { cards[action.side] = false; pendingSide = null; }
  }
  return { cards, pendingSide };
}

export function isScoreboardMedalMatch(match: { matchType?: string; winnerToMatchId?: string | null; draw?: { type: string } | null }) {
  if (match.winnerToMatchId) return false;
  return match.matchType === 'FINAL'
    || ((match.draw?.type === 'REPECHAGE' || match.draw?.type === 'REPECHAGE_ROUND_OF_16') && match.matchType === 'ELIMINATION');
}

type ReviewMatch = {
  athlete1Id?: string | null; athlete2Id?: string | null;
  matchType?: string; winnerToMatchId?: string | null; notes?: string | null; draw?: { type: string } | null;
  resultEnteredAt?: Date | string | null;
  resultData?: unknown;
};

export function eventReviewCardAvailable(athleteId: string, matches: ReviewMatch[], before: number) {
  const timeline: { at: number; available: boolean }[] = [];
  for (const match of matches) {
    const side = match.athlete1Id === athleteId ? 1 : match.athlete2Id === athleteId ? 2 : null;
    if (!side) continue;
    const clock = (match.resultData as { scoreboard?: { startedAt?: string; actions?: { side: number; award: string; at: string; undone?: boolean }[] } } | null)?.scoreboard;
    const actions = clock?.actions || [];
    if (isScoreboardMedalMatch(match)) {
      const startedAt = Date.parse(clock?.startedAt || actions[0]?.at || String(match.resultEnteredAt || ''));
      if (startedAt <= before) timeline.push({ at: startedAt, available: true });
    }
    for (const action of actions) {
      const at = Date.parse(action.at);
      if (!action.undone && action.side === side && action.award === 'REVIEW_REJECTED' && at <= before) timeline.push({ at, available: false });
    }
  }
  timeline.sort((a, b) => a.at - b.at || Number(b.available) - Number(a.available));
  return timeline.at(-1)?.available ?? true;
}
