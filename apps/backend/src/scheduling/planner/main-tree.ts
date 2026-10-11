export type TreeMatch = {
  id: string;
  drawId: string;
  round: number;
  bracketPosition: number;
  winnerToMatchId?: string | null;
  winnerToSide?: string | null;
};

export class ScheduleGraphError extends Error {
  constructor(public readonly code: string, message: string, public readonly matchIds: string[] = []) {
    super(message);
  }
}

/** Validate the complete generated tree, including BYEs, before assigning stages. */
export function normalizeMainTree(draw: { id: string; bracketSize?: number | null }, matches: TreeMatch[]) {
  const fail = (message: string, ids: string[] = []): never => {
    throw new ScheduleGraphError('DRAW_NOT_READY', message, ids);
  };
  if (!matches.length) fail('Nhánh chưa có trận đấu.');
  if (new Set(matches.map((match) => match.id)).size !== matches.length) fail('Nhánh chứa mã trận bị trùng.');
  const maximumRound = Math.max(...matches.map((match) => match.round));
  const size = draw.bracketSize ?? 2 ** maximumRound;
  if (!Number.isSafeInteger(size) || size < 2 || !Number.isInteger(Math.log2(size))
    || Math.log2(size) !== maximumRound || matches.length !== size - 1) {
    fail('Khung nhánh không khớp topology đầy đủ; cần kiểm tra sơ đồ đã sinh.');
  }
  const positions = new Map<string, TreeMatch>();
  for (const match of matches) {
    if (match.drawId !== draw.id || !Number.isInteger(match.round) || match.round < 1
      || match.round > maximumRound || !Number.isInteger(match.bracketPosition)
      || match.bracketPosition < 0 || match.bracketPosition >= size / 2 ** match.round) {
      fail('Vị trí trận không thuộc khung nhánh.', [match.id]);
    }
    const key = `${match.round}:${match.bracketPosition}`;
    if (positions.has(key)) fail('Hai trận trùng vị trí sơ đồ.', [match.id, positions.get(key)!.id]);
    positions.set(key, match);
  }
  for (const match of matches) {
    if (match.round === maximumRound) continue;
    const target = positions.get(`${match.round + 1}:${Math.floor(match.bracketPosition / 2)}`);
    if (!target || match.winnerToMatchId !== target.id
      || match.winnerToSide !== (match.bracketPosition % 2 === 0 ? 'ATHLETE1' : 'ATHLETE2')) {
      fail('Quan hệ trận thắng không khớp cây đã sinh.', [match.id]);
    }
  }
  return new Map(matches.map((match) => {
    const remaining = size / 2 ** (match.round - 1);
    const stageKey = remaining === 2 ? 'F' : remaining === 4 ? 'SF' : remaining === 8 ? 'QF' : `R${remaining}`;
    return [match.id, { stageKey, stageOrder: -Math.log2(remaining), bracketSize: size }];
  }));
}

type Activity = {
  drawId?: string | null;
  notes?: string | null;
  status: string;
  winMethod?: string | null;
  resultStatus?: string;
  resultEnteredAt?: unknown;
  refereeConfirmedAt?: unknown;
  approvedAt?: unknown;
  resultPublishedAt?: unknown;
  resultLockedAt?: unknown;
  resultData?: unknown;
  athlete1Id?: string | null;
  athlete2Id?: string | null;
  team1Id?: string | null;
  team2Id?: string | null;
  athlete1Score?: number;
  athlete2Score?: number;
  athlete1Advantages?: number;
  athlete2Advantages?: number;
  athlete1Penalties?: number;
  athlete2Penalties?: number;
  _count?: { resultRevisions: number };
};

export function isAutomaticScheduleBye(match: Activity): boolean {
  const data = match.resultData as Record<string, unknown> | null;
  return Boolean(match.drawId && match.notes?.startsWith('Generated '))
    && match.status === 'FINISHED' && match.winMethod === 'WALKOVVER'
    && match.resultStatus === 'DRAFT' && !match.resultEnteredAt
    && !match.refereeConfirmedAt && !match.approvedAt && !match.resultPublishedAt
    && !match.resultLockedAt && !data?.scoreboard && !match._count?.resultRevisions
    && ![match.athlete1Score, match.athlete2Score, match.athlete1Advantages, match.athlete2Advantages,
      match.athlete1Penalties, match.athlete2Penalties].some((value) => (value ?? 0) !== 0)
    && [Boolean(match.athlete1Id || match.team1Id), Boolean(match.athlete2Id || match.team2Id)].filter(Boolean).length <= 1;
}

export function contentGroupKey(category: {
  sportId: string; discipline?: string | null; uniform?: string | null; gender: string;
  minAge?: number | null; maxAge?: number | null; beltLevel?: string | null;
}) {
  return JSON.stringify([category.sportId, category.discipline ?? null, category.uniform ?? null,
    category.gender, category.minAge ?? null, category.maxAge ?? null, category.beltLevel ?? null]);
}

/** Unknown metadata is never silently treated as an open-weight category. */
export function categoryWeight(category: { minWeight?: number | null; maxWeight?: number | null; weightKind?: string | null }) {
  if (category.weightKind === 'OPEN' && category.maxWeight == null && category.minWeight == null) return { kind: 2, value: 0 };
  if ((!category.weightKind || category.weightKind === 'CAPPED') && Number.isFinite(category.maxWeight)
    && category.maxWeight != null && category.maxWeight > 0) return { kind: 0, value: category.maxWeight };
  if (category.weightKind === 'OVER' && category.maxWeight == null && Number.isFinite(category.minWeight)
    && category.minWeight != null && category.minWeight >= 0) {
    return { kind: 1, value: category.minWeight };
  }
  throw new ScheduleGraphError('WEIGHT_METADATA_REQUIRED', 'Cần xác nhận loại hạng cân: có trần, trên ngưỡng hoặc Open.');
}

export function scheduleParticipantIds(match: {
  athlete1Id?: string | null; athlete2Id?: string | null; team1Id?: string | null; team2Id?: string | null;
  participants?: Array<{ athleteId?: string | null; teamId?: string | null }>;
}, teams: Map<string, string[]>): string[] {
  const athletes = [match.athlete1Id, match.athlete2Id, ...(match.participants || []).map((item) => item.athleteId)];
  const teamIds = [match.team1Id, match.team2Id, ...(match.participants || []).map((item) => item.teamId)]
    .filter((id): id is string => Boolean(id));
  for (const id of teamIds) {
    const members = teams.get(id);
    if (!members?.length) throw new ScheduleGraphError('TEAM_ROSTER_REQUIRED', 'Đội chưa có danh sách thành viên đã xác định.');
    athletes.push(...members);
  }
  return [...new Set([...athletes.filter(Boolean).map((id) => `athlete:${id}`), ...teamIds.map((id) => `team:${id}`)])].sort();
}
