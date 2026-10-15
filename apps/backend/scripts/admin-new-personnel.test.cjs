const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '../tsconfig.json') });
const { EventParticipationsService } = require('../src/participants/event-participations.service');
(async () => {
  let accountData, participationData, queued = 0, ocrEnabled = false, duplicate = false;
  const references = { avatar: { id: 'avatar', token: 'a' }, cccdFront: { id: 'front', token: 'b' }, cccdBack: { id: 'back', token: 'c' }, passport: { id: 'passport', token: 'd' } };
  const types = { avatar: 'AVATAR', front: 'CCCD_FRONT', back: 'CCCD_BACK', passport: 'PASSPORT' };
  const tx = {
    participantMediaUpload: {
      findMany: async ({ where }) => Object.values(references).filter(ref => where.id.in.includes(ref.id)).map(ref => ({ id: ref.id, type: types[ref.id], storageKey: 'local:' + ref.id, tokenHash: createHash('sha256').update(ref.token).digest('hex'), mimeType: 'image/jpeg', size: 100 })),
      deleteMany: async ({ where }) => ({ count: where.id.in.length }),
    },
    participantAccount: { findUnique: async () => duplicate ? { id: 'existing' } : null, create: async ({ data }) => { accountData = data; return { id: 'new-account' }; } },
    eventParticipation: { create: async ({ data }) => { participationData = data; return { ...data, id: 'new-participation' }; } },
  };
  const db = { event: { findUnique: async () => ({ id: 'event', isPublished: false, registrationEnabled: false, startDate: new Date('2020-01-01'), participatingFederations: [] }) }, federation: { findUnique: async () => ({ id: 'unit' }) }, $transaction: work => work(tx) };
  const service = new EventParticipationsService(db, { enqueueTicket: async () => { queued++; } }, {}, { normalize: () => ({ cccdEncrypted: 'encrypted', passportEncrypted: 'encrypted', documentHash: 'hash' }) }, { get: async () => ({ values: { identityOcrEnabled: ocrEnabled } }) });
  for (const role of ['REFEREE', 'COACH', 'TEAM_LEADER']) {
    const result = await service.create({ eventId: 'event', role, contactName: 'New Person', contactEmail: 'person@example.com', identityType: 'CCCD', documentNumber: '123456789012', federationId: 'unit', mediaUploads: references }, undefined, 'admin');
    assert.equal(result.status, 'CONFIRMED'); assert.equal(result.emailQueued, true);
    assert.equal(accountData.accountType, role); assert.equal(accountData.media.create.length, 3); assert.equal(participationData.accountId, 'new-account');
    assert.ok(accountData.password.startsWith('$2'));
  }
  assert.equal(queued, 3);
  ocrEnabled = true;
  const dto = { eventId: 'event', role: 'COACH', contactName: 'New Person', contactEmail: 'person@example.com', identityType: 'PASSPORT', documentNumber: 'AB123456', mediaUploads: references };
  const pending = await service.create(dto, undefined, 'admin'); assert.equal(pending.status, 'SUBMITTED'); assert.equal(queued, 3); assert.equal(accountData.media.create.length, 2);
  duplicate = true; await assert.rejects(service.create(dto, undefined, 'admin'), /Email đã có/);
  await assert.rejects(service.create(dto), /chưa công khai/);
  console.log('New CMS personnel: all roles, document types, approval, duplicate and public access checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
