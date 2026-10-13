// Run from the repository root after npm run build:backend.
const assert = require('node:assert/strict');
const { validate } = require('class-validator');
const { ParticipantsService } = require('../../apps/backend/dist/src/participants/participants.service');
const { ParticipantRegisterDto, UpdateAccountTypesDto } = require('../../apps/backend/dist/src/participants/dto/participant.dto');
const { AthleteIdentityService } = require('../../apps/backend/dist/src/athletes/athlete-identity.service');

process.env.SETTINGS_ENCRYPTION_KEY = 'participant-registration-test-key-only-123456';
const input = {
  email: 'PERSON@example.invalid', password: 'test-password-123', displayName: 'Test Athlete',
  gender: 'MALE', birthDate: '2000-01-01', countryId: 'country-vn', phone: '0901234567',
  identityType: 'CCCD', documentNumber: '012345678901',
};

function fixture({ matches = [], duplicate = false } = {}) {
  const identity = new AthleteIdentityService();
  let stored;
  const transaction = {
    $queryRaw: async () => [],
    athlete: { findMany: async () => matches },
    participantAccount: {
      findUnique: async ({ where }) => duplicate && where.documentHash ? { id: 'existing-account' } : null,
      create: async ({ data }) => {
        stored = { id: 'new-account', createdAt: new Date(), athlete: null, media: [], isActive: true, ...data };
        return { id: stored.id, email: data.email, displayName: data.displayName };
      },
    },
  };
  const prisma = {
    $transaction: async (callback) => callback(transaction),
    participantAccount: {
      findUnique: async ({ where, select }) => where.id || (stored && where.email === stored.email)
        ? select ? Object.fromEntries(Object.keys(select).map((key) => [key, stored[key]])) : stored
        : null,
      update: async ({ data }) => { Object.assign(stored, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))); },
    },
    country: { findUnique: async () => ({ id: input.countryId }), findUniqueOrThrow: async () => ({ id: input.countryId, name: 'Vietnam', code: 'VIE' }) },
  };
  const service = new ParticipantsService(prisma, {}, { sign: () => 'test-token' }, {}, {}, {}, {}, identity);
  return { service, identity, stored: () => stored };
}

async function main() {
  for (const invalid of [{ identityType: undefined }, { documentNumber: undefined }, { identityType: 'OTHER' }, { accountTypes: [] }, { accountTypes: ['FEDERATION'] }, { accountTypes: ['ATHLETE', 'ATHLETE'] }, { accountTypes: ['REFEREE', 'COACH'] }]) {
    const errors = await validate(Object.assign(new ParticipantRegisterDto(), input, invalid));
    assert(errors.length > 0, 'Required identity fields must be validated by the API');
  }
  for (const invalid of [{ documentNumber: '   ' }, { documentNumber: '123' }, { identityType: 'PASSPORT', documentNumber: '!!!!!!!' }]) {
    await assert.rejects(fixture().service.register({ ...input, ...invalid }), (error) => error.getStatus() === 400);
  }
  const fresh = fixture();
  await fresh.service.register(input);
  assert.equal(fresh.stored().athlete, null, 'Account registration must not create an athlete');
  assert.equal(fresh.stored().email, 'person@example.invalid');
  assert.notEqual(fresh.stored().documentEncrypted, input.documentNumber);
  assert.equal(fresh.identity.decrypt(fresh.stored().documentEncrypted, 'CCCD'), input.documentNumber);
  const profile = await fresh.service.getProfile('new-account');
  assert.equal(profile.hasAthleteProfile, false);
  assert.equal(profile.athlete.fullName, input.displayName);
  assert(!('documentHash' in profile) && !('documentEncrypted' in profile));
  await fresh.service.updateProfile('new-account', { displayName: 'Updated Name' });
  assert.equal(fresh.stored().displayName, 'Updated Name');
  assert.equal(fresh.stored().athlete, null);
  await assert.rejects(fresh.service.getOwnMedia('new-account', 'AVATAR'), (error) => error.getStatus() === 404);

  const athlete = {
    id: 'old-athlete', fullName: input.displayName, birthDate: new Date(input.birthDate),
    gender: 'FEMALE', countryId: input.countryId, federationId: null, phone: '0987654321', weight: 60,
  };
  const existing = fixture({ matches: [athlete] });
  await existing.service.register(input);
  assert.deepEqual(existing.stored().athlete, { connect: { id: athlete.id } });
  assert.equal(existing.stored().gender, athlete.gender);
  assert.equal(existing.stored().phone, athlete.phone);
  assert.equal(existing.stored().weight, athlete.weight);
  for (const options of [
    { duplicate: true },
    { matches: [{ ...athlete, participantAccountId: 'another-account' }] },
    { matches: [athlete, { ...athlete, id: 'duplicate-athlete' }] },
    { matches: [{ ...athlete, fullName: 'Other Person' }] },
    { matches: [{ ...athlete, birthDate: new Date('1999-01-01') }] },
  ]) {
    await assert.rejects(fixture(options).service.register(input), (error) => error.getStatus() === 409);
  }
  const passport = fixture();
  await passport.service.register({ ...input, identityType: 'PASSPORT', documentNumber: 'ab-12345' });
  assert.equal(passport.identity.decrypt(passport.stored().documentEncrypted, 'PASSPORT'), 'AB12345');
  assert.equal(passport.stored().athlete, null);
  const roles = ['ATHLETE', 'REFEREE', 'COACH', 'TEAM_LEADER', 'MEDICAL_STAFF'];
  const account = fixture();
  await account.service.register({ ...input, accountTypes: ['MEDICAL_STAFF'] });
  assert.deepEqual((await account.service.getProfile('new-account')).accountTypes, ['MEDICAL_STAFF']);
  const loggedIn = await account.service.login({ email: input.email, password: input.password });
  assert.deepEqual(loggedIn.account.accountTypes, ['MEDICAL_STAFF']);
  await account.service.updateAccountTypes('new-account', ['REFEREE']);
  assert.deepEqual(account.stored().accountTypes, ['REFEREE']);
  assert.equal(account.stored().accountType, 'REFEREE');
  await assert.rejects(account.service.register({ ...input, accountTypes: roles }), (error) => error.getStatus() === 400);
  await assert.rejects(account.service.updateAccountTypes('new-account', ['REFEREE', 'COACH']), (error) => error.getStatus() === 400);
  assert.deepEqual(account.stored().accountTypes, ['REFEREE']);
  for (const accountTypes of [[], ['REFEREE', 'COACH']]) {
    assert((await validate(Object.assign(new UpdateAccountTypesDto(), { accountTypes }))).length > 0);
  }
  for (const role of roles) {
    const single = fixture();
    await single.service.register({ ...input, accountTypes: [role] });
    assert.deepEqual(single.stored().accountTypes, [role]);
    assert.equal(single.stored().athlete, null);
  }
  console.log('Passed: required identity, account-only registration/profile edits, encrypted CCCD/passport, existing athlete linking/sync and duplicate/ownership conflicts.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
