// Run from the repository root after npm run build:backend. No external services.
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { ParticipantsService } = require('../../apps/backend/dist/src/participants/participants.service');
const { ParticipantAuthGuard } = require('../../apps/backend/dist/src/participants/participant-auth.guard');
const { AthleteIdentityService } = require('../../apps/backend/dist/src/athletes/athlete-identity.service');
const { IdentityOcrService } = require('../../apps/backend/dist/src/participants/identity-ocr.service');
const { Prisma } = require('@prisma/client');

process.env.SETTINGS_ENCRYPTION_KEY = 'participant-account-media-regression-key-123456';
const roles = ['ATHLETE', 'REFEREE', 'COACH', 'TEAM_LEADER', 'MEDICAL_STAFF'];
const documentTypes = ['CCCD_FRONT', 'CCCD_BACK', 'PASSPORT'];
const country = { id: 'country-vn', code: 'VIE', name: 'Vietnam' };
const file = (mimeType = 'image/png', label = 'first') => {
  const signature = mimeType === 'application/pdf' ? Buffer.from('%PDF-1.7\n')
    : mimeType === 'image/jpeg' ? Buffer.from([0xff, 0xd8, 0xff])
      : mimeType === 'image/webp' ? Buffer.from('RIFF0000WEBP')
        : Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const buffer = Buffer.concat([signature, Buffer.from(label)]);
  return { buffer, mimetype: mimeType, size: buffer.length, originalname: label };
};

// The fixture honors Prisma selects so private fields cannot accidentally pass
// the JSON assertions simply because the fixture omitted them.
function project(value, selection) {
  if (value === null || value === undefined || !selection) return value;
  if (Array.isArray(value)) return value.map((item) => project(item, selection));
  return Object.fromEntries(Object.entries(selection).filter(([, option]) => option).map(([key, option]) => {
    let child = value[key];
    if (option === true) return [key, child];
    if (Array.isArray(child) && option.where?.type) child = child.filter((item) => item.type === option.where.type);
    if (Array.isArray(child) && option.orderBy?.type) child = [...child].sort((a, b) => a.type.localeCompare(b.type));
    if (option.select) return [key, project(child, option.select)];
    if (option.include && child) return [key, { ...child, ...project(child, option.include) }];
    return [key, child];
  }));
}

function fixture({ role = 'REFEREE', identityType = 'CCCD', enabled = false, linked = false } = {}) {
  const identity = new AthleteIdentityService();
  const number = identityType === 'CCCD' ? '012345678901' : 'AB1234567';
  const keys = identity.normalize({ fullName: 'Media Owner', countryId: country.id, gender: 'MALE', identityType, documentNumber: number });
  const accounts = new Map();
  const athletes = new Map();
  const accountMedia = new Map();
  const athleteMedia = new Map();
  const files = new Map();
  const transactionScope = new AsyncLocalStorage();
  const state = { enabled, events: [], uploadCount: 0, ocrCalls: 0, athleteCreates: 0, athleteWrites: 0,
    identityWrites: 0, identityChecks: 0, failNextUpsert: false, inTransaction: false, ocrResult: null,
    duplicateAthletes: [], athleteIdentities: new Map() };
  const makeAccount = (id, displayName, extra = {}) => ({ id, displayName, email: `${id}@example.invalid`,
    password: 'private-password-hash', resetPasswordTokenHash: 'private-reset-hash', isActive: true,
    gender: 'MALE', birthDate: new Date('2000-01-01'), phone: '0901234567', countryId: country.id,
    federationId: null, weight: null, height: null, accountType: role, accountTypes: [role],
    verificationStatus: 'VERIFIED', representativePosition: null, identityType, documentHash: keys.documentHash,
    documentEncrypted: identityType === 'CCCD' ? keys.cccdEncrypted : keys.passportEncrypted,
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), athleteId: null, ...extra });
  accounts.set('owner', makeAccount('owner', 'Media Owner'));
  accounts.set('other', makeAccount('other', 'Other Owner', { identityType: 'CCCD', documentHash: 'other-hash' }));
  if (linked) {
    accounts.get('owner').athleteId = 'linked-athlete';
    athletes.set('linked-athlete', { id: 'linked-athlete', participantAccountId: 'owner', fullName: 'Media Owner',
      firstName: 'Owner', lastName: 'Media', email: 'owner@example.invalid', phone: '0901234567', gender: 'MALE',
      birthDate: new Date('2000-01-01'), countryId: country.id, federationId: null, photoUrl: null });
  }
  const allMedia = (store, ownerKey, ownerId) => [...store.values()].filter((item) => item[ownerKey] === ownerId);
  const hydrateAthlete = (record) => record ? { ...record, country, federation: null,
    media: allMedia(athleteMedia, 'athleteId', record.id) } : null;
  const hydrateAccount = (record) => record ? { ...record, media: allMedia(accountMedia, 'accountId', record.id),
    athlete: hydrateAthlete(athletes.get(record.athleteId)) } : null;
  const clean = (data) => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, value === Prisma.DbNull ? null : value]));
  const mediaModel = (store, ownerKey) => ({
    findUnique: async ({ where, select }) => {
      const key = where[`${ownerKey}_type`];
      return project(store.get(`${key[ownerKey]}:${key.type}`) || null, select);
    },
    upsert: async ({ where, create, update, select }) => {
      if (state.failNextUpsert) { state.failNextUpsert = false; throw new Error('Simulated database failure'); }
      const key = where[`${ownerKey}_type`];
      const id = `${key[ownerKey]}:${key.type}`;
      const existing = store.get(id);
      const record = existing ? { ...existing, ...clean(update), updatedAt: new Date() }
        : { id: `media-${id}`, verificationStatus: null, verificationNote: null, verifiedAt: null, verifiedBy: null,
          ocrStatus: 'NOT_REQUESTED', ocrProvider: null, ocrConfidence: null, ocrData: null,
          createdAt: new Date(), updatedAt: new Date(), ...clean(create) };
      store.set(id, record);
      return project(record, select);
    },
    update: async ({ where, data, select }) => {
      const key = where[`${ownerKey}_type`];
      const record = store.get(`${key[ownerKey]}:${key.type}`);
      assert(record, 'Updating media must require an existing owner/type record');
      Object.assign(record, clean(data), { updatedAt: new Date() });
      return project(record, select);
    },
  });
  const prisma = {
    participantAccount: {
      findUnique: async ({ where, select }) => project(hydrateAccount(accounts.get(where.id)
        || [...accounts.values()].find((item) => where.documentHash && item.documentHash === where.documentHash)), select),
      findFirst: async ({ where, select }) => project(hydrateAccount([...accounts.values()]
        .find((item) => item.documentHash === where.documentHash && item.id !== where.id.not)), select),
      update: async ({ where, data, select }) => { Object.assign(accounts.get(where.id), clean(data));
        return project(hydrateAccount(accounts.get(where.id)), select); },
    },
    athlete: {
      findMany: async () => [],
      create: async () => { state.athleteCreates += 1; throw new Error('Account media must never create an athlete'); },
      update: async ({ where, data }) => { state.athleteWrites += 1; Object.assign(athletes.get(where.id), clean(data));
        return hydrateAthlete(athletes.get(where.id)); },
    },
    participantAccountMedia: mediaModel(accountMedia, 'accountId'),
    athleteMedia: mediaModel(athleteMedia, 'athleteId'),
    athleteIdentity: { upsert: async ({ where, create, update }) => {
      state.identityWrites += 1;
      const previous = state.athleteIdentities.get(where.athleteId);
      state.athleteIdentities.set(where.athleteId, previous ? { ...previous, ...clean(update) } : clean(create));
    } },
    country: { findUnique: async () => country, findUniqueOrThrow: async () => country },
    federation: { findUnique: async () => null },
    $queryRaw: async (query, ...values) => { state.events.push({ kind: 'lock', sql: query.join('?'), values }); return []; },
  };
  let pendingTransaction = Promise.resolve();
  prisma.$transaction = (operation) => {
    const run = pendingTransaction.then(() => transactionScope.run({ active: true }, async () => {
      const snapshot = [accounts, athletes, accountMedia, athleteMedia, state.athleteIdentities]
        .map((map) => new Map([...map].map(([key, value]) => [key, structuredClone(value)])));
      state.inTransaction = true;
      try { const result = await operation(prisma); state.events.push({ kind: 'commit' }); return result; }
      catch (error) {
        [accounts, athletes, accountMedia, athleteMedia, state.athleteIdentities].forEach((map, index) => {
          map.clear(); for (const [key, value] of snapshot[index]) map.set(key, value);
        });
        state.events.push({ kind: 'rollback' }); throw error;
      } finally { state.inTransaction = false; transactionScope.getStore().active = false; }
    }));
    pendingTransaction = run.catch(() => {});
    return run;
  };
  const storage = {
    upload: async (buffer, mimeType, folder) => {
      const key = `local:${folder}/file-${++state.uploadCount}`;
      files.set(key, { buffer: Buffer.from(buffer), mimeType });
      state.events.push({ kind: 'upload', key }); return { key, size: buffer.length, mimeType };
    },
    read: async (key, variant) => { const stored = files.get(key); assert(stored, 'Only existing files may be read');
      state.events.push({ kind: 'read', key, variant }); return Buffer.from(stored.buffer); },
    deleteQuietly: async (key) => { if (!key) return; assert.equal(transactionScope.getStore()?.active || false, false,
      'Storage cleanup must run after its database transaction');
      state.events.push({ kind: 'delete', key }); files.delete(key); },
  };
  const settings = { get: async () => ({ values: { identityOcrEnabled: state.enabled }, configured: { identityOcrEnabled: false } }),
    integrationValues: async () => ({}) };
  const realOcr = new IdentityOcrService(settings);
  const ocr = { read: async (upload, type) => { state.ocrCalls += 1; return state.ocrResult || realOcr.read(upload, type); } };
  identity.lock = async () => { state.events.push({ kind: 'identity-lock' }); };
  identity.assertNew = async (_transaction, input, excludeId) => { state.identityChecks += 1;
    assert.equal(excludeId, accounts.get('owner').athleteId); return identity.normalize(input); };
  identity.findDocumentMatches = async (_transaction, input) => {
    const normalized = identity.normalize(input);
    return state.duplicateAthletes.filter((item) => item.documentHash === normalized.documentHash);
  };
  const service = new ParticipantsService(prisma, storage, {}, ocr, {}, settings, {}, identity);
  const media = (type, ownerId = 'owner') => accountMedia.get(`${ownerId}:${type}`);
  const linkedMedia = (type) => athleteMedia.get(`linked-athlete:${type}`);
  const guard = new ParticipantAuthGuard({ verifyAsync: async (token) => ({ sub: token, type: 'participant' }) }, prisma);
  const requestContext = (ownerId) => {
    const request = { headers: { authorization: `Bearer ${ownerId}` } };
    return { request, context: { switchToHttp: () => ({ getRequest: () => request }) } };
  };
  return { service, state, accounts, accountMedia, athleteMedia, files, identity, media, linkedMedia, number, guard, requestContext };
}

function assertSafeProfile(profile) {
  const json = JSON.stringify(profile);
  assert(!/"(?:storageKey|documentHash|documentEncrypted|password|resetPasswordTokenHash|cccdHash|passportHash|cccdEncrypted|passportEncrypted)":/.test(json),
    'Owner profile metadata must omit storage references, identity hashes/ciphers and credentials');
}

async function accountRolesAndFiles() {
  for (const role of roles) {
    for (const enabled of [false, true]) {
      const f = fixture({ role, enabled });
      const empty = await f.service.getProfile('owner');
      assert.equal(empty.hasAthleteProfile, false);
      assert.deepEqual(empty.media, []);
      assert.deepEqual(empty.athlete.media, []);
      assertSafeProfile(empty);
      for (const type of ['AVATAR', ...documentTypes]) {
        const upload = file(type === 'AVATAR' ? 'image/png' : 'application/pdf', `${role}-${type}`);
        const response = await f.service.upsertMedia('owner', type, upload);
        const stored = f.media(type);
        assert.equal(response.type, type);
        assert.equal(response.verificationStatus, type === 'AVATAR' ? null : enabled ? 'PENDING' : 'VERIFIED');
        assert.equal(stored.verificationStatus, response.verificationStatus);
        assert.equal(stored.ocrStatus, type === 'AVATAR' || !enabled ? 'NOT_REQUESTED' : 'FAILED');
        assert.equal(stored.verifiedBy, type === 'AVATAR' || enabled ? null : 'SYSTEM:OCR_DISABLED');
        assert.equal(stored.verifiedAt instanceof Date, type !== 'AVATAR' && !enabled);
        const read = await f.service.getOwnMedia('owner', type);
        assert.deepEqual(read.data, upload.buffer);
        assert.deepEqual(Object.keys(read).sort(), ['data', 'mimeType']);
        if (upload.mimetype === 'application/pdf') {
          assert.deepEqual((await f.service.getOwnMedia('owner', type, 'thumb')).data, upload.buffer);
          assert.equal(f.state.events.filter((item) => item.kind === 'read').at(-1).variant, undefined,
            'Image variants must never transform PDF document reads');
        }
        const previousKey = stored.storageKey;
        Object.assign(stored, { verificationStatus: 'REJECTED', verificationNote: 'Old rejection', verifiedBy: 'old-reviewer',
          ocrStatus: 'COMPLETED', ocrProvider: 'OLD_PROVIDER', ocrConfidence: 99, ocrData: { userConfirmed: true } });
        const replacement = file(type === 'AVATAR' ? 'image/jpeg' : 'application/pdf', `replacement-${type}`);
        await f.service.upsertMedia('owner', type, replacement);
        const current = f.media(type);
        assert.notEqual(current.storageKey, previousKey);
        assert.equal(f.files.has(previousKey), false);
        assert.equal(current.verificationStatus, type === 'AVATAR' ? null : enabled ? 'PENDING' : 'VERIFIED');
        assert.equal(current.ocrProvider, null);
        assert.equal(current.ocrConfidence, null);
        assert.equal(Boolean(current.ocrData?.userConfirmed), false);
        assert.notEqual(current.verificationNote, 'Old rejection');
        assert.deepEqual((await f.service.getOwnMedia('owner', type)).data, replacement.buffer);
      }
      const profile = await f.service.getProfile('owner');
      assert.equal(profile.hasAthleteProfile, false);
      assert.equal(profile.athlete.id, '');
      assert.equal(profile.media.length, 4);
      assert.deepEqual(profile.media, profile.athlete.media);
      assertSafeProfile(profile);
      assert.equal(f.state.athleteCreates, 0);
      assert.equal(f.state.athleteWrites, 0);
      assert.equal(f.athleteMedia.size, 0);
      assert.equal(f.state.ocrCalls, enabled ? 6 : 0);
      assert(f.state.events.some((item) => item.kind === 'lock' && item.sql.includes('ParticipantAccount')));
      assert(f.state.events.some((item) => item.kind === 'lock' && item.sql.includes('ParticipantAccountMedia')));
    }
  }
}

async function validationAndOwnership() {
  const f = fixture();
  const before = f.state.uploadCount;
  for (const [type, upload] of [
    ['OTHER', file()], ['AVATAR', file('application/pdf')], ['CCCD_FRONT', { ...file(), buffer: Buffer.from('invalid') }],
    ['PASSPORT', { ...file('application/pdf'), size: 0 }], ['PASSPORT', { ...file('application/pdf'), size: 8 * 1024 * 1024 + 1 }],
    ['AVATAR', { ...file(), buffer: undefined }], ['CCCD_FRONT', { ...file(), mimetype: 'image/svg+xml' }],
  ]) await assert.rejects(f.service.upsertMedia('owner', type, upload), (error) => error.getStatus() === 400);
  await assert.rejects(f.service.upsertMedia('owner', 'AVATAR'), (error) => error.getStatus() === 400);
  await assert.rejects(f.service.getOwnMedia('owner', 'OTHER'), (error) => error.getStatus() === 400);
  await assert.rejects(f.service.confirmIdentityOcr('owner', 'OTHER', {}), (error) => error.getStatus() === 400);
  assert.equal(f.state.uploadCount, before, 'Invalid files must not reach storage');
  await assert.rejects(f.service.getOwnMedia('owner', 'AVATAR'), (error) => error.getStatus() === 404);
  await assert.rejects(f.service.getProfile('missing'), (error) => error.getStatus() === 404);
  const ownerPhoto = file('image/png', 'private-owner-photo');
  await f.service.upsertMedia('owner', 'AVATAR', ownerPhoto);
  await assert.rejects(f.service.getOwnMedia('other', 'AVATAR'), (error) => error.getStatus() === 404);
  const otherPhoto = file('image/png', 'other-owner-photo');
  await f.service.upsertMedia('other', 'AVATAR', otherPhoto);
  assert.deepEqual((await f.service.getOwnMedia('owner', 'AVATAR')).data, ownerPhoto.buffer);
  assert.deepEqual((await f.service.getOwnMedia('other', 'AVATAR')).data, otherPhoto.buffer);
  const auth = f.requestContext('owner');
  assert.equal(await f.guard.canActivate(auth.context), true);
  assert.equal(auth.request.participant.id, 'owner');
  f.accounts.get('owner').isActive = false;
  await assert.rejects(f.guard.canActivate(f.requestContext('owner').context), (error) => error.getStatus() === 401);
  await assert.rejects(f.service.upsertMedia('owner', 'AVATAR', file()), (error) => error.getStatus() === 401);
  await assert.rejects(f.service.confirmIdentityOcr('owner', 'CCCD_FRONT', {}), (error) => error.getStatus() === 401);
  assert.deepEqual((await f.service.getOwnMedia('other', 'AVATAR')).data, otherPhoto.buffer);
}

async function replacementFailureAndConcurrency() {
  for (const linked of [false, true]) {
    const f = fixture({ linked });
    const original = file('image/png', 'original');
    await f.service.upsertMedia('owner', 'AVATAR', original);
    const previous = structuredClone(linked ? f.linkedMedia('AVATAR') : f.media('AVATAR'));
    f.state.failNextUpsert = true;
    await assert.rejects(f.service.upsertMedia('owner', 'AVATAR', file('image/png', 'failed-replacement')), /database failure/);
    assert.deepEqual(linked ? f.linkedMedia('AVATAR') : f.media('AVATAR'), previous);
    assert.equal(f.files.size, 1, 'Failed persistence must remove the new file and preserve the prior one');
    assert(f.files.has(previous.storageKey));
    assert.deepEqual((await f.service.getOwnMedia('owner', 'AVATAR')).data, original.buffer);
    await Promise.all([f.service.upsertMedia('owner', 'AVATAR', file('image/png', 'concurrent-first')),
      f.service.upsertMedia('owner', 'AVATAR', file('image/png', 'concurrent-second'))]);
    const winner = linked ? f.linkedMedia('AVATAR') : f.media('AVATAR');
    assert.equal(f.files.size, 1, 'Concurrent replacements may retain only their winning stored file');
    assert(f.files.has(winner.storageKey));
    assert.deepEqual((await f.service.getOwnMedia('owner', 'AVATAR')).data, file('image/png', 'concurrent-second').buffer);
    if (linked) {
      assert.equal(f.accountMedia.size, 0);
      assert.equal(f.accounts.get('owner').athleteId, 'linked-athlete');
      const profile = await f.service.getProfile('owner');
      assert.equal(profile.hasAthleteProfile, true);
      assert.deepEqual(profile.media, profile.athlete.media);
      assertSafeProfile(profile);
      assert.equal(profile.athlete.photoUrl, '/api/participant-auth/avatar/linked-athlete');
    }
  }
}

async function ocrConfirmation() {
  for (const identityType of ['CCCD', 'PASSPORT']) {
    const f = fixture({ identityType, enabled: true });
    const type = identityType === 'CCCD' ? 'CCCD_FRONT' : 'PASSPORT';
    f.state.ocrResult = { status: 'COMPLETED', provider: 'FPT_AI', confidence: 95,
      fields: { fullName: 'Recognized Name', documentNumber: f.number }, fieldConfidence: { fullName: 95 } };
    await f.service.upsertMedia('owner', type, file('image/png', 'ocr-success'));
    const original = structuredClone(f.accounts.get('owner'));
    await f.service.confirmIdentityOcr('owner', type, { fullName: 'Metadata Only', documentNumber: f.number, applyToProfile: false });
    assert.deepEqual(f.accounts.get('owner'), original, 'Metadata-only confirmation must not modify account identity or personal fields');
    assert.equal(f.media(type).ocrData.userConfirmed, true);
    assert.equal(f.media(type).ocrData.confirmedFields.fullName, 'Metadata Only');
    assert.equal(f.state.identityWrites, 0);
    await f.service.confirmIdentityOcr('owner', type, { fullName: 'Confirmed Owner', documentNumber: f.number,
      dateOfBirth: '2001-02-03', sex: 'Nữ', applyToProfile: true });
    const account = f.accounts.get('owner');
    assert.equal(account.displayName, 'Confirmed Owner');
    assert.equal(account.gender, 'FEMALE');
    assert.equal(account.birthDate.toISOString().slice(0, 10), '2001-02-03');
    assert.equal(account.documentHash, original.documentHash);
    assert.equal(f.identity.decrypt(account.documentEncrypted, identityType), f.number);
    assert.equal(account.athleteId, null);
    assert.equal(f.state.athleteCreates, 0);
    assert.equal(f.state.identityWrites, 0);
    const changedNumber = identityType === 'CCCD' ? '112345678901' : 'OTHER123';
    const beforeConflict = structuredClone(account);
    await assert.rejects(f.service.confirmIdentityOcr('owner', type, { documentNumber: changedNumber, fullName: 'Overwrite', applyToProfile: true }),
      (error) => error.getStatus() === 409);
    assert.deepEqual(f.accounts.get('owner'), beforeConflict);
    await assert.rejects(f.service.confirmIdentityOcr('owner', type, { documentNumber: '!!', applyToProfile: true }),
      (error) => error.getStatus() === 400);
    assertSafeProfile(await f.service.getProfile('owner'));
  }
  const f = fixture({ enabled: true });
  f.state.ocrResult = { status: 'COMPLETED', provider: 'FPT_AI', confidence: 90, fields: {}, fieldConfidence: {} };
  await f.service.upsertMedia('owner', 'PASSPORT', file());
  const alternateNumber = 'XY1234567';
  const alternate = f.identity.normalize({ fullName: 'Media Owner', gender: 'MALE', countryId: country.id,
    identityType: 'PASSPORT', documentNumber: alternateNumber });
  const primary = structuredClone(f.accounts.get('owner'));
  f.accounts.get('other').documentHash = alternate.documentHash;
  await assert.rejects(f.service.confirmIdentityOcr('owner', 'PASSPORT', { documentNumber: alternateNumber, applyToProfile: true }),
    (error) => error.getStatus() === 409);
  assert.deepEqual(f.accounts.get('owner'), primary);
  f.accounts.get('other').documentHash = 'other-hash';
  f.state.duplicateAthletes = [{ id: 'another-athlete', documentHash: alternate.documentHash }];
  await assert.rejects(f.service.confirmIdentityOcr('owner', 'PASSPORT', { documentNumber: alternateNumber, applyToProfile: true }),
    (error) => error.getStatus() === 409);
  f.state.duplicateAthletes = [];
  await f.service.confirmIdentityOcr('owner', 'PASSPORT', { documentNumber: alternateNumber, fullName: 'Same Person', applyToProfile: true });
  assert.equal(f.accounts.get('owner').documentHash, primary.documentHash, 'Alternate documents cannot replace the primary identity');
  assert.equal(f.accounts.get('owner').identityType, 'CCCD');
  await assert.rejects(f.service.confirmIdentityOcr('owner', 'AVATAR', {}), (error) => error.getStatus() === 400);
  await assert.rejects(f.service.confirmIdentityOcr('owner', 'CCCD_BACK', {}), (error) => error.getStatus() === 404);
  await f.service.upsertMedia('owner', 'CCCD_BACK', file('application/pdf'));
  f.media('CCCD_BACK').ocrStatus = 'FAILED';
  await assert.rejects(f.service.confirmIdentityOcr('owner', 'CCCD_BACK', {}), (error) => error.getStatus() === 400);
  const linked = fixture({ linked: true, enabled: true });
  linked.state.ocrResult = f.state.ocrResult;
  await linked.service.upsertMedia('owner', 'CCCD_FRONT', file());
  await linked.service.confirmIdentityOcr('owner', 'CCCD_FRONT', { fullName: 'Linked Metadata Only', applyToProfile: false });
  assert.equal(linked.state.identityWrites, 0);
  assert.equal(linked.state.athleteWrites, 0);
  await linked.service.confirmIdentityOcr('owner', 'CCCD_FRONT', { fullName: 'Linked Confirmed', documentNumber: linked.number, applyToProfile: true });
  assert.equal(linked.state.identityChecks, 1);
  assert.equal(linked.state.identityWrites, 1);
  assert.equal((await linked.service.getProfile('owner')).athlete.fullName, 'Linked Confirmed');
  assert.equal(linked.accounts.get('owner').displayName, 'Linked Confirmed');
}

async function main() {
  await accountRolesAndFiles();
  await validationAndOwnership();
  await replacementFailureAndConcurrency();
  await ocrConfirmation();
  console.log('PASS: account-only media for every role, PDF OCR modes, secure owner reads, replacement cleanup, linked athletes and guarded OCR/profile confirmation.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
