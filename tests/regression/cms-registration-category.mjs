// Run after npm run build:backend. Exercises category edits without a live database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
const { ParticipantsService } = require('./dist/src/participants/participants.service.js');
const ts = require('typescript');
const frontendModule = { exports: {} };
const frontendSource = readFileSync(new URL('../../apps/frontend/src/lib/registration-table.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(frontendSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
new Function('exports', compiled)(frontendModule.exports);
const { registrationDisciplineKey } = frontendModule.exports;

const category = (id, discipline, extra = {}) => ({
  id, name: id, sportId: 'jujitsu', discipline, uniform: null, eventId: 'event',
  gender: 'MALE', minAge: null, maxAge: null, minWeight: null, maxWeight: 77,
  maxEntriesPerCountry: null, ...extra,
});

const uploadedMedia = (identityType = 'CCCD') => [
  { type: 'AVATAR', storageKey: 'avatars/test.png', mimeType: 'image/png', size: 100, verificationStatus: null },
  ...(identityType === 'CCCD' ? ['CCCD_FRONT', 'CCCD_BACK'] : ['PASSPORT']).map((type) => ({
    type, storageKey: `documents/${type}.pdf`, mimeType: 'application/pdf', size: 100, verificationStatus: 'VERIFIED',
  })),
];

function fixture({ status = 'CONFIRMED', entry = true, athlete = {}, categories = [], paymentMode = 'MANUAL' } = {}) {
  const event = { id: 'event', startDate: new Date('2035-01-01'), ageLimitMode: 'CATEGORY',
    allowIndependentAthletes: true, participatingFederations: [], paymentMode, registrationFee: 100000, registrationCurrency: 'VND' };
  let profile = { id: 'athlete', fullName: 'Nguyen Van A', gender: 'MALE', weight: 65,
    birthDate: new Date('2000-01-01'), countryId: 'VIE', federationId: null, media: uploadedMedia(), ...athlete };
  const allCategories = [category('fighting-69', 'FIGHTING'), category('fighting-77', 'FIGHTING'),
    category('gi-77', 'NEWAZA', { uniform: 'GI' }), category('nogi-77', 'NEWAZA', { uniform: 'NO_GI' }),
    category('contact-77', 'CONTACT'), category('full-contact-77', 'FULL_CONTACT'), ...categories];
  let state = {
    registrations: [{ id: 'registration', athleteId: 'athlete', eventId: 'event', categoryId: 'fighting-69',
      status, ticketCode: 'A6-UNCHANGED', paymentStatus: 'PAID', feeAmount: 100000, currency: 'VND' }],
    entries: entry ? [{ id: 'entry', athleteId: 'athlete', countryId: 'VIE', eventId: 'event', categoryId: 'fighting-69',
      status: status === 'CONFIRMED' ? 'VERIFIED' : 'WITHDRAWN', seed: 2, bib: '007' }] : [],
    draw: [], match: [], heat: [], roundRobinGroup: [], notifications: [], paymentHistory: [], uploads: [], removedKeys: [],
  };
  const hydrate = (record) => record && { ...record, event, athlete: profile,
    category: allCategories.find((item) => item.id === record.categoryId) };
  const matches = (record, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === 'athlete') return value.countryId === profile.countryId;
    if (value && typeof value === 'object') {
      if ('not' in value) return record[key] !== value.not;
      if ('in' in value) return value.in.includes(record[key]);
      if ('gt' in value) return record[key] > value.gt;
    }
    return record[key] === value;
  });
  const model = (name) => ({
    create: async ({ data }) => {
      const record = { id: `${name}-${state[name].length + 1}`, ...data };
      state[name].push(record);
      return hydrate(record);
    },
    findUnique: async ({ where }) => hydrate(state[name].find((record) => matches(record, where.eventId_categoryId_athleteId || where))),
    findUniqueOrThrow: async ({ where }) => {
      const record = state[name].find((item) => matches(item, where));
      assert.ok(record);
      return hydrate(record);
    },
    findMany: async ({ where }) => state[name].filter((record) => matches(record, where)).map(hydrate),
    count: async ({ where }) => state[name].filter((record) => matches(record, where)).length,
    update: async ({ where, data }) => {
      const record = state[name].find((item) => matches(item, where));
      Object.assign(record, data);
      return hydrate(record);
    },
    updateMany: async ({ where, data }) => {
      const records = state[name].filter((record) => matches(record, where));
      records.forEach((record) => Object.assign(record, data));
      return { count: records.length };
    },
    deleteMany: async ({ where }) => {
      const selected = state[name].filter((record) => matches(record, where));
      state[name] = state[name].filter((record) => !selected.includes(record));
      return { count: selected.length };
    },
  });
  const prisma = {
    eventRegistration: model('registrations'), competitionEntry: model('entries'),
    paymentStatusHistory: model('paymentHistory'),
    participantMediaUpload: model('uploads'),
    event: { findUnique: async ({ include }) => ({ ...event, categories: allCategories.filter((item) => item.id === include.categories.where.id) }) },
    country: { findUnique: async ({ where }) => where.id === 'VIE' ? { id: 'VIE' } : null },
    category: { findFirst: async ({ where }) => allCategories.find((item) => item.id === where.id && item.eventId === where.events.some.id) },
    athlete: {
      findUnique: async ({ where }) => where.id === profile.id ? profile : null,
      findUniqueOrThrow: async ({ where }) => { assert.equal(where.id, profile.id); return profile; },
      create: async ({ data }) => { profile = { ...data, id: 'new-athlete', media: data.media?.create || [] }; return profile; },
      update: async ({ data }) => { Object.assign(profile, data); return profile; },
    },
    athleteMedia: {
      findMany: async () => profile.media,
      upsert: async ({ where, create, update }) => {
        const previous = profile.media.find((item) => item.type === where.athleteId_type.type);
        if (previous) { Object.assign(previous, update); return previous; }
        profile.media.push(create);
        return create;
      },
      updateMany: async ({ where, data }) => {
        const rows = profile.media.filter((item) => matches(item, Object.fromEntries(Object.entries(where).filter(([key]) => key !== 'athleteId'))));
        rows.forEach((item) => Object.assign(item, data));
        return { count: rows.length };
      },
    },
    $executeRaw: async () => 1, $queryRaw: async () => [],
    ...Object.fromEntries(['draw', 'match', 'heat', 'roundRobinGroup'].map((name) => [name, model(name)])),
    $transaction: async (work) => {
      const snapshot = structuredClone(state);
      try { return await work(prisma); }
      catch (error) { state = snapshot; throw error; }
    },
  };
  prisma.competitionEntry.upsert = async ({ where, create, update }) => {
    const existing = state.entries.find((record) => matches(record, where.eventId_categoryId_athleteId));
    if (existing) { Object.assign(existing, update); return existing; }
    const created = { id: 'new-entry', ...create };
    state.entries.push(created);
    return created;
  };
  const service = new ParticipantsService(prisma, { deleteQuietly: async (key) => state.removedKeys.push(key) }, {}, {}, {},
    { get: async () => ({ values: { identityOcrEnabled: true } }) }, {
    notifyRegistration: async (_database, registrationId, type, title, detail) => state.notifications.push({ registrationId, type, title, detail }),
  }, { lock: async () => {}, assertNew: async () => {}, normalize: () => ({ documentHash: 'test-document' }) });
  const stage = (identityType = 'CCCD') => {
    const keys = { AVATAR: 'avatar', CCCD_FRONT: 'cccdFront', CCCD_BACK: 'cccdBack', PASSPORT: 'passport' };
    return Object.fromEntries(uploadedMedia(identityType).map((media, index) => {
      const id = `staged-${index}`;
      const token = `staged-token-${index}`;
      state.uploads.push({ ...media, storageKey: `staged/${media.type}`, id,
        tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date('2035-01-01') });
      return [keys[media.type], { id, token }];
    }));
  };
  return { service, state: () => state, profile, allCategories, stage };
}

const changed = fixture();
const before = structuredClone(changed.state().registrations[0]);
const result = await changed.service.updateRegistrationCategory('registration', 'fighting-77', 'admin@example.test');
assert.equal(result.category.id, 'fighting-77');
assert.deepEqual(changed.state().registrations[0], { ...before, categoryId: 'fighting-77' });
assert.deepEqual(changed.state().entries[0], { id: 'entry', athleteId: 'athlete', countryId: 'VIE', eventId: 'event',
  categoryId: 'fighting-77', status: 'VERIFIED', seed: null, bib: '007' });
assert.match(changed.state().notifications[0].detail, /fighting-69 → fighting-77 · admin@example.test/);

const pending = fixture({ status: 'SUBMITTED', entry: false });
await pending.service.updateRegistrationCategory('registration', 'gi-77');
assert.equal(pending.state().registrations[0].status, 'SUBMITTED');
assert.equal(pending.state().entries.length, 0);
const cancelled = fixture({ status: 'CANCELLED' });
await cancelled.service.updateRegistrationCategory('registration', 'gi-77');
assert.equal(cancelled.state().entries[0].status, 'WITHDRAWN');
const missingEntry = fixture({ entry: false });
await missingEntry.service.updateRegistrationCategory('registration', 'gi-77');
assert.equal(missingEntry.state().entries[0].status, 'VERIFIED');

async function rejectsUnchanged(f, categoryId, pattern) {
  const before = structuredClone(f.state());
  await assert.rejects(f.service.updateRegistrationCategory('registration', categoryId), pattern);
  assert.deepEqual(f.state(), before, 'Rejected edits must not mutate registrations, entries, or notifications');
}
for (const [extra, message] of [
  [{ gender: 'FEMALE' }, /Giới tính/], [{ minAge: 40 }, /đủ 40 tuổi/], [{ maxAge: 20 }, /tối đa 20 tuổi/],
  [{ minWeight: 70 }, /tối thiểu/], [{ maxWeight: 60 }, /tối đa/], [{ sportId: 'other' }, /cùng môn/],
  [{ eventId: 'other' }, /không thuộc/],
]) {
  await rejectsUnchanged(fixture({ categories: [category('invalid', 'DUO', extra)] }), 'invalid', message);
}
await rejectsUnchanged(fixture(), 'unknown', /không thuộc/);

const duplicate = fixture();
duplicate.state().registrations.push({ ...duplicate.state().registrations[0], id: 'other-registration', categoryId: 'gi-77' });
await rejectsUnchanged(duplicate, 'gi-77', /đã đăng ký/);
await duplicate.service.updateRegistrationCategory('registration', 'nogi-77');
assert.equal(duplicate.state().registrations[0].categoryId, 'nogi-77', 'Gi and No-Gi are separate disciplines');
const alias = fixture();
alias.state().registrations.push({ ...alias.state().registrations[0], id: 'other-registration', categoryId: 'contact-77' });
await rejectsUnchanged(alias, 'full-contact-77', /đã đăng ký/);

for (const model of ['draw', 'match', 'heat', 'roundRobinGroup']) {
  for (const categoryId of ['fighting-69', 'fighting-77']) {
    const f = fixture();
    f.state()[model].push({ eventId: 'event', categoryId });
    await rejectsUnchanged(f, 'fighting-77', /bốc thăm hoặc lịch thi đấu/);
  }
}
const targetEntry = fixture();
targetEntry.state().entries.push({ ...targetEntry.state().entries[0], id: 'target-entry', categoryId: 'gi-77', status: 'WITHDRAWN' });
await rejectsUnchanged(targetEntry, 'gi-77', /suất thi đấu/);
for (const table of ['registrations', 'entries']) {
  const f = fixture({ categories: [category('limited', 'DUO', { maxEntriesPerCountry: 1 })] });
  f.state()[table].push({ id: 'other', eventId: 'event', categoryId: 'limited', athleteId: 'other-athlete', countryId: 'VIE',
    status: table === 'entries' ? 'VERIFIED' : 'CONFIRMED' });
  await rejectsUnchanged(f, 'limited', /đạt giới hạn/);
}
const mixedQuota = fixture({ categories: [category('limited', 'DUO', { maxEntriesPerCountry: 2 })] });
mixedQuota.state().registrations.push({ id: 'pending', eventId: 'event', categoryId: 'limited', athleteId: 'pending-athlete', status: 'SUBMITTED' });
mixedQuota.state().entries.push({ id: 'direct-entry', eventId: 'event', categoryId: 'limited', athleteId: 'direct-athlete', countryId: 'VIE', status: 'VERIFIED' });
await rejectsUnchanged(mixedQuota, 'limited', /đạt giới hạn/);
mixedQuota.state().entries[1].athleteId = 'pending-athlete';
await mixedQuota.service.updateRegistrationCategory('registration', 'limited');
assert.equal(mixedQuota.state().registrations[0].categoryId, 'limited', 'An athlete with a registration and entry only uses one quota place');
const unchanged = fixture();
await unchanged.service.updateRegistrationCategory('registration', 'fighting-69');
assert.equal(unchanged.state().entries[0].seed, 2);
assert.equal(unchanged.state().notifications.length, 0);
await assert.rejects(unchanged.service.updateRegistrationCategory('missing', 'gi-77'), /Không tìm thấy/);

for (const [paymentMode, selectedPayment, expectedPayment] of [
  ['FREE', undefined, 'NOT_REQUIRED'], ['MANUAL', 'PAID', 'PAID'], ['MANUAL', 'PENDING', 'PENDING'],
]) {
  for (const isNew of [false, true]) {
    const f = fixture({ paymentMode });
    const dto = { eventId: 'event', categoryId: 'gi-77', paymentStatus: selectedPayment,
      ...(isNew ? { athlete: { firstName: 'Nguyen', lastName: 'Van B', fullName: 'Nguyen Van B',
        email: 'new@example.test', phone: '0901234567', gender: 'MALE', weight: 65,
        birthDate: '2000-01-01', countryId: 'VIE', identityType: 'CCCD', documentNumber: '123456789012' },
        mediaUploads: f.stage() } : { athleteId: 'athlete' }) };
    const eligibility = await f.service.checkAdminRegistrationEligibility(dto);
    assert.equal(eligibility.eligible, true);
    assert.ok(eligibility.warnings.every((message) => !message.includes('chờ duyệt')));
    const created = await f.service.createAdminRegistration(dto, 'admin@example.test');
    assert.equal(created.status, 'CONFIRMED', 'CMS registrations with complete files are approved immediately');
    assert.equal(created.paymentStatus, expectedPayment, 'Immediate approval must not change the selected payment state');
    assert.equal(created.feeAmount, paymentMode === 'FREE' ? 0 : 100000);
    assert.equal(created.statusChangedBy, 'admin@example.test');
    assert.equal(created.athlete.media.length, 3, 'Actual portrait and both identity documents must be persisted');
    assert.ok(created.athlete.media.every((item) => item.storageKey && item.size > 0));
    if (isNew) {
      assert.equal(f.state().uploads.length, 0, 'Staging references are consumed in the creation transaction');
      assert.ok(created.athlete.media.filter((item) => item.type !== 'AVATAR').every((item) => item.verificationStatus === 'VERIFIED'
        && item.verifiedBy === 'admin@example.test'), 'CMS records the administrator who checked the new documents');
    }
    assert.ok(f.state().entries.some((item) => item.categoryId === 'gi-77' && item.athleteId === created.athleteId && item.status === 'VERIFIED'));
    assert.equal(f.state().paymentHistory.length, expectedPayment === 'PAID' ? 1 : 0);
    await assert.rejects(f.service.createAdminRegistration({ eventId: 'event', categoryId: 'gi-77', athleteId: created.athleteId }), /đã đăng ký/);
  }
}

const newAthlete = { firstName: 'Nguyen', lastName: 'Van B', fullName: 'Nguyen Van B',
  email: 'new@example.test', phone: '0901234567', gender: 'MALE', weight: 65,
  birthDate: '2000-01-01', countryId: 'VIE', identityType: 'PASSPORT', documentNumber: 'P1234567' };
for (const athlete of [{ media: [] }, { media: uploadedMedia().filter((item) => item.type !== 'AVATAR') },
  { media: uploadedMedia().map((item) => item.type === 'CCCD_BACK' ? { ...item, storageKey: null } : item) }]) {
  const f = fixture({ athlete });
  const dto = { eventId: 'event', categoryId: 'gi-77', athleteId: 'athlete' };
  assert.equal((await f.service.checkAdminRegistrationEligibility(dto)).eligible, false);
  await assert.rejects(f.service.createAdminRegistration(dto), /ảnh|CCCD|hộ chiếu|giấy tờ/);
  assert.equal(f.state().registrations.length, 1, 'CMS rejects incomplete legacy profiles before creating a registration');
}
const newWithoutFiles = fixture();
const newDto = { eventId: 'event', categoryId: 'gi-77', athlete: newAthlete };
assert.equal((await newWithoutFiles.service.checkAdminRegistrationEligibility(newDto)).eligible, false);
await assert.rejects(newWithoutFiles.service.createAdminRegistration(newDto), /ảnh|CCCD|hộ chiếu|giấy tờ/);
const passport = fixture({ paymentMode: 'FREE' });
const passportDto = { ...newDto, mediaUploads: passport.stage('PASSPORT') };
assert.equal((await passport.service.checkAdminRegistrationEligibility(passportDto)).eligible, true);
const passportRegistration = await passport.service.createAdminRegistration(passportDto);
assert.deepEqual(passportRegistration.athlete.media.map((item) => item.type).sort(), ['AVATAR', 'PASSPORT']);
assert.equal(passport.state().uploads.length, 0);
for (const corrupt of [
  (dto) => { delete dto.mediaUploads.avatar; },
  (dto) => { dto.mediaUploads.passport.token = 'invalid-token'; },
  (_dto, f) => { f.state().uploads[1].expiresAt = new Date('2000-01-01'); },
  (_dto, f) => { f.state().uploads[1].storageKey = null; },
  (_dto, f) => { f.state().uploads[0].mimeType = 'application/pdf'; },
]) {
  const f = fixture({ paymentMode: 'FREE' });
  const dto = { ...newDto, mediaUploads: f.stage('PASSPORT') };
  corrupt(dto, f);
  await assert.rejects(f.service.createAdminRegistration(dto), /ảnh|CCCD|hộ chiếu|giấy tờ|tệp|JPG|PDF/i);
  assert.equal(f.state().registrations.length, 1);
}
const ineligibleAdmin = fixture({ athlete: { weight: 80 } });
await assert.rejects(ineligibleAdmin.service.createAdminRegistration({ eventId: 'event', categoryId: 'gi-77', athleteId: 'athlete' }), /tối đa/);

assert.equal(registrationDisciplineKey(category('gi', 'NEWAZA')), registrationDisciplineKey(category('gi', 'NEWAZA', { uniform: 'GI' })));
assert.notEqual(registrationDisciplineKey(category('gi', 'NEWAZA')), registrationDisciplineKey(category('nogi', 'NEWAZA', { uniform: 'NO_GI' })));
assert.equal(registrationDisciplineKey(category('contact', 'CONTACT')), registrationDisciplineKey(category('full-contact', 'FULL_CONTACT')));
console.log('CMS category edits and immediate admin registration approval regression checks passed.');
