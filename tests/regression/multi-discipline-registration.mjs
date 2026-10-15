// Run after npm run build:backend. Uses an in-memory database adapter; no external services.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
const { ParticipantsService } = require('./dist/src/participants/participants.service.js');
const { PaymentsService } = require('./dist/src/payments/payments.service.js');
const { JwtService } = require('@nestjs/jwt');

const disciplines = [
  ['FIGHTING', null], ['DUO', null], ['SHOW', null], ['CONTACT', null],
  ['NEWAZA', 'GI'], ['NEWAZA', 'NO_GI'], ['FIGHTING', null], ['FULL_CONTACT', null],
];
const categories = disciplines.map(([discipline, uniform], index) => ({
  id: `category-${index}`, name: `Category ${index}`, sportId: 'jujitsu', discipline, uniform,
  gender: 'MALE', minAge: null, maxAge: null, minWeight: null, maxWeight: 70,
  sport: { name: 'Ju-Jitsu' },
}));

function matches(record, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    if (key.startsWith('eventId_')) return matches(record, expected);
    if (key === 'OR') return expected.some((condition) => matches(record, condition));
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('not' in expected) return record[key] !== expected.not;
      if ('notIn' in expected) return !expected.notIn.includes(record[key]);
      if ('in' in expected) return expected.in.includes(record[key]);
      if ('lte' in expected) return record[key] <= expected.lte;
      if ('gt' in expected) return record[key] > expected.gt;
    }
    return record[key] === expected;
  });
}

function fixture(paymentMode = 'MANUAL') {
  let state = { athletes: [], registrations: [], submissions: [], entries: [], teams: [],
    payments: [], paymentHistory: [], statusHistory: [], emails: [] };
  let sequence = 0;
  let uploads = 0;
  let identityChecks = 0;
  const event = { id: 'event', isPublished: true, registrationEnabled: true, startDate: new Date('2035-01-01'),
    registrationOpenAt: null, registrationCloseAt: null, paymentMode,
    registrationFee: paymentMode === 'FREE' ? 0 : 100000, registrationCurrency: 'VND',
    allowIndependentAthletes: true, categories, participatingFederations: [], ageLimitMode: 'UNRESTRICTED' };
  const hydrate = (record) => record && ({ ...record,
    team: state.teams.find((team) => team.id === record.teamId),
    category: categories.find((category) => category.id === record.categoryId),
    athlete: state.athletes.find((athlete) => athlete.id === record.athleteId),
    submission: state.submissions.find((submission) => submission.id === record.submissionId),
    registration: structuredClone(state.registrations.find((registration) => registration.id === record.registrationId)),
  });
  const model = (table) => ({
    findMany: async ({ where } = {}) => state[table].filter((record) => matches(record, where)).map(hydrate),
    findFirst: async ({ where } = {}) => hydrate(state[table].find((record) => matches(record, where))),
    findUnique: async ({ where }) => hydrate(state[table].find((record) => matches(record, where))),
    findUniqueOrThrow: async ({ where }) => {
      const record = state[table].find((item) => matches(item, where));
      assert.ok(record, `${table} record must exist`);
      return hydrate(record);
    },
    create: async ({ data }) => {
      const record = { id: `record-${++sequence}`, createdAt: new Date(), ...data };
      if (table === 'teams') record.members = data.members.create;
      if (table === 'athletes') record.media = data.media?.create || [];
      state[table].push(record);
      return hydrate(record);
    },
    update: async ({ where, data }) => {
      const record = state[table].find((item) => matches(item, where));
      assert.ok(record);
      Object.assign(record, data);
      return hydrate(record);
    },
    updateMany: async ({ where, data }) => {
      const records = state[table].filter((item) => matches(item, where));
      records.forEach((record) => Object.assign(record, data));
      return { count: records.length };
    },
  });
  const prisma = {
    $executeRaw: async () => 1,
    team: model('teams'),
    category: { findUnique: async ({ where }) => categories.find((category) => category.id === where.id) },
    event: { findUnique: async () => event },
    country: { findMany: async () => [{ id: 'VIE' }] },
    participantAccount: { findUnique: async () => null },
    eventRegistration: model('registrations'), athlete: model('athletes'),
    registrationSubmission: model('submissions'), paymentTransaction: model('payments'),
    paymentStatusHistory: model('paymentHistory'), registrationStatusHistory: model('statusHistory'),
    athleteMedia: {
      findMany: async ({ where }) => state.athletes.find((athlete) => athlete.id === where.athleteId).media,
      upsert: async ({ where, create, update }) => {
        const athlete = state.athletes.find((item) => item.id === where.athleteId_type.athleteId);
        const previous = athlete.media.find((item) => item.type === where.athleteId_type.type);
        if (previous) { Object.assign(previous, update); return previous; }
        athlete.media.push(create);
        return create;
      },
      updateMany: async ({ where: { athleteId, ...where }, data }) => {
        const records = state.athletes.find((athlete) => athlete.id === athleteId).media.filter((record) => matches(record, where));
        records.forEach((record) => Object.assign(record, data));
        return { count: records.length };
      },
    },
    competitionEntry: {
      upsert: async ({ create, update }) => {
        const existing = state.entries.find((entry) => entry.athleteId === create.athleteId && entry.teamId === create.teamId && entry.categoryId === create.categoryId);
        if (!existing) state.entries.push(create);
        else Object.assign(existing, update);
        return existing || create;
      },
      updateMany: async () => ({ count: 0 }),
    },
    $transaction: async (operation) => {
      const before = structuredClone(state);
      try { return await operation(prisma); }
      catch (error) { state = before; throw error; }
    },
  };
  const identity = {
    lock: async () => {},
    normalize: ({ documentNumber }) => ({ documentHash: documentNumber }),
    assertNew: async (_, input) => {
      identityChecks += 1;
      assert.ok(!state.athletes.some((athlete) => athlete.identity?.create.documentHash === input.documentNumber));
      return { documentHash: input.documentNumber };
    },
    findDocumentMatches: async (_, input) => state.athletes
      .filter((athlete) => athlete.identity?.create.documentHash === input.documentNumber)
      .map((athlete) => ({ ...athlete, country: { name: 'Vietnam' },
        publicRegistrations: state.registrations.filter((registration) => registration.athleteId === athlete.id).map(hydrate) })),
  };
  const storage = { upload: async () => ({ key: `upload-${++uploads}`, size: 8 }), deleteQuietly: async () => {} };
  const queue = {
    enqueueSubmission: async (_, email, code) => state.emails.push({ email, code }),
    enqueueTicket: async (_, email, code) => state.emails.push({ email, code }),
  };
  const settings = { get: async () => ({ values: { identityOcrEnabled } }) };
  const notifications = { notifyRegistration: async () => {} };
  const service = new ParticipantsService(prisma, storage, new JwtService({ secret: 'regression-test' }), {}, queue, settings, notifications, identity);
  const payments = new PaymentsService(prisma, settings, notifications, service);
  const files = ['avatar', 'cccdFront', 'cccdBack'].map((field) => ({
    fieldname: `athlete_0_${field}`, mimetype: 'image/png', size: 8,
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  }));
  const athlete = { fullName: 'Test Athlete', birthDate: '2000-01-01', gender: 'MALE', countryId: 'VIE',
    identityType: 'CCCD', documentNumber: '123456789012', phone: '0901234567', weight: 65 };
  const payload = (draft) => JSON.stringify({ eventId: event.id, contactName: 'Test Contact',
    contactEmail: 'test@example.invalid', contactPhone: athlete.phone, athletes: [draft] });
  const reuse = async () => {
    const lookup = await service.lookupAthlete({ eventId: event.id, ...athlete });
    return { ...athlete, reuseToken: lookup.reuseToken, profileConfirmed: true };
  };
  return { service, payments, prisma, files, athlete, payload, reuse,
    state: () => state, stats: () => ({ uploads, identityChecks }) };
}

// New athlete: four individual discipline fees with one identity/media set.
const f = fixture();
const selected = categories.slice(0, 6).filter((category) => !['DUO', 'SHOW'].includes(category.discipline)).map((category) => category.id);
const result = await f.service.createGuestRegistrations(f.payload({ ...f.athlete, categoryIds: selected }), f.files);
assert.equal(result.type, 'INDIVIDUAL');
assert.equal(result.registrations.length, 4);
assert.equal(new Set(result.registrations.map((registration) => registration.athleteId)).size, 1);
assert.equal(new Set(result.registrations.map((registration) => registration.ticketCode)).size, 4);
assert.equal(result.registrations.reduce((sum, registration) => sum + registration.feeAmount, 0), 400000);
assert.ok(result.registrations.every((registration) => registration.athleteIndex === 0 && selected.includes(registration.categoryId)));
assert.ok(result.registrations.every((registration) => registration.feeAmount === 100000 && registration.paymentStatus === 'PENDING'));
assert.deepEqual(f.stats(), { uploads: 3, identityChecks: 1 });
const lookup = await f.service.lookupAthlete({ eventId: 'event', ...f.athlete });
assert.equal(lookup.registrations.length, 4);
assert.ok(lookup.registrations.every((registration) => registration.feeAmount === 100000));

// Retrying returns the original tickets without another fee or athlete.
const draft = await f.reuse();
const retry = await f.service.createGuestRegistrations(f.payload({ ...draft, categoryIds: selected }), []);
assert.deepEqual(retry.registrations.map((registration) => registration.ticketCode), result.registrations.map((registration) => registration.ticketCode));
assert.equal(f.state().submissions.length, 1);
assert.equal(f.state().athletes.length, 1);
await assert.rejects(f.service.createGuestRegistrations(f.payload({ ...draft, categoryIds: ['category-6'] }), []), /đã đăng ký một hạng đấu/);

// Gateway payment confirms only its discipline; repeated callbacks do not create more entries.
const source = f.state().registrations[0];
const payment = await f.prisma.paymentTransaction.create({ data: { registrationId: source.id, provider: 'BANK_QR', status: 'PENDING' } });
await f.payments.markPaid(payment.id, 'test', {});
await f.payments.markPaid(payment.id, 'test', {});
assert.equal(f.state().registrations[0].paymentStatus, 'PAID');
assert.equal(f.state().registrations[0].status, 'CONFIRMED');
assert.ok(f.state().registrations.slice(1).every((registration) => registration.paymentStatus === 'PENDING' && registration.status === 'SUBMITTED'));
assert.equal(f.state().entries.length, 1);
assert.equal(f.state().statusHistory.length, 1);
assert.equal(f.state().paymentHistory.length, 1);

// Later additions receive their own fee; a CMS payment affects only the selected discipline.
const later = fixture();
await later.service.createGuestRegistrations(later.payload({ ...later.athlete, categoryId: 'category-0' }), later.files);
const extra = await later.service.createGuestRegistrations(later.payload({ ...await later.reuse(), categoryIds: ['category-4'] }), []);
assert.equal(extra.registrations[0].feeAmount, 100000);
assert.equal(extra.registrations[0].paymentStatus, 'PENDING');
const manuallyPaid = await later.service.updateRegistrationPaymentStatus(extra.registrations[0].id, 'PAID', 'Manual payment', 'TEST');
assert.equal(manuallyPaid.status, 'CONFIRMED');
assert.equal(later.state().registrations[0].status, 'SUBMITTED');
assert.equal(later.state().registrations[0].paymentStatus, 'PENDING');
assert.equal(later.state().registrations[1].paymentStatus, 'PAID');
const afterPayment = await later.service.createGuestRegistrations(later.payload({ ...await later.reuse(), categoryIds: ['category-5'] }), []);
assert.equal(afterPayment.registrations[0].feeAmount, 100000);
assert.equal(afterPayment.registrations[0].status, 'SUBMITTED');
assert.equal(afterPayment.registrations[0].paymentStatus, 'PENDING');

// Invalid payloads do not leave partial athletes or registrations.
for (const categoryIds of [[], ['invalid'], ['category-0', 'category-0'], ['category-0', 'category-6'], ['category-3', 'category-7'], 'category-0']) {
  const invalid = fixture();
  await assert.rejects(invalid.service.createGuestRegistrations(invalid.payload({ ...invalid.athlete, categoryIds }), invalid.files));
  assert.equal(invalid.state().registrations.length, 0);
  assert.equal(invalid.state().athletes.length, 0);
}
const overweight = fixture();
await overweight.service.createGuestRegistrations(overweight.payload({ ...overweight.athlete, weight: 80, categoryIds: selected }), overweight.files);
assert.equal(overweight.state().registrations.length, selected.length, 'Category maximum weight is informational');

// Free events confirm every discipline without collecting a fee.
const free = fixture('FREE');
const freeResult = await free.service.createGuestRegistrations(free.payload({ ...free.athlete, categoryIds: selected }), free.files);
assert.ok(freeResult.registrations.every((registration) => registration.status === 'CONFIRMED' && registration.feeAmount === 0 && registration.paymentStatus === 'NOT_REQUIRED'));
assert.equal(free.state().entries.length, 4);

// Existing PDF documents are approved during profile reuse when OCR is disabled, without another upload.
for (const ocrEnabled of [false, true]) {
  const reused = fixture('FREE', ocrEnabled);
  const pdfFiles = reused.files.map((file) => file.fieldname.endsWith('_avatar') ? file : {
    ...file, mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n%%EOF'), size: 13,
  });
  await reused.service.createGuestRegistrations(reused.payload({ ...reused.athlete, categoryId: 'category-0' }), pdfFiles);
  const documents = reused.state().athletes[0].media.filter((media) => media.type !== 'AVATAR');
  documents.forEach((document) => {
    document.verificationStatus = 'PENDING';
    document.verifiedAt = null;
    document.verifiedBy = null;
  });
  const retried = await reused.service.createGuestRegistrations(reused.payload({ ...await reused.reuse(), categoryId: 'category-0' }), []);
  assert.equal(retried.registrations[0].existing, true);
  assert.ok(documents.every((document) => document.verificationStatus === (ocrEnabled ? 'PENDING' : 'VERIFIED')), 'Reuse retries also honor the OCR setting');
  const next = await reused.service.createGuestRegistrations(reused.payload({ ...await reused.reuse(), categoryId: 'category-4' }), []);
  assert.equal(next.registrations[0].status, ocrEnabled ? 'SUBMITTED' : 'CONFIRMED');
  assert.ok(documents.every((document) => document.verificationStatus === (ocrEnabled ? 'PENDING' : 'VERIFIED')));
  if (!ocrEnabled) assert.ok(documents.every((document) => document.verifiedBy === 'SYSTEM:OCR_DISABLED' && document.verifiedAt instanceof Date));
  assert.deepEqual(reused.stats(), { uploads: 3, identityChecks: 1 });
}

// Retrying an already registered category must persist newly supplied missing files.
const legacy = fixture('FREE');
const legacyInitial = await legacy.service.createGuestRegistrations(legacy.payload({ ...legacy.athlete, categoryId: 'category-0' }), legacy.files);
legacy.state().athletes[0].media = legacy.state().athletes[0].media.filter((item) => item.type === 'CCCD_FRONT');
const legacyLookup = await legacy.service.lookupAthlete({ eventId: 'event', ...legacy.athlete });
assert.equal(legacyLookup.athlete.hasAvatar, false);
assert.equal(legacyLookup.athlete.hasIdentity, false);
const legacyReuse = await legacy.reuse();
await assert.rejects(legacy.service.createGuestRegistrations(legacy.payload({ ...legacyReuse, categoryId: 'category-0' }), []), /ảnh|CCCD|giấy tờ/);
const replacementFiles = legacy.files.map(({ storageKey: _previousStorageKey, ...file }) => ({ ...file }));
const legacyRetry = await legacy.service.createGuestRegistrations(legacy.payload({ ...legacyReuse, categoryId: 'category-0' }), replacementFiles);
assert.equal(legacyRetry.registrations[0].existing, true);
assert.equal(legacyRetry.registrations[0].ticketCode, legacyInitial.registrations[0].ticketCode);
assert.equal(legacy.state().registrations.length, 1);
assert.equal(legacy.state().athletes.length, 1);
assert.equal(legacy.state().submissions.length, 1, 'Repair retries do not create another submission or fee');
assert.deepEqual(legacy.state().athletes[0].media.map((item) => item.type).sort(), ['AVATAR', 'CCCD_BACK', 'CCCD_FRONT']);
assert.ok(legacy.state().athletes[0].media.every((item) => item.storageKey && item.size > 0));
const legacyFixedLookup = await legacy.service.lookupAthlete({ eventId: 'event', ...legacy.athlete });
assert.equal(legacyFixedLookup.athlete.hasAvatar, true);
assert.equal(legacyFixedLookup.athlete.hasIdentity, true);
assert.deepEqual(legacy.stats(), { uploads: 6, identityChecks: 1 });

const partialIdentity = fixture('FREE');
const partialInitial = await partialIdentity.service.createGuestRegistrations(partialIdentity.payload({ ...partialIdentity.athlete,
  categoryId: 'category-0' }), partialIdentity.files);
partialIdentity.state().athletes[0].media = partialIdentity.state().athletes[0].media.filter((item) => item.type !== 'CCCD_FRONT');
const retainedBack = partialIdentity.state().athletes[0].media.find((item) => item.type === 'CCCD_BACK').storageKey;
const { storageKey: _frontStorageKey, ...newFront } = partialIdentity.files.find((item) => item.fieldname.endsWith('_cccdFront'));
const partialRetry = await partialIdentity.service.createGuestRegistrations(partialIdentity.payload({ ...await partialIdentity.reuse(),
  categoryId: 'category-0' }), [{ ...newFront }]);
assert.equal(partialRetry.registrations[0].ticketCode, partialInitial.registrations[0].ticketCode);
assert.equal(partialIdentity.state().athletes[0].media.find((item) => item.type === 'CCCD_BACK').storageKey, retainedBack,
  'Repair only replaces the supplied front image and reuses the existing back image');
assert.equal(partialIdentity.state().athletes[0].media.length, 3);
assert.deepEqual(partialIdentity.stats(), { uploads: 4, identityChecks: 1 });

// Metadata-only legacy media must be reported missing and cannot be reused without real uploads.
for (const invalidate of [
  (media) => { media.forEach((item) => { item.storageKey = null; }); },
  (media) => { media.forEach((item) => { item.size = 0; }); },
  (media) => { media.find((item) => item.type === 'AVATAR').mimeType = 'application/pdf'; },
]) {
  const f = fixture('FREE');
  await f.service.createGuestRegistrations(f.payload({ ...f.athlete, categoryId: 'category-0' }), f.files);
  invalidate(f.state().athletes[0].media);
  const lookup = await f.service.lookupAthlete({ eventId: 'event', ...f.athlete });
  assert.equal(lookup.athlete.hasAvatar, false);
  await assert.rejects(f.service.createGuestRegistrations(f.payload({ ...await f.reuse(), categoryId: 'category-4' }), []), /ảnh|CCCD|giấy tờ/);
  assert.equal(f.state().registrations.length, 1);
}

// Group submissions map category tickets to athletes and charge all eight discipline registrations.
const group = fixture();
const groupPayload = JSON.parse(group.payload({ ...group.athlete, categoryIds: selected }));
groupPayload.type = 'GROUP';
groupPayload.organizationName = 'Test Club';
groupPayload.athletes.push({ ...group.athlete, fullName: 'Second Athlete', documentNumber: '123456789013', categoryIds: selected.slice(0, 2) });
const groupFiles = [0, 1].flatMap((index) => group.files.map((file) => ({ ...file, fieldname: file.fieldname.replace('athlete_0_', `athlete_${index}_`) })));
const groupResult = await group.service.createGuestRegistrations(JSON.stringify(groupPayload), groupFiles);
assert.equal(groupResult.registrations.length, 6);
assert.equal(groupResult.registrations.filter((registration) => registration.athleteIndex === 0).length, 4);
assert.equal(groupResult.registrations.filter((registration) => registration.athleteIndex === 1).length, 2);
assert.equal(groupResult.registrations.reduce((sum, registration) => sum + registration.feeAmount, 0), 600000);
assert.equal(group.state().athletes.length, 2);

// Unpaid expiry cancels three unpaid disciplines while preserving the paid discipline.
const expired = fixture();
await expired.service.createGuestRegistrations(expired.payload({ ...expired.athlete, categoryIds: selected }), expired.files);
const paidBeforeExpiry = await expired.prisma.paymentTransaction.create({ data: {
  registrationId: expired.state().registrations[0].id, provider: 'BANK_QR', status: 'PENDING',
} });
await expired.payments.markPaid(paidBeforeExpiry.id, 'test-expiry', {});
expired.state().registrations.forEach((registration) => { registration.createdAt = new Date('2020-01-01'); });
assert.equal(await expired.payments.expireUnpaidRegistrations(), 3);
assert.equal(expired.state().registrations[0].status, 'CONFIRMED');
assert.equal(expired.state().registrations[0].paymentStatus, 'PAID');
assert.ok(expired.state().registrations.slice(1).every((registration) => registration.status === 'CANCELLED' && registration.paymentStatus === 'FAILED'));
// Pair registration: two individual dossiers, one payer and one team entry.
const pairFixture = fixture();
const pairPayload = JSON.parse(pairFixture.payload({ ...pairFixture.athlete, categoryIds: ['category-1'] }));
pairPayload.athletes.push({ ...pairFixture.athlete, fullName: 'Partner Athlete', documentNumber: '123456789013', categoryIds: [] });
pairPayload.pairs = [{ categoryId: 'category-1', athleteIndex: 0, partnerIndex: 1 }];
const pairFiles = [0, 1].flatMap((index) => pairFixture.files.map((file) => ({ ...file, fieldname: file.fieldname.replace('athlete_0_', `athlete_${index}_`) })));
const pairResult = await pairFixture.service.createGuestRegistrations(JSON.stringify(pairPayload), pairFiles);
assert.equal(pairResult.registrations.length, 2);
assert.equal(pairResult.registrations.reduce((sum, row) => sum + row.feeAmount, 0), 100000);
assert.equal(pairResult.registrations[1].paymentStatus, 'NOT_REQUIRED');
assert.equal(pairFixture.state().teams[0].members.length, 2);
assert.equal(pairFixture.state().entries[0].type, 'TEAM');
assert.equal(pairFixture.state().entries[0].status, 'WITHDRAWN');
assert.ok(!pairFixture.state().entries[0].athleteId);
await pairFixture.service.updateRegistrationPaymentStatus(pairResult.registrations[0].id, 'PAID', 'Pair payment', 'TEST');
assert.equal(pairFixture.state().entries[0].status, 'VERIFIED');
assert.ok(pairFixture.state().emails.some((job) => job.code === pairFixture.state().submissions[0].referenceCode), 'both passes are queued after the pair is approved');
assert.equal(pairFixture.state().entries.length, 1);
await pairFixture.service.updateRegistrationStatus(pairResult.registrations[1].id, 'REJECTED', 'Partner rejected', 'TEST');
assert.equal(pairFixture.state().entries[0].status, 'WITHDRAWN');
await pairFixture.service.updateRegistrationStatus(pairResult.registrations[1].id, 'CONFIRMED', 'Partner approved', 'TEST');
assert.equal(pairFixture.state().entries[0].status, 'VERIFIED');
await pairFixture.service.updateRegistrationPaymentStatus(pairResult.registrations[0].id, 'FAILED', 'Payment revoked', 'TEST');
assert.equal(pairFixture.state().entries[0].status, 'WITHDRAWN');
for (const pairs of [[], [{ categoryId: 'category-1', athleteIndex: 0, partnerIndex: 0 }],
  [{ categoryId: 'category-1', athleteIndex: 0, partnerIndex: 1 }, { categoryId: 'category-1', athleteIndex: 1, partnerIndex: 0 }]]) {
  const invalid = fixture();
  await assert.rejects(invalid.service.createGuestRegistrations(JSON.stringify({ ...pairPayload, pairs }), pairFiles));
  assert.equal(invalid.state().registrations.length, 0);
}
// A previously saved partner is linked without creating another athlete or fee.
const reused = fixture('FREE');
await reused.service.createGuestRegistrations(reused.payload({ ...reused.athlete, categoryIds: ['category-0'] }), reused.files);
const saved = await reused.reuse();
const reusedResult = await reused.service.createGuestRegistrations(JSON.stringify({
  ...pairPayload, athletes: [{ ...pairPayload.athletes[1], categoryIds: ['category-1'] }, { ...saved, categoryIds: [] }],
}), reused.files);
assert.equal(reused.state().athletes.length, 2);
assert.equal(reusedResult.registrations[1].athleteId, reused.state().athletes[0].id);
assert.equal(reused.state().entries.find((entry) => entry.type === 'TEAM').status, 'VERIFIED');
// Separate partners for DUO and SHOW: only the declarant pays for each content.
const separate = fixture();
const separatePayload = { ...pairPayload, athletes: [
  { ...separate.athlete, categoryIds: ['category-1', 'category-2'] },
  { ...separate.athlete, fullName: 'Duo Partner', documentNumber: '123456789013', categoryIds: [] },
  { ...separate.athlete, fullName: 'Show Partner', documentNumber: '123456789014', categoryIds: [] },
], pairs: [{ categoryId: 'category-1', athleteIndex: 0, partnerIndex: 1 }, { categoryId: 'category-2', athleteIndex: 0, partnerIndex: 2 }] };
const separateFiles = [0, 1, 2].flatMap((index) => separate.files.map((file) => ({ ...file, fieldname: file.fieldname.replace('athlete_0_', `athlete_${index}_`) })));
const separateResult = await separate.service.createGuestRegistrations(JSON.stringify(separatePayload), separateFiles);
assert.equal(separateResult.registrations.length, 4);
assert.equal(separateResult.registrations.reduce((sum, row) => sum + row.feeAmount, 0), 200000);
assert.equal(separate.state().teams.length, 2);
assert.ok(separateResult.registrations.filter((row) => row.athleteIndex !== 0).every((row) => row.feeAmount === 0));
console.log('PASS: individual discipline fees, saved profiles, retries, validation, payments, expiry; DUO pair, single payer, approval/withdrawal and saved partner reuse.');
