// Run from the repository root after npm run build:backend; no database or uploads are created.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');
const backendRequire = createRequire(path.resolve(__dirname, '../../apps/backend/package.json'));
const { plainToInstance } = backendRequire('class-transformer');
const { validate } = backendRequire('class-validator');
const { EventParticipationsService } = require('../../apps/backend/dist/src/participants/event-participations.service');
const { CreateEventParticipationDto } = require('../../apps/backend/dist/src/participants/dto/create-event-participation.dto');
const { AthleteIdentityService } = require('../../apps/backend/dist/src/athletes/athlete-identity.service');

process.env.SETTINGS_ENCRYPTION_KEY = 'event-participation-test-key-only-123456789';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const reference = (id) => ({ id, token: `${id}-secret-token` });
const base = {
  eventId: 'test-event', role: 'REFEREE', federationId: 'allowed-unit',
  contactName: 'Guest Official', contactEmail: 'GUEST@example.invalid',
  identityType: 'CCCD', documentNumber: '012 345 678 901',
  mediaUploads: { avatar: reference('avatar'), cccdFront: reference('front'), cccdBack: reference('back') },
};
const badRequest = (error) => error.getStatus?.() === 400;
const conflict = (error) => error.getStatus?.() === 409;
const notFound = (error) => error.getStatus?.() === 404;

function fixture(options = {}) {
  const future = new Date(Date.now() + 86400000 * 7);
  const event = {
    id: base.eventId, name: 'Test Event', isPublished: true, registrationEnabled: true,
    startDate: future, endDate: future, updatedAt: new Date(), sport: { name: 'Test Sport' },
    participatingFederations: [{ id: 'allowed-unit' }], ...options.event,
  };
  const account = { id: 'test-account', displayName: 'Account Official', email: 'account@example.invalid', phone: '0901234567', isActive: true };
  const uploads = new Map([
    ['avatar', 'AVATAR', 'image/png'], ['front', 'CCCD_FRONT', 'application/pdf'],
    ['back', 'CCCD_BACK', 'image/jpeg'], ['passport', 'PASSPORT', 'application/pdf'],
  ].map(([id, type, mimeType]) => [id, {
    id, type, mimeType, tokenHash: hash(reference(id).token), storageKey: `local:test/${id}`,
    size: 128, expiresAt: future, ...options.uploads?.[id],
  }]));
  let state = { uploads, records: [] };
  let athleteCalls = 0;
  const reads = [];
  const enqueued = [];
  const bytes = Buffer.from('test-avatar-bytes');
  const identity = new AthleteIdentityService();
  const media = (record) => record.media || [];
  const project = (record, query = {}) => {
    if (!record) return null;
    let projected = { ...record, event,
      federation: record.federationId ? { id: record.federationId, name: 'Allowed Unit' } : null };
    if (query.include?.media) {
      const specification = query.include.media;
      projected.media = record.media.filter((item) => !specification.where?.type || item.type === specification.where.type)
        .map((item) => specification.select
          ? Object.fromEntries(Object.keys(specification.select).map((key) => [key, item[key]])) : item);
    }
    if (query.select) projected = Object.fromEntries(Object.keys(query.select).map((key) => [key, projected[key]]));
    return projected;
  };
  const matchRecord = (record, where = {}) => Object.entries(where).every(([key, value]) => value === undefined || record[key] === value);
  const delegates = (current) => ({
    $queryRaw: async () => [],
    participantMediaUpload: {
      findMany: async ({ where }) => [...current.uploads.values()].filter((upload) =>
        (!where?.id?.in || where.id.in.includes(upload.id))
        && (!where?.expiresAt?.gt || upload.expiresAt > where.expiresAt.gt)),
      deleteMany: async ({ where }) => {
        const ids = where.id.in.filter((id) => current.uploads.has(id)
          && (!where.expiresAt?.gt || current.uploads.get(id).expiresAt > where.expiresAt.gt));
        ids.forEach((id) => current.uploads.delete(id));
        return { count: options.consumeCount ?? ids.length };
      },
    },
    eventParticipation: {
      create: async (query) => {
        const { data } = query;
        if (options.duplicate || current.records.some((record) => record.eventId === data.eventId
          && record.role === data.role && record.contactEmail === data.contactEmail)) throw { code: 'P2002' };
        const record = { id: `participation-${current.records.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data,
          media: (data.media?.create || []).map((item, index) => ({ id: `media-${index}`, ...item })) };
        current.records.push(record);
        return project(record, query);
      },
      findUnique: async (query) => project(current.records.find((record) => matchRecord(record, query.where)), query),
      findMany: async (query) => current.records.filter((record) => matchRecord(record, query.where)).map((record) => project(record, query)),
      update: async (query) => {
        const { where, data } = query;
        const record = current.records.find((item) => matchRecord(item, where));
        Object.assign(record, data);
        return project(record, query);
      },
    },
    eventParticipationMedia: {
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const record of current.records) {
          if (where.participationId && where.participationId !== record.id) continue;
          for (const item of record.media) {
            if (where.type?.not === item.type || (where.type?.in && !where.type.in.includes(item.type))) continue;
            if (where.verificationStatus && item.verificationStatus !== where.verificationStatus) continue;
            Object.assign(item, data);
            count++;
          }
        }
        return { count };
      },
      findFirst: async ({ where }) => {
        const record = current.records.find((item) => item.id === where.participationId);
        return media(record || {}).find((item) => item.type === where.type) || null;
      },
      findUnique: async ({ where }) => {
        const key = where.participationId_type;
        const record = current.records.find((item) => item.id === key.participationId);
        return media(record || {}).find((item) => item.type === key.type) || null;
      },
    },
    athlete: { create: async () => { athleteCalls++; throw new Error('Event roles must not create athletes'); } },
  });
  const prisma = {
    event: { findUnique: async () => event },
    federation: { findUnique: async ({ where }) => ['allowed-unit', 'outside-unit'].includes(where.id)
      ? { id: where.id, name: where.id, countryId: 'test-country' } : null },
    participantAccount: { findUnique: async () => ({ ...account, ...options.account }) },
    $transaction: async (callback) => {
      const pending = structuredClone(state);
      const result = await callback(delegates(pending));
      state = pending;
      return result;
    },
  };
  for (const name of ['participantMediaUpload', 'eventParticipation', 'eventParticipationMedia', 'athlete']) {
    prisma[name] = new Proxy({}, { get: (_, method) => (...args) => delegates(state)[name][method](...args) });
  }
  const storage = {
    read: async (key) => { reads.push(key); return bytes; },
    imageUrl: async () => undefined,
  };
  const service = new EventParticipationsService(prisma, { enqueueTicket: async (_, email, code) => { enqueued.push({ email, code }); } }, storage, identity,
    { get: async () => ({ values: { identityOcrEnabled: options.identityOcrEnabled ?? false } }) });
  return { service, identity, state: () => state, event, bytes, reads, enqueued, athleteCalls: () => athleteCalls };
}

async function main() {
  for (const input of [
    { role: 'ATTENDEE' }, { role: 'MEDICAL_STAFF' }, { role: 'ATHLETE' },
    { identityType: undefined }, { identityType: 'OTHER' }, { documentNumber: undefined },
    { mediaUploads: undefined }, { mediaUploads: { ...base.mediaUploads, avatar: undefined } },
    { mediaUploads: { ...base.mediaUploads, avatar: { id: 'avatar' } } }, { federationId: undefined },
  ]) {
    const dto = plainToInstance(CreateEventParticipationDto, { ...base, ...input });
    assert((await validate(dto)).length > 0, `DTO must reject ${JSON.stringify(input)}`);
  }
  for (const role of ['REFEREE', 'TEAM_LEADER', 'COACH']) {
    const test = fixture();
    const record = await test.service.create({ ...base, role }, 'test-account');
    const stored = test.state().records[0];
    assert.equal(record.role, role);
    assert.equal(record.contactName, 'Account Official');
    assert.equal(record.contactEmail, 'account@example.invalid');
    assert.equal(stored.identityType, 'CCCD');
    assert.notEqual(stored.documentEncrypted, base.documentNumber);
    assert.equal(test.identity.decrypt(stored.documentEncrypted, 'CCCD'), '012345678901');
    assert.equal(stored.media.length, 3);
    assert.equal(stored.media.find((item) => item.type === 'AVATAR').verificationStatus, null);
    for (const document of stored.media.filter((item) => item.type !== 'AVATAR')) {
      assert.equal(document.verificationStatus, 'VERIFIED', 'Disabling OCR approves identity documents, including PDFs');
      assert(document.verifiedAt instanceof Date);
    }
    assert.equal(test.state().uploads.size, 1, 'Successful registration consumes its staged uploads');
    assert.equal(test.athleteCalls(), 0);
    assert(!('documentEncrypted' in record), 'Encrypted identities must stay off API responses');
  }
  const passport = fixture();
  const guest = await passport.service.create({ ...base, role: 'COACH', federationId: undefined,
    identityType: 'PASSPORT', documentNumber: 'ab-12345',
    mediaUploads: { avatar: reference('avatar'), passport: reference('passport') },
  });
  assert.equal(guest.contactEmail, 'guest@example.invalid');
  assert.equal(passport.identity.decrypt(passport.state().records[0].documentEncrypted, 'PASSPORT'), 'AB12345');
  assert.deepEqual(passport.state().records[0].media.map((item) => item.type).sort(), ['AVATAR', 'PASSPORT']);
  assert.equal(passport.state().records[0].media.find((item) => item.type === 'PASSPORT').verificationStatus, 'VERIFIED');
  const ocrEnabled = fixture({ identityOcrEnabled: true });
  const pending = await ocrEnabled.service.create(base);
  assert(ocrEnabled.state().records[0].media.filter((item) => item.type !== 'AVATAR')
    .every((item) => item.verificationStatus === 'PENDING' && !item.verifiedAt));
  const approved = await ocrEnabled.service.updateStatus(pending.id, { status: 'CONFIRMED', reason: '  Organizer verified  ' }, 'reviewer@example.invalid');
  assert.equal(approved.status, 'CONFIRMED');
  assert.equal(approved.statusReason, 'Organizer verified');
  assert(approved.media.filter((item) => item.type !== 'AVATAR').every((item) => item.verificationStatus === 'VERIFIED'));
  assert(ocrEnabled.state().records[0].media.filter((item) => item.type !== 'AVATAR')
    .every((item) => item.verifiedAt instanceof Date && item.verifiedBy === 'reviewer@example.invalid'));
  assert.equal(approved.media.find((item) => item.type === 'AVATAR').verificationStatus, null);
  await ocrEnabled.service.updateStatus(pending.id, { status: 'CONFIRMED', reason: 'Repeated confirmation' }, 'reviewer@example.invalid');
  assert.equal(ocrEnabled.enqueued.length, 1, 'Repeated confirmation must not enqueue duplicate ticket mail');

  const invalidPayloads = [
    { role: 'ATTENDEE' }, { role: 'MEDICAL_STAFF' }, { role: 'ATHLETE' },
    { identityType: 'OTHER' }, { documentNumber: '123' }, { documentNumber: '   ' }, { documentNumber: '.- -.' },
    { identityType: 'PASSPORT', documentNumber: '!!!!!!!' },
    { mediaUploads: undefined }, { mediaUploads: {} },
    { mediaUploads: { ...base.mediaUploads, avatar: undefined } },
    { mediaUploads: { ...base.mediaUploads, cccdBack: undefined } },
    { mediaUploads: { ...base.mediaUploads, cccdFront: { id: 'front', token: 'wrong-token' } } },
    { mediaUploads: { ...base.mediaUploads, cccdFront: reference('missing') } },
    { mediaUploads: { ...base.mediaUploads, cccdBack: reference('front') } },
    { federationId: undefined }, { role: 'TEAM_LEADER', federationId: undefined },
    { federationId: 'outside-unit' }, { federationId: 'missing-unit' },
    { role: 'COACH', federationId: 'outside-unit' },
  ];
  for (const invalid of invalidPayloads) {
    const test = fixture();
    await assert.rejects(test.service.create({ ...base, ...invalid }), badRequest, JSON.stringify(invalid));
    assert.equal(test.state().records.length, 0);
    assert.equal(test.state().uploads.size, 4, 'Invalid registration must preserve staged uploads');
  }
  for (const invalid of [
    { expiresAt: new Date(Date.now() - 1000) }, { type: 'PASSPORT' }, { storageKey: null },
    { mimeType: 'application/octet-stream' }, { size: 8 * 1024 * 1024 + 1 }, { size: 0 },
  ]) {
    const test = fixture({ uploads: { front: invalid } });
    await assert.rejects(test.service.create(base), badRequest, JSON.stringify(invalid));
    assert.equal(test.state().records.length, 0);
    assert.equal(test.state().uploads.size, 4);
  }
  const pdfAvatar = fixture({ uploads: { avatar: { mimeType: 'application/pdf' } } });
  await assert.rejects(pdfAvatar.service.create(base), badRequest);

  const duplicate = fixture({ duplicate: true });
  await assert.rejects(duplicate.service.create(base), conflict);
  assert.equal(duplicate.state().records.length, 0);
  assert.equal(duplicate.state().uploads.size, 4, 'Duplicate insert rolls upload consumption back');
  const raced = fixture({ consumeCount: 2 });
  await assert.rejects(raced.service.create(base), badRequest);
  assert.equal(raced.state().records.length, 0, 'Losing an upload-consumption race cannot leave a participation');
  assert.equal(raced.state().uploads.size, 4);

  for (const event of [
    { registrationEnabled: false }, { registrationOpenAt: new Date(Date.now() + 86400000) },
    { registrationCloseAt: new Date(Date.now() - 1000) },
  ]) await assert.rejects(fixture({ event }).service.create(base), badRequest);
  await assert.rejects(fixture({ event: { isPublished: false } }).service.create(base), notFound);
  await assert.rejects(fixture({ account: { isActive: false } }).service.create(base, 'test-account'), badRequest);

  const ticketFixture = fixture();
  const participation = await ticketFixture.service.create(base, 'test-account');
  await assert.rejects(ticketFixture.service.getPublicAvatar(participation.id), notFound);
  assert.equal((await ticketFixture.service.getTicket(participation.referenceCode)).athlete.avatarUrl, null);
  assert.equal((await ticketFixture.service.getTicket(participation.referenceCode, true)).assets.avatarData, null);
  const privateDocument = await ticketFixture.service.getAdminMedia(participation.id, 'CCCD_FRONT');
  assert.equal(privateDocument.mimeType, 'application/pdf');
  assert.deepEqual(privateDocument.data, ticketFixture.bytes);
  await assert.rejects(ticketFixture.service.getAdminMedia(participation.id, 'PASSPORT'), notFound);
  await assert.rejects(ticketFixture.service.getAdminMedia(participation.id, 'INVALID'), notFound);
  await assert.rejects(ticketFixture.service.getAdminMedia('missing', 'AVATAR'), notFound);
  const stored = ticketFixture.state().records[0];
  stored.status = 'CONFIRMED';
  stored.statusChangedAt = new Date();
  const publicTicket = await ticketFixture.service.getTicket(participation.referenceCode);
  assert(publicTicket.athlete.avatarUrl.startsWith(`/api/participant-auth/event-participations/${participation.id}/avatar?v=`));
  for (const privateField of ['documentNumber', 'documentEncrypted', 'media', 'contactEmail', 'contactPhone']) {
    assert(!JSON.stringify(publicTicket).includes(`"${privateField}"`), `Public ticket leaked ${privateField}`);
  }
  const assets = (await ticketFixture.service.getTicket(participation.referenceCode, true)).assets;
  assert.deepEqual(assets.avatarData, ticketFixture.bytes);
  assert.equal(assets.avatarMimeType, 'image/png');
  assert(ticketFixture.reads.includes('local:test/avatar'));
  assert.deepEqual((await ticketFixture.service.getPublicAvatar(participation.id)).data, ticketFixture.bytes);
  const mine = await ticketFixture.service.listMine('test-account', base.eventId);
  assert(!('documentNumber' in mine[0]) && !('documentEncrypted' in mine[0]));
  assert(mine[0].media.every((item) => !('storageKey' in item)));
  const admin = await ticketFixture.service.listAdmin(base.eventId);
  assert.equal(admin[0].documentNumber, '012345678901');
  assert(!('documentEncrypted' in admin[0]));
  assert.equal(admin[0].media.length, 3);
  assert(admin[0].media.every((item) => !('storageKey' in item)), 'Storage references are private');
  stored.status = 'CANCELLED';
  await assert.rejects(ticketFixture.service.getPublicAvatar(participation.id), notFound);
  assert.equal((await ticketFixture.service.getTicket(participation.referenceCode, true)).assets.avatarData, null);
  console.log('PASS: event roles, required media/identity/unit, encryption, staged upload security and transaction rollback; public ticket privacy/avatar/PDF assets and admin metadata.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
