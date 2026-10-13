const { ResultsService } = require('../../apps/backend/dist/src/results/results.service.js');
const { MatchesService } = require('../../apps/backend/dist/src/matches/matches.service.js');
const { ScoreboardService } = require('../../apps/backend/dist/src/results/scoreboard.service.js');

function resultCorrectionFixture(overrides = {}) {
  const athlete = (id) => id ? { id, fullName: `Athlete ${id.toUpperCase()}` } : null;
  const make = (id, number, extra = {}) => ({ id, eventId: 'event', categoryId: 'cat', matchNumber: number,
    athlete1Id: null, athlete2Id: null, team1Id: null, team2Id: null, winnerId: null, winnerTeamId: null,
    athlete1Score: 0, athlete2Score: 0, athlete1Advantages: 0, athlete2Advantages: 0,
    athlete1Penalties: 0, athlete2Penalties: 0, participants: [], resultVersion: 0,
    status: 'SCHEDULED', resultStatus: 'DRAFT', winMethod: null,
    winnerToMatchId: null, winnerToSide: null, loserToMatchId: null, loserToSide: null,
    resultEnteredAt: null, notes: 'Generated winner bracket', drawId: 'draw',
    fop: 'Mat 1', startTime: '2026-11-01T09:00:00Z', endTime: '2026-11-01T09:05:00Z', ...extra });
  let rows = new Map([
    ['source', make('source', 1, { status: 'FINISHED', resultStatus: 'REFEREE_CONFIRMED', resultVersion: 5,
      athlete1Id: 'a', athlete2Id: 'b', winnerId: 'a', athlete1Score: 50, winMethod: 'SUBMISSION', resultEnteredAt: '2026-10-12T09:00:00Z',
      winnerToMatchId: 'winner', winnerToSide: 'ATHLETE1', loserToMatchId: 'loser', loserToSide: 'ATHLETE2',
      resultData: { scoreboard: { remainingMs: 123000, runningSince: null, actions: [
        { id: 5, side: 1, award: 'SUBMISSION', points: 1, at: '2026-10-12T09:00:00Z', remainingMs: 123000, actor: 'judge' },
      ] } }, ...overrides.source })],
    ['winner', make('winner', 2, { athlete1Id: 'a', athlete2Id: 'c', winnerToMatchId: 'final', winnerToSide: 'ATHLETE1', ...overrides.winner })],
    ['loser', make('loser', 3, { athlete1Id: 'd', athlete2Id: 'b', ...overrides.loser })],
    ['final', make('final', 4, { athlete1Id: null, athlete2Id: 'e', matchType: 'FINAL', ...overrides.final })],
  ]);
  let revisions = [];
  const hydrate = (row) => row && structuredClone({ ...row, category: { name: 'Gi -56kg', matchDurationSeconds: 300 },
    event: { name: 'Event' }, athlete1: athlete(row.athlete1Id), athlete2: athlete(row.athlete2Id),
    resultRevisions: revisions.filter(revision => revision.matchId === row.id).sort((a,b) => b.version-a.version) });
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(clause => matches(row, clause));
    if (value && typeof value === 'object') {
      if ('not' in value) return row[key] !== value.not;
      if ('in' in value) return value.in.includes(row[key]);
    }
    return row[key] === value;
  });
  const apply = (row, data) => {
    for (const [key,value] of Object.entries(data)) {
      if (value === undefined) continue;
      row[key] = value && typeof value === 'object' && 'increment' in value ? (row[key] || 0) + value.increment : structuredClone(value);
    }
  };
  const db = {
    $queryRaw: async () => [], $executeRaw: async () => 0,
    match: {
      findUnique: async ({ where }) => hydrate(rows.get(where.id)),
      findMany: async ({ where }) => [...rows.values()].filter(row => matches(row, where)).sort((a,b) => a.id.localeCompare(b.id)).map(hydrate),
      updateMany: async ({ where, data }) => { const found = [...rows.values()].filter(row => matches(row,where)); found.forEach(row => apply(row,data)); return { count: found.length }; },
      update: async ({ where, data }) => { const row=rows.get(where.id); apply(row,data); return hydrate(row); },
    },
    matchParticipant: { update: async () => {} },
    resultRevision: { create: async ({ data }) => { const revision = { id: `revision-${data.version}`, createdAt: new Date().toISOString(), ...structuredClone(data) }; revisions.push(revision); return revision; } },
  };
  db.$transaction = async (work) => {
    const before = structuredClone(rows), beforeRevisions = structuredClone(revisions);
    try { return await work(db); } catch (error) { rows = before; revisions = beforeRevisions; throw error; }
  };
  const matchesService = new MatchesService(db);
  const service = new ResultsService(db, matchesService);
  const scoreboard = new ScoreboardService(db, matchesService);
  return { service, scoreboard, state: () => [...rows.values()].map(hydrate), row: (id) => hydrate(rows.get(id)),
    revisions: () => structuredClone(revisions), change: (id,data) => apply(rows.get(id), data),
    payload: { expectedVersion: 5, athlete1Score: 4, athlete2Score: 9, athlete1Advantages: 0, athlete2Advantages: 0,
      athlete1Penalties: 0, athlete2Penalties: 0, winnerId: 'b', winMethod: 'POINTS', reason: 'Correct referee input' } };
}
module.exports = { resultCorrectionFixture };
