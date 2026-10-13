// Run after npm run build:backend. No database, storage, OCR or email services.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
const { ParticipantsService } = require('./dist/src/participants/participants.service.js');
const { EventParticipationsService } = require('./dist/src/participants/event-participations.service.js');
const { JwtService } = require('@nestjs/jwt');

const validMedia = (identityType = 'CCCD', verificationStatus = 'VERIFIED') => [
  { type: 'AVATAR', storageKey: 'avatars/portrait.png', mimeType: 'image/png', size: 100, verificationStatus: null },
  ...(identityType === 'CCCD' ? ['CCCD_FRONT', 'CCCD_BACK'] : ['PASSPORT']).map((type) => ({
    type, storageKey: `documents/${type}.pdf`, mimeType: 'application/pdf', size: 100, verificationStatus,
  })),
];
const category = { id: 'category', name: 'Category', sportId: 'sport', discipline: 'FIGHTING', uniform: null,
  gender: 'MALE', minAge: null, maxAge: null, minWeight: null, maxWeight: null, maxEntriesPerCountry: null, sport: {} };
const event = { id: 'event', isPublished: true, registrationEnabled: true, startDate: new Date('2035-01-01'),
  registrationOpenAt: null, registrationCloseAt: null, ageLimitMode: 'UNRESTRICTED',
  allowIndependentAthletes: true, categories: [category], participatingFederations: [],
  paymentMode: 'FREE', registrationFee: 0, registrationCurrency: 'VND' };
const draft = { fullName: 'Test Athlete', birthDate: '2000-01-01', gender: 'MALE', countryId: 'VIE',
  identityType: 'CCCD', documentNumber: '123456789012', phone: '0901234567', categoryId: category.id };
const account = { id: 'account', displayName: 'Test Account', email: 'test@example.invalid', phone: draft.phone,
  isActive: true, verificationStatus: 'VERIFIED', accountTypes: ['ATHLETE'] };
const input = { eventId: event.id, categoryId: category.id, athleteId: 'athlete' };

function athleteFixture(media = validMedia(), settings = true) {
  const athlete = { id: 'athlete', fullName: draft.fullName, gender: draft.gender, birthDate: new Date(draft.birthDate),
    countryId: draft.countryId, federationId: null, phone: draft.phone, media, publicRegistrations: [], country: { name: 'Vietnam' } };
  const state = { writes: 0, registrations: [], entries: [], history: [] };
  const hydrate = (registration) => ({ ...registration, athlete, event, category, submission: null });
  const prisma = {
    event: { findUnique: async () => event },
    country: { findMany: async () => [{ id: 'VIE' }], findUnique: async () => ({ id: 'VIE' }) },
    federation: { findMany: async () => [{ id: 'unit', countryId: 'VIE' }], findUnique: async () => ({ id: 'unit', countryId: 'VIE' }) },
    participantAccount: { findUnique: async () => account },
    participantMediaUpload: { findMany: async () => [] },
    athlete: { findUnique: async () => athlete, findUniqueOrThrow: async () => athlete, update: async () => athlete },
    athleteMedia: { findMany: async () => media, updateMany: async () => {
      for (const item of media) if (item.type !== 'AVATAR') item.verificationStatus = 'VERIFIED';
      return { count: media.length - 1 };
    } },
    eventRegistration: {
      findMany: async () => [], count: async () => 0,
      findUnique: async () => hydrate({ id: 'registration', athleteId: athlete.id, eventId: event.id,
        categoryId: category.id, status: 'SUBMITTED', paymentStatus: 'PAID', ticketCode: 'SD-TEST' }),
      create: async ({ data }) => { state.writes += 1; const record = { id: 'registration', ...data }; state.registrations.push(record); return record; },
      findUniqueOrThrow: async () => hydrate(state.registrations[0]),
      updateMany: async () => { state.writes += 1; return { count: 1 }; },
      update: async ({ data }) => { state.writes += 1; return hydrate({ id: 'registration', ...data }); },
    },
    competitionEntry: { upsert: async ({ create }) => state.entries.push(create), updateMany: async () => ({ count: 0 }) },
    registrationStatusHistory: { create: async ({ data }) => state.history.push(data) },
    paymentStatusHistory: { create: async () => {} },
    $queryRaw: async () => [],
  };
  prisma.$transaction = async (operation) => operation(prisma);
  const jwt = new JwtService({ secret: 'registration-required-media-test' });
  const identity = { lock: async () => {}, normalize: () => ({ documentHash: draft.documentNumber }),
    assertNew: async () => ({}), findDocumentMatches: async () => [athlete] };
  const service = new ParticipantsService(prisma, {}, jwt, {}, { enqueueTicket: async () => {} },
    { get: async () => ({ values: { identityOcrEnabled: settings } }) }, { notifyRegistration: async () => {} }, identity);
  const profile = { ...account, athlete };
  service.getAthleteProfile = async () => profile;
  service.getProfile = async () => profile;
  const payload = (participant = draft) => JSON.stringify({ eventId: event.id, contactName: account.displayName,
    contactEmail: account.email, contactPhone: account.phone, organizationName: 'Test Unit', athletes: [participant] });
  const reuse = () => ({ ...draft, profileConfirmed: true, reuseToken: jwt.sign({ purpose: 'reuse-athlete',
    athleteId: athlete.id, eventId: event.id, documentHash: draft.documentNumber, phone: draft.phone }) });
  return { service, prisma, athlete, state, payload, reuse };
}

// Links and media metadata without an actual stored file must never satisfy registration requirements.
for (const media of [
  [], validMedia().filter((item) => item.type !== 'AVATAR'),
  validMedia().filter((item) => item.type !== 'CCCD_BACK'),
  validMedia().map((item) => ({ ...item, storageKey: null })),
  validMedia().map((item) => ({ ...item, size: 0 })),
  validMedia().map((item) => item.type === 'AVATAR' ? { ...item, mimeType: 'application/pdf' } : item),
]) {
  const f = athleteFixture(media);
  f.athlete.photoUrl = 'https://example.invalid/a-link-is-not-an-upload.png';
  await assert.rejects(f.service.createRegistration(account.id, input), /ảnh|CCCD|hộ chiếu|giấy tờ/);
  assert.equal(f.state.writes, 0, 'Self-registration must reject incomplete media before writing');
  await assert.rejects(f.service.createGuestRegistrations(f.payload(f.reuse()), []), /ảnh|CCCD|hộ chiếu|giấy tờ/);
  assert.equal(f.state.writes, 0, 'Profile reuse must check actual uploaded files');
}
for (const identityType of ['CCCD', 'PASSPORT']) {
  const f = athleteFixture(validMedia(identityType));
  const result = await f.service.createRegistration(account.id, input);
  assert.equal(result.status, 'CONFIRMED');
  assert.equal(f.state.registrations.length, 1);
}

// Every represented athlete needs files; a coach/team leader submitting a roster is the contact.
for (const submittingRole of [undefined, 'COACH', 'TEAM_LEADER']) {
  const f = athleteFixture();
  f.prisma.participantAccount.findUnique = async () => ({ ...account, accountTypes: [submittingRole || 'ATHLETE'],
    federation: { id: 'unit', name: 'Test Unit', countryId: 'VIE' } });
  await assert.rejects(f.service.createGuestRegistrations(f.payload(), [], submittingRole ? account.id : undefined,
    submittingRole === 'TEAM_LEADER'), /ảnh đại diện/);
  assert.equal(f.state.writes, 0);
}

// CMS and payment confirmation must enforce the same files, including legacy records.
for (const media of [[], validMedia().filter((item) => item.type !== 'AVATAR'),
  validMedia().map((item) => item.type === 'CCCD_BACK' ? { ...item, storageKey: null } : item)]) {
  const f = athleteFixture(media);
  const eligibility = await f.service.checkAdminRegistrationEligibility(input);
  assert.equal(eligibility.eligible, false, 'CMS may not bypass mandatory uploads');
  await assert.rejects(f.service.createAdminRegistration(input, 'cms@example.invalid'), /ảnh|CCCD|hộ chiếu|giấy tờ/);
  await assert.rejects(f.service.updateRegistrationStatus('registration', 'CONFIRMED', 'Reviewed', 'cms@example.invalid'), /ảnh|CCCD|hộ chiếu|giấy tờ/);
  assert.equal(await f.service.finalizePaidRegistration('registration'), null, 'Payment alone cannot confirm a profile missing required files');
  assert.equal(f.state.writes, 0);
}
const newAdmin = athleteFixture();
const newAdminInput = { eventId: event.id, categoryId: category.id, athlete: { ...draft,
  firstName: 'Test', lastName: 'Athlete', email: account.email } };
assert.equal((await newAdmin.service.checkAdminRegistrationEligibility(newAdminInput)).eligible, false);
await assert.rejects(newAdmin.service.createAdminRegistration(newAdminInput), /ảnh|CCCD|hộ chiếu|giấy tờ/);

function participationFixture(role = 'COACH', identityType = 'CCCD', media = validMedia(identityType)) {
  let pending = media.map((item, index) => ({ ...item, id: `upload-${index}`, expiresAt: new Date('2035-01-01'),
    tokenHash: createHash('sha256').update(`token-${index}`).digest('hex') }));
  let record = { id: 'participation', role, identityType, documentEncrypted: 'encrypted', status: 'SUBMITTED', media };
  const state = { writes: 0, emails: 0 };
  const prisma = {
    event: { findUnique: async () => event }, participantAccount: { findUnique: async () => account },
    federation: { findUnique: async () => ({ id: 'unit' }) },
    participantMediaUpload: { findMany: async () => pending, deleteMany: async () => {
      const count = pending.length; pending = []; return { count };
    } },
    eventParticipation: {
      findUnique: async () => record,
      create: async ({ data }) => { state.writes += 1; record = { id: record.id, ...data, media: data.media.create }; return record; },
      update: async ({ data }) => { state.writes += 1; record = { ...record, ...data }; return record; },
    },
    eventParticipationMedia: { findMany: async () => record.media, updateMany: async () => ({ count: 0 }) },
    $queryRaw: async () => [],
  };
  prisma.$transaction = async (operation) => operation(prisma);
  const service = new EventParticipationsService(prisma, { enqueueTicket: async () => { state.emails += 1; } }, {},
    { normalize: () => ({ cccdEncrypted: 'encrypted', passportEncrypted: 'encrypted' }), decrypt: () => draft.documentNumber },
    { get: async () => ({ values: { identityOcrEnabled: false } }) });
  const keys = { AVATAR: 'avatar', CCCD_FRONT: 'cccdFront', CCCD_BACK: 'cccdBack', PASSPORT: 'passport' };
  const dto = { eventId: event.id, role, federationId: 'unit', identityType, documentNumber: draft.documentNumber,
    mediaUploads: Object.fromEntries(pending.map((item, index) => [keys[item.type], { id: item.id, token: `token-${index}` }])) };
  return { service, dto, state };
}
for (const role of ['COACH', 'TEAM_LEADER', 'REFEREE']) {
  for (const identityType of ['CCCD', 'PASSPORT']) {
    const f = participationFixture(role, identityType);
    const created = await f.service.create(f.dto, account.id);
    assert.equal(created.media.find((item) => item.type === 'AVATAR').mimeType, 'image/png');
    assert.ok(created.media.filter((item) => item.type !== 'AVATAR').every((item) => item.mimeType === 'application/pdf'
      && item.verificationStatus === 'VERIFIED'), 'PDF documents are verified when OCR is disabled');
    const confirmed = await f.service.updateStatus('participation', { status: 'CONFIRMED', reason: 'Reviewed' }, 'cms@example.invalid');
    assert.equal(confirmed.status, 'CONFIRMED', 'A complete non-athlete profile can still be approved');
    assert.equal(f.state.emails, 1);
    for (const key of Object.keys(f.dto.mediaUploads)) {
      const missing = participationFixture(role, identityType);
      delete missing.dto.mediaUploads[key];
      await assert.rejects(missing.service.create(missing.dto, account.id), /ảnh|giấy tờ/);
      assert.equal(missing.state.writes, 0);
    }
  }
}
for (const media of [[], validMedia().filter((item) => item.type !== 'AVATAR'),
  validMedia().filter((item) => item.type !== 'CCCD_BACK'),
  validMedia().map((item) => ({ ...item, storageKey: '' }))]) {
  const f = participationFixture('REFEREE', 'CCCD', media);
  await assert.rejects(f.service.updateStatus('participation', { status: 'CONFIRMED', reason: 'Reviewed' }, 'cms@example.invalid'), /ảnh|CCCD|hộ chiếu|giấy tờ/);
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.emails, 0, 'Incomplete participation must not issue a ticket');
}

console.log('PASS: actual avatar and identity files required for self, guest/assisted/team, reused, CMS, paid and non-athlete registrations.');
