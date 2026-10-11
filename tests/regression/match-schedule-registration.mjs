// Run after npm run build:backend. Uses in-memory fixtures; no live database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
const { MatchesService } = require('./dist/src/matches/matches.service.js');

function matches(record, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some((condition) => matches(record, condition));
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(record[key]);
      if ('some' in value) return record[key].some((item) => matches(item, value.some));
      if ('none' in value) return !record[key].some((item) => matches(item, value.none));
    }
    return record[key] === value;
  });
}

function fixture({ athlete2Id = 'b', winnerId = null } = {}) {
  const event = { id: 'event', startDate: new Date('2026-10-11'), endDate: new Date('2026-10-20') };
  const category = { id: 'category', sportId: 'sport', matchDurationSeconds: 180 };
  const athletes = ['a', 'b', 'c'].map((id) => ({ id, events: [], categories: [], entries: [
    { eventId: event.id, categoryId: category.id, type: 'INDIVIDUAL', status: 'VERIFIED' },
  ] }));
  let match = {
    id: 'match', eventId: event.id, categoryId: category.id, drawId: 'draw',
    athlete1Id: 'a', athlete2Id, winnerId, status: 'SCHEDULED',
    resultStatus: 'DRAFT', matchDate: new Date('2026-10-16'), scheduleLocked: false,
    startTime: null, endTime: null, fopId: 'fop',
    winnerToMatchId: null, loserToMatchId: null,
  };
  const writes = [];
  let overlap = null;
  const db = {
    $queryRaw: async () => [],
    event: { findUnique: async () => event },
    category: { findFirst: async () => category, findUnique: async () => category },
    // This suite isolates registration; rest behavior is covered by scheduling tests.
    sportSchedulingRule: { findMany: async () => [{ sportId: 'sport', minRestMinutes: 0 }] },
    fop: { count: async () => 1 },
    team: { findMany: async () => [] },
    athlete: { count: async ({ where }) => athletes.filter((athlete) => matches(athlete, where)).length },
    match: {
      findMany: async () => [],
      findUnique: async () => structuredClone(match),
      findFirst: async () => overlap,
      create: async ({ data }) => { writes.push(data); return data; },
      update: async ({ data }) => { writes.push(data); match = { ...match, ...data }; return structuredClone(match); },
    },
    $transaction: async (work) => work(db),
  };
  const service = new MatchesService(db);
  // The same payload sent by InlineMatchSchedule when the match has no time yet.
  const startTime = '2026-10-16T02:00:00.000Z';
  const save = (extra = {}) => service.update(match.id, { matchDate: startTime, startTime, ...extra });
  const create = () => service.create({ eventId: event.id, categoryId: category.id,
    athlete1Id: 'a', athlete2Id: 'b', matchDate: startTime, startTime });
  const legacyLinks = () => athletes.forEach((athlete) => {
    athlete.events = [{ id: event.id }];
    athlete.categories = [{ id: category.id }];
  });
  return { service, db, athletes, writes, save, create, legacyLinks,
    lock: () => { match.scheduleLocked = true; },
    conflict: () => { overlap = { id: 'other-match', matchNumber: 99 }; },
  };
}

// Draw participants registered through entries can be scheduled without old links.
const scheduled = fixture();
const updated = await scheduled.save();
assert.equal(updated.startTime.toISOString(), '2026-10-16T02:00:00.000Z');
assert.equal(updated.endTime.toISOString(), '2026-10-16T02:03:00.000Z');
assert.equal(updated.matchDate.toISOString(), updated.startTime.toISOString());
assert.equal(updated.drawId, 'draw');
assert.equal(updated.athlete1Id, 'a');
assert.equal(updated.athlete2Id, 'b');
await scheduled.save({ endTime: '2026-10-16T02:10:00.000Z' });
assert.equal(scheduled.writes.at(-1).endTime.toISOString(), '2026-10-16T02:10:00.000Z');
assert.equal((await fixture().create()).endTime.toISOString(), '2026-10-16T02:03:00.000Z');
await fixture({ athlete2Id: null }).save();
await fixture({ athlete2Id: null, winnerId: 'a' }).save();

// Manual match scheduling continues to accept active REGISTERED entries.
const registered = fixture();
registered.athletes[1].entries[0].status = 'REGISTERED';
await registered.save();
await registered.create();

// Keep support for older registrations that have only event/category links.
const legacy = fixture();
legacy.athletes.forEach((athlete) => { athlete.entries = []; });
legacy.legacyLinks();
await legacy.save();
await legacy.create();

async function rejectedWithoutWrite(f, pattern, extra = {}) {
  await assert.rejects(f.save(extra), pattern);
  assert.equal(f.writes.length, 0);
}

// Inactive entries take precedence over stale legacy links, on create and update.
for (const status of ['WITHDRAWN', 'DISQUALIFIED']) {
  const f = fixture();
  f.legacyLinks();
  f.athletes[1].entries[0].status = status;
  await rejectedWithoutWrite(f, /chưa đăng ký/);
  await assert.rejects(f.create(), /chưa đăng ký/);
  assert.equal(f.writes.length, 0);
}

// Both participants must have an entry in this exact event and category.
for (const change of [{ eventId: 'other-event' }, { categoryId: 'other-category' }, { type: 'TEAM' }]) {
  const f = fixture();
  Object.assign(f.athletes[1].entries[0], change);
  await rejectedWithoutWrite(f, /chưa đăng ký/);
  await assert.rejects(f.create(), /chưa đăng ký/);
}
const missing = fixture();
missing.athletes[1].entries = [];
await rejectedWithoutWrite(missing, /chưa đăng ký/);
await rejectedWithoutWrite(fixture(), /chưa đăng ký/, { athlete2Id: 'unknown' });
await rejectedWithoutWrite(fixture(), /chưa đăng ký/, { eventId: 'other-event' });
await rejectedWithoutWrite(fixture(), /chưa đăng ký/, { categoryId: 'other-category' });

// Valid registration must still obey the existing scheduling guards.
const locked = fixture();
locked.lock();
await rejectedWithoutWrite(locked, /Lịch thi đấu đã khóa/);
await rejectedWithoutWrite(fixture(), /Thời gian thi đấu phải nằm/, {
  matchDate: '2026-10-10T02:00:00.000Z', startTime: '2026-10-10T02:00:00.000Z',
});
const conflicting = fixture();
conflicting.conflict();
await rejectedWithoutWrite(conflicting, /đã có trận/);

console.log('PASS: schedule/create with entry registrations, legacy compatibility, inactive/wrong/missing registrations rejected, duration and schedule guards preserved.');
