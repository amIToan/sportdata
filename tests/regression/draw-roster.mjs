// Run after npm run build:backend. No live database access.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
const { MatchesService } = require('./dist/src/matches/matches.service.js');
const event = { id: 'event', startDate: new Date('2026-10-08'), endDate: new Date('2026-10-08'),
  ageLimitMode: 'CATEGORY', minAge: null, maxAge: null };
const category = { id: 'category', name: 'Open', gender: 'MIXED', minAge: null,
  maxAge: null, minWeight: null, maxWeight: null };
const athlete = (id) => ({ id, fullName: id, gender: 'MALE', birthDate: null, weight: null,
  countryId: 'country', federationId: null, events: [], categories: [] });
const entries = ['a', 'b', 'c', 'd'].map((id) => ({ id: `entry-${id}`, athleteId: id,
  athlete: athlete(id), type: 'INDIVIDUAL', status: 'VERIFIED', seed: null }));
entries.push(
  { id: 'pending', athleteId: 'p', athlete: athlete('p'), type: 'INDIVIDUAL', status: 'REGISTERED' },
  { id: 'withdrawn', athleteId: 'w', athlete: athlete('w'), type: 'INDIVIDUAL', status: 'WITHDRAWN' },
  { id: 'team', type: 'TEAM', status: 'VERIFIED', athlete: null },
  { id: 'missing-athlete', type: 'INDIVIDUAL', status: 'VERIFIED', athlete: null },
);
const configurations = new Map();
const db = {
  $executeRaw: async () => 1,
  $queryRaw: async () => [],
  event: { findUnique: async () => event },
  category: { findFirst: async () => category },
  competitionEntry: { findMany: async ({ where }) => {
    assert.deepEqual(where, { eventId: event.id, categoryId: category.id });
    return entries;
  } },
  fop: { findMany: async () => [] },
  match: { aggregate: async () => ({ _max: { matchNumber: null } }) },
  drawPreconfiguration: {
    findUnique: async ({ where }) => configurations.get(where.eventId_categoryId_drawType.drawType),
    upsert: async ({ where, create }) => {
      const result = { id: 'configuration', ...create };
      configurations.set(where.eventId_categoryId_drawType.drawType, result);
      return result;
    },
  },
  drawPreconfigurationHistory: { create: async () => ({}) },
};
db.$transaction = async (work) => work(db);
const service = new MatchesService(db);
const input = await service.loadDrawInput(db, event.id, category.id);
assert.deepEqual(input.eligibleEntries.map((entry) => entry.athleteId), ['a', 'b', 'c', 'd']);

for (const type of ['MAIN_TREE', 'DOUBLE_ELIMINATION', 'REPECHAGE', 'REPECHAGE_ROUND_OF_16', 'ROUND_ROBIN_POOL']) {
  const result = await service.previewDraw(event.id, category.id, { type, athleteIds: ['a', 'b', 'c', 'd'],
    revision: 0, seedingMode: 'STANDARD', groupCount: 1 }, 'admin');
  assert.equal(result.stale, false);
  const participants = new Set(result.preview.flatMap((draw) => draw.matches.flatMap((match) =>
    [match.athlete1Id, match.athlete2Id])).filter(Boolean));
  assert.deepEqual([...participants].sort(), ['a', 'b', 'c', 'd']);
}

// A roster cached before a confirmed registration moved to this category is rejected.
entries.push({ id: 'entry-new', athleteId: 'new', athlete: athlete('new'), type: 'INDIVIDUAL', status: 'VERIFIED' });
await assert.rejects(service.previewDraw(event.id, category.id, { athleteIds: ['a', 'b', 'c', 'd'] }, 'admin'),
  (error) => error.getStatus() === 409);
const refreshed = await service.previewDraw(event.id, category.id,
  { athleteIds: ['a', 'b', 'c', 'd', 'new'], revision: 1 }, 'admin');
assert.equal(refreshed.stale, false);
assert.ok(refreshed.preview.some((draw) => draw.matches.some((match) =>
  match.athlete1Id === 'new' || match.athlete2Id === 'new')));

for (const athleteIds of [['a', 'b'], ['a', 'b', 'c', 'd', 'unknown'],
  ['a', 'b', 'c', 'd', 'd'], ['a', 'b', 'c', 'd', 'new', 'p']]) {
  await assert.rejects(service.previewDraw(event.id, category.id, { athleteIds }, 'admin'),
    (error) => error.getStatus() === 409);
}
category.gender = 'FEMALE';
await assert.rejects(service.previewDraw(event.id, category.id,
  { athleteIds: ['a', 'b', 'c', 'd', 'new'] }, 'admin'), (error) => error.getStatus() === 400);
console.log('Draw roster regression checks passed: verified entries, stale rosters, five preview formats and eligibility.');
