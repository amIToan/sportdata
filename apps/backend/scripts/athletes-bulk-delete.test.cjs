// Run: node --test apps/backend/scripts/athletes-bulk-delete.test.cjs
// Runs the real service and DTOs against an in-memory fixture; never uses a database.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
require('reflect-metadata');
require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true });
const { Prisma } = require('@prisma/client');
const { plainToInstance } = require('class-transformer');
const { validateSync } = require('class-validator');
const { GUARDS_METADATA } = require('@nestjs/common/constants');
const { AthletesService } = require('../src/athletes/athletes.service.ts');
const { AthletesController } = require('../src/athletes/athletes.controller.ts');
const { JwtAuthGuard } = require('../src/auth/jwt-auth.guard.ts');
const { ROLES_KEY } = require('../src/common/decorators/roles.decorator.ts');
const { BulkDeleteAthletesDto, PreviewAthleteDeleteDto } = require('../src/athletes/dto/bulk-delete-athletes.dto.ts');

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every((clause) => matches(row, clause));
    if (key === 'OR') return value.some((clause) => matches(row, clause));
    if (value instanceof Date) return row[key]?.getTime() === value.getTime();
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      if ('contains' in value) return String(row[key] || '').toLowerCase().includes(value.contains.toLowerCase());
      if ('some' in value) return (row[key] || []).some((related) => matches(related, value.some));
    }
    return row[key] === value;
  });
}

function athlete(id, extra = {}) {
  return {
    id, fullName: `Athlete ${id}`, firstName: 'Athlete', lastName: id, gender: 'MALE',
    email: `${id}@test.invalid`, phone: `phone-${id}`, countryId: 'vn', federationId: 'federation-1',
    categories: [{ id: 'category-1', sportId: 'sport-1' }], events: [{ id: 'event-1' }],
    updatedAt: new Date('2026-10-13T00:00:00Z'),
    _count: { statistics: 0, teamMemberships: 0 }, ...extra,
  };
}

function fixture(rows) {
  const records = new Map(rows.map((row) => [row.id, row]));
  const media = new Map(rows.map((row) => [row.id, [{ storageKey: `local:athletes/${row.id}/avatar` }, { storageKey: `local:athletes/${row.id}/passport` }]]));
  const accountIds = new Set(rows.map((row) => row.participantAccountId).filter(Boolean));
  const registrations = new Set(rows.map((row) => row.id));
  const identities = new Set(rows.map((row) => row.id));
  const deletedFiles = [];
  const reads = [];
  let onLock;
  const knownError = (code) => new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: 'test' });
  const store = {
    athlete: {
      findMany: async (args) => {
        reads.push(args);
        let found = [...records.values()].filter((row) => matches(row, args.where));
        const sortKey = args.orderBy?.id ? 'id' : 'fullName';
        found.sort((a, b) => a[sortKey].localeCompare(b[sortKey]));
        return found.slice(args.skip || 0, args.take ? (args.skip || 0) + args.take : undefined).map((row) => ({ ...row }));
      },
      count: async ({ where }) => [...records.values()].filter((row) => matches(row, where)).length,
      findUnique: async ({ where }) => records.get(where.id) || null,
      delete: async ({ where }) => {
        const row = records.get(where.id);
        if (!row || !matches(row, where)) throw knownError('P2025');
        if (row.foreignKeyProtected) throw knownError('P2003');
        records.delete(row.id);
        media.delete(row.id);
        identities.delete(row.id);
        registrations.delete(row.id);
        return row;
      },
    },
    athleteMedia: {
      findMany: async ({ where }) => media.get(where.athleteId) || [],
      findUnique: async () => null,
    },
    $queryRaw: async (sql) => {
      if (onLock && sql.strings[0].includes('FROM "Athlete"')) await onLock(sql.values[0]);
      return [];
    },
  };
  const prisma = { ...store, $transaction: async (callback) => callback(store) };
  const service = new AthletesService(prisma, {}, { deleteQuietly: async (key) => deletedFiles.push(key) }, {});
  return { service, records, media, accountIds, identities, registrations, deletedFiles, reads, setOnLock: (callback) => { onLock = callback; } };
}

test('SELECTED deduplicates IDs, reports protected/missing rows and cleans only successfully deleted media', async () => {
  const f = fixture([
    athlete('selected', { participantAccountId: 'retained-account' }), athlete('untouched'),
    athlete('statistics', { _count: { statistics: 1, teamMemberships: 0 } }),
    athlete('team', { _count: { statistics: 0, teamMemberships: 1 } }),
    athlete('fk-race', { foreignKeyProtected: true }),
  ]);
  const result = await f.service.bulkDelete({ mode: 'SELECTED', ids: ['selected', 'statistics', 'team', 'missing', 'fk-race', 'selected'] });
  assert.equal(result.requestedCount, 5);
  assert.equal(result.deletedCount, 1);
  assert.deepEqual(result.deletedIds, ['selected']);
  assert.deepEqual(result.deleted, [{ id: 'selected', fullName: 'Athlete selected' }]);
  assert.deepEqual(result.failed.map((row) => row.id), ['statistics', 'team', 'missing', 'fk-race']);
  assert.ok(result.failed.every((row) => row.reason));
  assert.equal(f.records.has('untouched'), true);
  assert.equal(f.records.has('statistics'), true);
  assert.equal(f.records.has('team'), true);
  assert.equal(f.records.has('fk-race'), true);
  assert.equal(f.accountIds.has('retained-account'), true);
  assert.equal(f.identities.has('selected'), false);
  assert.equal(f.registrations.has('selected'), false);
  assert.deepEqual(f.deletedFiles, ['local:athletes/selected/avatar', 'local:athletes/selected/passport']);
});

test('ALL_MATCHING uses the same search/gender scope as the list and deletes across all pages', async () => {
  const rows = Array.from({ length: 67 }, (_, index) => athlete(`matching-${index}`));
  const f = fixture([...rows, athlete('other'), athlete('matching-female', { gender: 'FEMALE' })]);
  const filters = { search: 'matching', gender: 'MALE' };
  const list = await f.service.findAll({ ...filters, page: 2, limit: 30 });
  assert.equal(list.total, 67);
  assert.equal(list.items.length, 30);
  const preview = await f.service.previewBulkDelete({ filters });
  assert.equal(preview.total, list.total);
  const result = await f.service.bulkDelete({ mode: 'ALL_MATCHING', filters, expectedCount: preview.total, selectionToken: preview.selectionToken });
  assert.equal(result.deletedCount, 67);
  assert.equal(result.failed.length, 0);
  assert.equal(f.records.size, 2);
  assert.equal(f.records.has('other'), true);
  assert.equal(f.records.has('matching-female'), true);
  assert.deepEqual(f.reads[0].where, f.reads[1].where);
  assert.equal(f.reads[1].take, undefined);
  assert.equal(f.reads[1].skip, undefined);
});

test('ALL_MATCHING preserves country, unit/independent, sport/category and event filters', async () => {
  const f = fixture([
    athlete('unit'), athlete('independent', { federationId: null }),
    athlete('foreign', { countryId: 'other-country' }), athlete('other-unit', { federationId: 'federation-2' }),
    athlete('other-category', { categories: [{ id: 'other-category', sportId: 'sport-1' }] }),
    athlete('other-sport', { categories: [{ id: 'category-1', sportId: 'sport-2' }] }),
    athlete('other-event', { events: [{ id: 'event-2' }] }),
  ]);
  const filters = { countryId: 'vn', federationIds: 'federation-1', includeIndependent: true, sportId: 'sport-1', categoryIds: 'category-1', eventId: 'event-1' };
  const preview = await f.service.previewBulkDelete({ filters });
  assert.equal(preview.total, 2);
  const result = await f.service.bulkDelete({ mode: 'ALL_MATCHING', filters, expectedCount: preview.total, selectionToken: preview.selectionToken });
  assert.deepEqual(result.deletedIds, ['independent', 'unit']);
  assert.equal(f.records.size, 5);
});

for (const change of ['insert', 'replace-same-count', 'update', 'scope']) {
  test(`ALL_MATCHING rejects a stale ${change} snapshot before deleting any record`, async () => {
    const f = fixture([athlete('a'), athlete('b')]);
    const filters = {};
    const preview = await f.service.previewBulkDelete({ filters });
    if (change === 'insert') f.records.set('c', athlete('c'));
    if (change === 'replace-same-count') { f.records.delete('b'); f.records.set('c', athlete('c')); }
    if (change === 'update') f.records.get('b').updatedAt = new Date('2026-10-14T00:00:00Z');
    await assert.rejects(f.service.bulkDelete({ mode: 'ALL_MATCHING', filters: change === 'scope' ? { gender: 'MALE' } : filters,
      expectedCount: preview.total, selectionToken: preview.selectionToken }), (error) => error.getStatus() === 409);
    assert.ok(f.records.has('a'));
    assert.deepEqual(f.deletedFiles, []);
  });
}

test('a profile changed after capture is reported without deletion or file cleanup', async () => {
  const f = fixture([athlete('changing'), athlete('stable')]);
  f.setOnLock((id) => { if (id === 'changing') f.records.get(id).updatedAt = new Date('2026-10-14T00:00:00Z'); });
  const result = await f.service.bulkDelete({ mode: 'SELECTED', ids: ['changing', 'stable'] });
  assert.deepEqual(result.deletedIds, ['stable']);
  assert.deepEqual(result.failed.map((row) => row.id), ['changing']);
  assert.ok(f.records.has('changing'));
  assert.equal(f.deletedFiles.some((key) => key.includes('changing')), false);
});

test('explicit empty filter snapshot supports deleting the full list, while omitted scope is rejected', async () => {
  const f = fixture([athlete('a'), athlete('b')]);
  for (const request of [ {}, { mode: 'ALL_MATCHING' }, { mode: 'SELECTED', ids: [] }, { mode: 'SELECTED', ids: [' '] },
    { mode: 'SELECTED', ids: ['a'], filters: {} }, { mode: 'ALL_MATCHING', filters: {}, expectedCount: 0, selectionToken: 'a'.repeat(64) } ]) {
    await assert.rejects(f.service.bulkDelete(request), (error) => error.getStatus() === 400);
  }
  assert.equal(f.records.size, 2);
  const preview = await f.service.previewBulkDelete({ filters: {} });
  const result = await f.service.bulkDelete({ mode: 'ALL_MATCHING', filters: {}, expectedCount: preview.total, selectionToken: preview.selectionToken });
  assert.equal(result.deletedCount, 2);
});

test('DTO validation rejects missing, invalid and empty selection/filter data', () => {
  const valid = [ { mode: 'SELECTED', ids: ['a'] }, { mode: 'ALL_MATCHING', filters: { gender: 'FEMALE', includeIndependent: false }, expectedCount: 2, selectionToken: 'a'.repeat(64) } ];
  for (const data of valid) assert.deepEqual(validateSync(plainToInstance(BulkDeleteAthletesDto, data)), []);
  for (const data of [ {}, { mode: 'SELECTED' }, { mode: 'SELECTED', ids: [] }, { mode: 'SELECTED', ids: [42] },
    { mode: 'SELECTED', ids: [' '] }, { mode: 'SELECTED', ids: Array(1001).fill('a') }, { mode: 'ALL_MATCHING' },
    { mode: 'ALL_MATCHING', filters: null, expectedCount: 2, selectionToken: 'a'.repeat(64) },
    { mode: 'ALL_MATCHING', filters: { gender: 'WRONG' }, expectedCount: 2, selectionToken: 'a'.repeat(64) },
    { mode: 'ALL_MATCHING', filters: {}, expectedCount: '2', selectionToken: 'invalid' } ]) {
    assert.ok(validateSync(plainToInstance(BulkDeleteAthletesDto, data)).length > 0, JSON.stringify(data));
  }
  assert.ok(validateSync(plainToInstance(PreviewAthleteDeleteDto, {})).length > 0);
  assert.deepEqual(validateSync(plainToInstance(PreviewAthleteDeleteDto, { filters: {} })), []);
});

test('both bulk routes require the same authenticated delete roles as individual deletion', () => {
  for (const route of ['previewBulkDelete', 'bulkDelete', 'remove']) {
    const handler = AthletesController.prototype[route];
    assert.deepEqual(Reflect.getMetadata(ROLES_KEY, handler), ['ADMIN', 'GAMES_ADMIN']);
    assert.ok(Reflect.getMetadata(GUARDS_METADATA, handler).includes(JwtAuthGuard));
  }
});

test('single-athlete deletion shares protection and storage cleanup with bulk deletion', async () => {
  const f = fixture([athlete('deletable'), athlete('protected', { _count: { statistics: 1, teamMemberships: 0 } })]);
  await assert.rejects(f.service.remove('protected'), (error) => error.getStatus() === 400);
  assert.equal(f.records.has('protected'), true);
  assert.deepEqual(f.deletedFiles, []);
  await f.service.remove('deletable');
  assert.equal(f.records.has('deletable'), false);
  assert.equal(f.deletedFiles.length, 2);
});

test('CMS avatars reject invalid image bodies and zero/invalid sizes before storage', async () => {
  const f = fixture([athlete('avatar')]);
  let uploads = 0;
  f.service.storage.withUpload = async () => { uploads++; };
  for (const file of [
    { mimetype: 'image/jpeg', size: 7, buffer: Buffer.from('invalid') },
    { mimetype: 'image/png', size: 7, buffer: Buffer.from('%PDF-12') },
    { mimetype: 'image/webp', size: 12, buffer: Buffer.alloc(12) },
    { mimetype: 'image/jpeg', size: 0, buffer: Buffer.from([0xff, 0xd8, 0xff]) },
    { mimetype: 'image/jpeg', size: NaN, buffer: Buffer.from([0xff, 0xd8, 0xff]) },
  ]) await assert.rejects(f.service.uploadAvatar('avatar', file), (error) => error.getStatus() === 400);
  assert.equal(uploads, 0);
  const validFile = { mimetype: 'image/jpeg', size: 5 * 1024 * 1024, buffer: Buffer.from([0xff, 0xd8, 0xff]) };
  assert.deepEqual(await f.service.uploadAvatar('avatar', validFile), { photoUrl: '/api/participant-auth/avatar/avatar' });
  assert.equal(uploads, 1, 'Avatar keeps its 8 MB limit');
  await assert.rejects(f.service.uploadDocument('avatar', 'PASSPORT', validFile), (error) => error.getStatus() === 400);
  assert.equal(uploads, 1, 'Documents keep their 4 MB limit');
});
