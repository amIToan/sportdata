// Run after npm run build:backend. Uses the real generator/progression/planner, no database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
const { MatchesService } = require('./dist/src/matches/matches.service.js');
const { semanticStages } = require('./dist/src/scheduling/planner/snapshot-planner.js');
const { isScoreboardMedalMatch } = require('./dist/src/results/scoreboard-review.js');
const { preconfigurationDrawTypes } = require('./dist/src/matches/dto/draw-preconfiguration.dto.js');
const service = new MatchesService({});
const type = 'REPECHAGE_ROUND_OF_16';
assert.ok(preconfigurationDrawTypes.includes(type));
function planFor(count, drawType = type) {
  const entries = Array.from({ length: count }, (_, i) => ({ id: `e${i}`, athleteId: `a${i}`,
    seed: null, athlete: { id: `a${i}`, countryId: 'VN', federationId: null } }));
  const input = { event: { id: 'event', startDate: new Date('2026-10-12'), endDate: new Date('2026-10-13') },
    category: { id: 'category', name: 'Test' }, entries, eligibleEntries: entries, fops: [] };
  return service.buildDrawPlan(input, { type: drawType, athleteIds: entries.map(e => e.athleteId), seedingMode: 'ORDERED' }, []);
}
function rounds(matches) {
  return [...new Set(matches.map(m => m.round))].sort((a,b) => a-b)
    .map(r => matches.filter(m => m.round === r).sort((a,b) => a.bracketPosition-b.bracketPosition));
}
for (const count of [2, 3, 4, 5]) {
  const plan = planFor(count);
  assert.equal(plan.draws.length, 1);
  assert.equal(plan.draws[0].type, 'ROUND_ROBIN_POOL');
  assert.equal(plan.matches.length, count * (count - 1) / 2);
}
for (const count of [6, 7, 8, 9, 12, 15, 16, 17, 24, 31, 32, 64]) {
  const plan = planFor(count);
  const main = plan.matches.filter(m => m.drawId === plan.draws[0].id);
  const lower = plan.matches.filter(m => m.drawId === plan.draws[1].id);
  const mainRounds = rounds(main);
  const lowerRounds = rounds(lower);
  assert.equal(plan.draws[1].type, type);
  assert.deepEqual(lowerRounds.map(r => r.length), count <= 8 ? [2, 2] : [4, 4, 2, 2]);
  const bronze = lowerRounds.at(-1);
  assert.equal(bronze.length, 2);
  assert.ok(bronze.every(m => !m.winnerToMatchId && !m.loserToMatchId));
  for (const match of main) {
    const eligible = ['ROUND_OF_16', 'QUARTERFINAL', 'SEMIFINAL'].includes(match.matchType);
    assert.equal(Boolean(match.loserToMatchId), eligible, `${count}: ${match.matchType} loser eligibility`);
  }
  mainRounds.at(-2).forEach((m,i) => {
    assert.equal(m.loserToMatchId, bronze[i ^ 1].id, 'semifinal losers cross to the opposite bronze path');
    assert.equal(m.loserToSide, 'ATHLETE2');
  });
  const snapshot = { matches: plan.matches, draws: plan.draws.map(d => ({ ...d, categoryId: 'category' })), heats: [] };
  const stages = semanticStages(snapshot, 'category');
  assert.equal(stages.size, plan.matches.length);
  assert.ok(bronze.every(m => stages.get(m.id).stageKey === 'BRONZE'));
  const corrupted = structuredClone(snapshot);
  const semifinal = corrupted.matches.find(m => m.matchType === 'SEMIFINAL');
  semifinal.loserToMatchId = bronze[semifinal.bracketPosition].id;
  assert.throws(() => semanticStages(corrupted, 'category'), /topology/);
  for (const m of lower) assert.equal(isScoreboardMedalMatch({ ...m, draw: { type } }), bronze.includes(m));

  // Play all bouts using actual result propagation, with an in-memory transaction.
  const byId = new Map(plan.matches.map(m => [m.id, { ...m, resultStatus: 'DRAFT', resultVersion: 0 }]));
  const db = { $queryRaw: async () => [], match: {
    findUnique: async ({ where }) => byId.get(where.id),
    findMany: async ({ where }) => [...byId.values()].filter(m => where.OR.some(clause => Object.entries(clause).every(([k,v]) => m[k] === v))),
    update: async ({ where, data }) => { const m = byId.get(where.id); Object.assign(m, data); return m; },
  } };
  const losses = new Map();
  let played = 0;
  while ([...byId.values()].some(m => m.status !== 'FINISHED')) {
    const ready = [...byId.values()].filter(m => m.status === 'SCHEDULED' && m.athlete1Id && m.athlete2Id);
    assert.ok(ready.length, `${count}: bracket must not deadlock on byes or empty feeders`);
    for (const m of ready) {
      assert.notEqual(m.athlete1Id, m.athlete2Id);
      const before = { ...m };
      m.status = 'FINISHED';
      m.resultStatus = 'CONFIRMED';
      m.winnerId = played++ % 2 ? m.athlete2Id : m.athlete1Id;
      const loser = m.winnerId === m.athlete1Id ? m.athlete2Id : m.athlete1Id;
      losses.set(loser, (losses.get(loser) || 0) + 1);
      await service.syncProgression(db, before, m);
      if (m.loserToMatchId) {
        const target = byId.get(m.loserToMatchId);
        assert.equal(target[m.loserToSide === 'ATHLETE1' ? 'athlete1Id' : 'athlete2Id'], loser,
          'loser enters repechage immediately, without waiting for the winner to fight again');
      }
    }
  }
  const final = byId.get(mainRounds.at(-1)[0].id);
  const medalists = [final.athlete1Id, final.athlete2Id, ...bronze.map(m => byId.get(m.id).winnerId)];
  assert.equal(new Set(medalists).size, 4, 'gold, silver and two different bronze winners');
  assert.ok(medalists.every(Boolean));
  for (const m of bronze) assert.equal(losses.get(byId.get(m.id).winnerId), 1, 'bronze winner lost exactly once');
  if (count === 16) assert.equal(played, 27, '15 main + 4 first repechage + 4 joins + 2 consolidation + 2 bronze');
}
// Existing Repechage still admits round-of-32 losers.
const legacy = planFor(32, 'REPECHAGE');
assert.ok(legacy.matches.filter(m => m.matchType === 'ROUND_OF_32').every(m => m.loserToMatchId));
assert.equal(legacy.matches.filter(m => m.drawId === legacy.draws[1].id).length, 28);
console.log('PASS: Repechage 1/8 fallback, byes, 16/32/64 topology, immediate loser progression, cross bronze, medals and scheduling.');
