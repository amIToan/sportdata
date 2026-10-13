type PointsResult = {
  athlete1Score?: number | null;
  athlete2Score?: number | null;
  athlete1Advantages?: number | null;
  athlete2Advantages?: number | null;
  athlete1Penalties?: number | null;
  athlete2Penalties?: number | null;
};

export function pointsWinnerSide(result: PointsResult): 1 | 2 | null {
  if (result.athlete1Score == null || result.athlete2Score == null) return null;
  const differences = [
    result.athlete1Score - result.athlete2Score,
    (result.athlete1Advantages ?? 0) - (result.athlete2Advantages ?? 0),
    (result.athlete2Penalties ?? 0) - (result.athlete1Penalties ?? 0),
  ];
  const difference = differences.find((value) => value !== 0);
  return difference === undefined ? null : difference > 0 ? 1 : 2;
}
