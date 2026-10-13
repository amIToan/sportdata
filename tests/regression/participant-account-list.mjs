// Run after npm run build:backend. Uses an in-memory adapter; no external services.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
require('reflect-metadata');
const { ParticipantAccountsService } = require('./dist/src/participants/participant-accounts.service.js');
const { ListParticipantAccountsDto } = require('./dist/src/participants/dto/list-participant-accounts.dto.js');
const { accountProfileState, usableAccountMedia } = require('./dist/src/participants/participant-account-profile.js');
const { plainToInstance } = require('class-transformer');
const { validateSync } = require('class-validator');

const media = (type, owner = 'test') => ({ type, storageKey: `local:${owner}/${type}`, size: 100,
  mimeType: type === 'AVATAR' ? 'image/png' : 'application/pdf', verificationStatus: type === 'AVATAR' ? null : 'VERIFIED' });
const files = (identityType, owner) => [media('AVATAR', owner),
  ...(identityType === 'CCCD' ? ['CCCD_FRONT', 'CCCD_BACK'] : ['PASSPORT']).map((type) => media(type, owner))];
const participation = (identityType, mediaFiles, index = 1) => ({ identityType,
  documentEncrypted: identityType ? `${identityType}-number` : null, media: mediaFiles,
  id: `participation-${index}`, createdAt: new Date(`2026-10-${String(index).padStart(2, '0')}`) });
const athlete = (mediaFiles, identity = null) => ({ media: mediaFiles, identity,
  photoUrl: 'https://example.invalid/legacy-avatar.png' });
const unit = { id: 'unit', name: 'Hanoi Unit', country: { code: 'VIE', name: 'Vietnam' } };
function account(id, accountType, extra = {}) {
  return { id, accountType, accountTypes: [accountType], email: `${id}@example.invalid`, displayName: id,
    phone: '0901234567', representativePosition: null, verificationStatus: 'VERIFIED', isActive: true,
    identityType: null, createdAt: new Date('2026-10-01'), federationId: null, federation: null,
    athlete: null, eventParticipations: [], ...extra };
}
const records = [
  account('A Athlete Complete', 'ATHLETE', { identityType: 'CCCD', federationId: 'unit', federation: unit,
    athlete: athlete(files('CCCD', 'athlete'), { cccdEncrypted: 'athlete-number', passportEncrypted: null }) }),
  account('B Legacy Avatar', 'ATHLETE', { identityType: 'CCCD', athlete: athlete([]) }),
  account('C Coach Fallback', 'COACH', { verificationStatus: 'PENDING', eventParticipations: [
    participation('CCCD', [media('AVATAR', 'latest'), media('CCCD_FRONT', 'latest')], 2),
    participation('PASSPORT', files('PASSPORT', 'older'), 1),
  ] }),
  account('D Referee No Number', 'REFEREE', { eventParticipations: [
    { ...participation('PASSPORT', files('PASSPORT', 'referee')), documentEncrypted: null },
  ] }),
  account('E Split Documents', 'TEAM_LEADER', { verificationStatus: 'PENDING', eventParticipations: [
    participation('CCCD', [media('AVATAR'), media('CCCD_FRONT')], 2),
    participation('CCCD', [media('CCCD_BACK')], 1),
  ] }),
  account('F Inferred Passport', 'ATHLETE', { athlete: athlete(files('PASSPORT', 'inferred')) }),
  account('G Wrong Known Type', 'ATHLETE', { identityType: 'CCCD', athlete: athlete(files('PASSPORT', 'wrong')) }),
  account('H Encrypted Known Type', 'ATHLETE', { athlete: athlete(files('PASSPORT', 'wrong'),
    { cccdEncrypted: 'cccd-number', passportEncrypted: null }) }),
  account('I Disabled', 'ATHLETE', { isActive: false }),
];

// Model Prisma relation and nullable scalar semantics to test SQL filter/projection agreement.
function matches(record, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'AND') return (Array.isArray(expected) ? expected : [expected]).every((condition) => matches(record, condition));
    if (key === 'OR') return expected.some((condition) => matches(record, condition));
    if (key === 'NOT') return !(Array.isArray(expected) ? expected : [expected]).some((condition) => matches(record, condition));
    const value = record?.[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('is' in expected) return expected.is === null ? value === null : value !== null && matches(value, expected.is);
      if ('some' in expected) return (value || []).some((item) => matches(item, expected.some));
      if ('has' in expected) return (value || []).includes(expected.has);
      return Object.entries(expected).every(([operator, argument]) => {
        if (operator === 'mode') return true;
        if (operator === 'equals') return value === argument;
        if (operator === 'not') return value !== null && value !== argument;
        if (operator === 'notIn') return value !== null && !argument.includes(value);
        if (operator === 'in') return argument.includes(value);
        if (operator === 'gt') return value > argument;
        if (operator === 'lte') return value <= argument;
        if (operator === 'contains') return value !== null && String(value).toLocaleLowerCase().includes(argument.toLocaleLowerCase());
        throw new Error(`Unhandled scalar operator ${operator}`);
      });
    }
    return value === expected;
  });
}
function sorted(rows, orderBy = []) {
  return [...rows].sort((left, right) => {
    for (const order of orderBy) {
      const [key, direction] = Object.entries(order)[0];
      const result = left[key] < right[key] ? -1 : left[key] > right[key] ? 1 : 0;
      if (result) return direction === 'asc' ? result : -result;
    }
    return 0;
  });
}
function project(record, select) {
  if (record === null) return null;
  return Object.fromEntries(Object.entries(select).map(([key, selection]) => {
    if (selection === true) return [key, record[key]];
    const value = record[key];
    if (Array.isArray(value)) {
      const rows = sorted(value.filter((item) => matches(item, selection.where)), selection.orderBy).slice(0, selection.take);
      return [key, rows.map((item) => project(item, selection.select))];
    }
    return [key, project(value, selection.select)];
  }));
}
const database = { participantAccount: {
  findMany: async ({ where, select, skip = 0, take, orderBy }) => sorted(records.filter((row) => matches(row, where)), orderBy)
    .slice(skip, take === undefined ? undefined : skip + take).map((row) => project(row, select)),
  findUnique: async ({ where, select }) => project(records.find((row) => row.id === where.id) || null, select),
  count: async ({ where }) => records.filter((row) => matches(row, where)).length,
} };
const prisma = { ...database, $transaction: async (operation) => operation(database) };
const reads = [];
const service = new ParticipantAccountsService(prisma, { read: async (key, variant) => {
  reads.push({ key, variant }); return Buffer.from('test-file');
} }, { decrypt: (value, identityType) => `${value}:${identityType}` });

const all = await service.list(plainToInstance(ListParticipantAccountsDto, {}));
assert.deepEqual(all.summary, { total: 9, complete: 4, incomplete: 5, pending: 2 });
assert.equal(all.items.filter((row) => row.profile.complete).length, all.summary.complete);
for (const sensitive of ['storageKey', 'documentEncrypted', 'password', 'athlete', 'eventParticipations']) {
  assert.ok(!JSON.stringify(all).includes(`"${sensitive}"`), `Account response must exclude ${sensitive}`);
}
const complete = await service.list(plainToInstance(ListParticipantAccountsDto, { profileStatus: 'COMPLETE' }));
assert.equal(complete.total, 4);
assert.ok(complete.items.every((row) => row.profile.complete));
assert.equal(complete.summary.incomplete, 0);
const incomplete = await service.list(plainToInstance(ListParticipantAccountsDto, { profileStatus: 'INCOMPLETE' }));
assert.equal(incomplete.total, 5);
assert.ok(incomplete.items.every((row) => !row.profile.complete));
const coach = await service.list(plainToInstance(ListParticipantAccountsDto, { accountType: 'COACH', verificationStatus: 'PENDING' }));
assert.equal(coach.total, 1);
assert.equal(coach.items[0].profile.identityType, 'PASSPORT');
assert.equal(coach.items[0].profile.documentNumber, 'PASSPORT-number:PASSPORT');
const unitSearch = await service.list(plainToInstance(ListParticipantAccountsDto, { search: 'hANOI', federationId: 'unit' }));
assert.equal(unitSearch.total, 1);
assert.equal(unitSearch.items[0].federation.id, 'unit');
const inactive = await service.list(plainToInstance(ListParticipantAccountsDto, { isActive: 'false', federationId: 'none' }));
assert.equal(inactive.total, 1);
assert.equal(inactive.items[0].isActive, false);
const page = await service.list(plainToInstance(ListParticipantAccountsDto, { sortBy: 'displayName', sortOrder: 'asc', page: '2', limit: '2' }));
assert.deepEqual(page.items.map((row) => row.id), ['C Coach Fallback', 'D Referee No Number']);
assert.equal(page.total, 9);
await service.getMedia('C Coach Fallback', 'AVATAR', 'avatar');
await service.getMedia('C Coach Fallback', 'PASSPORT', 'preview');
assert.deepEqual(reads, [{ key: 'local:older/AVATAR', variant: 'avatar' }, { key: 'local:older/PASSPORT', variant: undefined }]);
await assert.rejects(service.getMedia('C Coach Fallback', 'CCCD_FRONT'), (error) => error.getStatus() === 404);
await assert.rejects(service.getMedia('missing', 'AVATAR'), (error) => error.getStatus() === 404);

for (const query of [{ limit: '101' }, { page: '0' }, { isActive: 'anything' }, { sortBy: 'password' },
  { profileStatus: 'FULL' }, { accountType: 'UNKNOWN' }]) {
  assert.ok(validateSync(plainToInstance(ListParticipantAccountsDto, query)).length > 0);
}
for (const invalid of [{ storageKey: null }, { storageKey: ' ' }, { size: 0 }, { size: NaN },
  { size: 8 * 1024 * 1024 + 1 }, { mimeType: 'application/pdf' }]) {
  assert.equal(usableAccountMedia({ ...media('AVATAR'), ...invalid }), false);
}
assert.equal(accountProfileState({ identityType: 'CCCD', documentEncrypted: null, media: files('CCCD') }).complete, true);
console.log('Participant account list regression checks passed');
