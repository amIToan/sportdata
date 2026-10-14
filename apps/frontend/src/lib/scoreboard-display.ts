import { MATCH_TYPE_LABELS } from './vi-labels';

export type ScoreboardCategory = {
  name: string;
  matchDurationSeconds?: number;
  weightKind?: string | null;
  minWeight?: number | null;
  maxWeight?: number | null;
};

export function scoreboardWeight(category: ScoreboardCategory) {
  if (category.weightKind === 'OPEN') return '';
  const { minWeight, maxWeight } = category;
  if (minWeight != null && maxWeight != null) return `${minWeight}–${maxWeight} kg`;
  if (maxWeight != null) return `-${maxWeight} kg`;
  if (minWeight != null) return `+${minWeight} kg`;
  return '';
}

export function scoreboardRound(match: { matchType?: string; round?: number | null; matchNumber?: number | null }) {
  const namedRounds = ['ROUND_OF_32', 'ROUND_OF_16', 'QUARTERFINAL', 'QUARTER_FINAL', 'SEMIFINAL', 'SEMI_FINAL', 'FINAL'];
  const round = match.matchType && namedRounds.includes(match.matchType)
    ? MATCH_TYPE_LABELS[match.matchType]
    : match.round != null ? `Vòng ${match.round}` : MATCH_TYPE_LABELS[match.matchType || ''] || 'Chưa xác định vòng';
  return `${round}${match.matchNumber != null ? ` #${match.matchNumber}` : ''}`;
}
