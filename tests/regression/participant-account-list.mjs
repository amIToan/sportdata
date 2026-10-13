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
    identityType: null, documentEncrypted: null, media: [], createdAt: new Date('2026-10-01'), federationId: null, federation: null,
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
  account('J Own Complete', 'REFEREE', { identityType: 'PASSPORT', documentEncrypted: 'own-number',
    media: files('PASSPORT', 'own-complete'), eventParticipations: [participation('CCCD', files('CCCD', 'own-old'))] }),
  account('K Own Partial Replacement', 'TEAM_LEADER', { identityType: 'CCCD', documentEncrypted: 'replacement-number',
    media: [media('AVATAR', 'replacement'), media('CCCD_FRONT', 'replacement')],
    eventParticipations: [participation('CCCD', files('CCCD', 'replacement-old'))] }),
  account('L Own Unknown Type', 'COACH', { media: files('CCCD', 'unknown-own'),
    eventParticipations: [participation('PASSPORT', files('PASSPORT', 'unknown-old'))] }),
  account('M Own Invalid Files', 'REFEREE', { identityType: 'PASSPORT',
    media: [{ ...media('AVATAR', 'invalid-own'), storageKey: null }, media('PASSPORT', 'invalid-own')],
    eventParticipations: [participation('PASSPORT', files('PASSPORT', 'invalid-old'))] }),
  account('N Linked Ignores Own', 'ATHLETE', { identityType: 'CCCD',
    media: [media('AVATAR', 'dormant-own')], athlete: athlete(files('CCCD', 'linked-current'),
      { cccdEncrypted: 'current-athlete-number', passportEncrypted: null }) }),
  account('O Own Passport', 'COACH', { identityType: 'PASSPORT', documentEncrypted: 'current-passport-number',
    media: files('PASSPORT', 'passport-current') }),
];

// Model Prisma relation and nullable scalar semantics to test SQL filter/projection agreement.
const sqlAnd = (values) => values.includes(false) ? false : values.includes(null) ? null : true;
const sqlOr = (values) => values.includes(true) ? true : values.includes(null) ? null : false;
const sqlNot = (value) => value === null ? null : !value;
function matches(record, where = {}) {
  return sqlAnd(Object.entries(where).map(([key, expected]) => {
    if (key === 'AND') return sqlAnd((Array.isArray(expected) ? expected : [expected]).map((condition) => matches(record, condition)));
    if (key === 'OR') return sqlOr(expected.map((condition) => matches(record, condition)));
    if (key === 'NOT') return sqlAnd((Array.isArray(expected) ? expected : [expected]).map((condition) => sqlNot(matches(record, condition))));
    const value = record?.[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('is' in expected) return expected.is === null ? value === null : value !== null && matches(value, expected.is) === true;
      if ('isNot' in expected) return expected.isNot === null ? value !== null : value === null || matches(value, expected.isNot) !== true;
      if ('some' in expected) return (value || []).some((item) => matches(item, expected.some) === true);
      if ('none' in expected) return !(value || []).some((item) => matches(item, expected.none) === true);
      if ('has' in expected) return (value || []).includes(expected.has);
      return sqlAnd(Object.entries(expected).map(([operator, argument]) => {
        if (operator === 'mode') return true;
        if (operator === 'equals') return argument === null ? value === null : value === null ? null : value === argument;
        if (operator === 'not') return argument === null ? value !== null : value === null ? null : value !== argument;
        if (operator === 'notIn') return value === null ? null : !argument.includes(value);
        if (operator === 'in') return argument.includes(value);
        if (operator === 'gt') return value > argument;
        if (operator === 'lte') return value <= argument;
        if (operator === 'contains') return value !== null && String(value).toLocaleLowerCase().includes(argument.toLocaleLowerCase());
        throw new Error(`Unhandled scalar operator ${operator}`);
      }));
    }
    return expected === null ? value === null : value === null ? null : value === expected;
  }));
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
  if (record == null) return null;
  return Object.fromEntries(Object.entries(select).map(([key, selection]) => {
    if (selection === true) return [key, record[key]];
    const value = record[key] ?? (key === 'media' ? [] : null);
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
assert.deepEqual(all.summary, { total: 15, complete: 7, incomplete: 8, pending: 2 });
assert.equal(all.items.filter((row) => row.profile.complete).length, all.summary.complete);
for (const sensitive of ['storageKey', 'documentEncrypted', 'password', 'athlete', 'eventParticipations']) {
  assert.ok(!JSON.stringify(all).includes(`"${sensitive}"`), `Account response must exclude ${sensitive}`);
}
const complete = await service.list(plainToInstance(ListParticipantAccountsDto, { profileStatus: 'COMPLETE' }));
assert.equal(complete.total, 7);
assert.ok(complete.items.every((row) => row.profile.complete));
assert.equal(complete.summary.incomplete, 0);
const incomplete = await service.list(plainToInstance(ListParticipantAccountsDto, { profileStatus: 'INCOMPLETE' }));
assert.equal(incomplete.total, 8);
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
assert.equal(page.total, 15);
await service.getMedia('C Coach Fallback', 'AVATAR', 'avatar');
await service.getMedia('C Coach Fallback', 'PASSPORT', 'preview');
assert.deepEqual(reads, [{ key: 'local:older/AVATAR', variant: 'avatar' }, { key: 'local:older/PASSPORT', variant: undefined }]);
await assert.rejects(service.getMedia('C Coach Fallback', 'CCCD_FRONT'), (error) => error.getStatus() === 404);
await assert.rejects(service.getMedia('missing', 'AVATAR'), (error) => error.getStatus() === 404);

const ownComplete = all.items.find((row) => row.id === 'J Own Complete').profile;
assert.equal(ownComplete.identityType, 'PASSPORT');
assert.equal(ownComplete.documentNumber, 'own-number:PASSPORT');
assert.equal(all.items.find((row) => row.id === 'K Own Partial Replacement').profile.complete, false,
  'A partial own replacement must not be masked by an older complete event profile');
assert.equal(all.items.find((row) => row.id === 'K Own Partial Replacement').profile.documentNumber, 'replacement-number:CCCD');
assert.equal(all.items.find((row) => row.id === 'L Own Unknown Type').profile.identityType, null);
assert.equal(all.items.find((row) => row.id === 'N Linked Ignores Own').profile.documentNumber, 'current-athlete-number:CCCD');
const beforeReplacement = ownComplete.media.find((file) => file.type === 'PASSPORT').revision;
const ownRecord = records.find((row) => row.id === 'J Own Complete');
ownRecord.media.find((file) => file.type === 'PASSPORT').storageKey = 'local:own-complete/replaced-passport.pdf';
const replaced = await service.list(plainToInstance(ListParticipantAccountsDto, { search: 'J Own Complete' }));
assert.notEqual(replaced.items[0].profile.media.find((file) => file.type === 'PASSPORT').revision, beforeReplacement);
reads.length = 0;
await service.getMedia('J Own Complete', 'PASSPORT', 'preview');
await service.getMedia('K Own Partial Replacement', 'AVATAR', 'avatar');
await service.getMedia('N Linked Ignores Own', 'AVATAR', 'avatar');
assert.deepEqual(reads, [
  { key: 'local:own-complete/replaced-passport.pdf', variant: undefined },
  { key: 'local:replacement/AVATAR', variant: 'avatar' },
  { key: 'local:linked-current/AVATAR', variant: 'avatar' },
]);
await assert.rejects(service.getMedia('J Own Complete', 'CCCD_FRONT'), (error) => error.getStatus() === 404);
await assert.rejects(service.getMedia('K Own Partial Replacement', 'CCCD_BACK'), (error) => error.getStatus() === 404);
await assert.rejects(service.getMedia('M Own Invalid Files', 'AVATAR'), (error) => error.getStatus() === 404);

const ownPassportRecord = records.find((row) => row.id === 'O Own Passport');
const originalPassportMedia = ownPassportRecord.media;
ownPassportRecord.eventParticipations = [participation('PASSPORT', files('PASSPORT', 'invalid-document-old'))];
for (const invalid of [{ storageKey: null }, { storageKey: '' }, { size: 0 },
  { size: 8 * 1024 * 1024 + 1 }, { mimeType: 'image/svg+xml' }]) {
  ownPassportRecord.media = originalPassportMedia.map((file) => file.type === 'PASSPORT' ? { ...file, ...invalid } : file);
  const filtered = await service.list(plainToInstance(ListParticipantAccountsDto, {
    search: 'O Own Passport', profileStatus: 'INCOMPLETE',
  }));
  assert.equal(filtered.total, 1, 'Invalid own document metadata must agree with the database completeness filter');
  assert.equal(filtered.items[0].profile.complete, false);
  assert.equal(filtered.summary.complete, 0);
  await assert.rejects(service.getMedia('O Own Passport', 'PASSPORT'), (error) => error.getStatus() === 404);
}
ownPassportRecord.media = originalPassportMedia;

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
