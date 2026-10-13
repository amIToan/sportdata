// Run after npm run build:backend. No database, email or external services.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
const { EventParticipationsService } = require('./dist/src/participants/event-participations.service.js');
const { TicketPdfService } = require('./dist/src/participants/ticket-pdf.service.js');
const { defaultTicketDesign, validateTicketDesign, ticketTextValue, ticketTextLayout } = require('./dist/src/events/ticket-design.js');
const ts = require('typescript');
const imageHelpers = { exports: {} };
new Function('exports', ts.transpileModule(readFileSync(new URL('../../apps/frontend/src/lib/image-url.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(imageHelpers.exports);

const avatar = process.env.TICKET_AVATAR_PATH ? readFileSync(process.env.TICKET_AVATAR_PATH)
  : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const avatarMimeType = avatar[0] === 0xff && avatar[1] === 0xd8 ? 'image/jpeg' : 'image/png';
const event = { id: 'event', name: 'Giải vô địch Ju-Jitsu Việt Nam', sport: { name: 'Ju-Jitsu' },
  startDate: new Date('2030-01-01'), endDate: new Date('2030-01-02'), updatedAt: new Date('2026-01-01'),
  ticketBackgroundSize: null, ticketBackgroundStorageKey: null };
const roles = { COACH: 'Huấn luyện viên', TEAM_LEADER: 'Trưởng đoàn', REFEREE: 'Trọng tài' };
const records = Object.keys(roles).map((role, index) => ({
  id: `participation-${index}`, role, referenceCode: `SDP-TEST-${role}`, status: 'CONFIRMED',
  statusChangedAt: new Date('2026-01-02'), updatedAt: new Date('2026-01-02'), event,
  contactName: 'Nguyễn Thị Minh Anh', contactEmail: 'private@example.invalid', contactPhone: 'private-phone',
  identityType: 'CCCD', documentEncrypted: 'private-encrypted-identity', federation: { name: 'CLB Ju-Jitsu Hà Nội' },
  media: [{ type: 'AVATAR', storageKey: `avatars/${index}`, mimeType: avatarMimeType, size: avatar.length },
    { type: 'CCCD_FRONT', storageKey: `documents/${index}`, mimeType: 'application/pdf', size: 100 }],
}));
const reads = [];
const prisma = {
  eventParticipation: { findUnique: async ({ where }) => records.find((record) =>
    where.referenceCode ? record.referenceCode === where.referenceCode : record.id === where.id) },
  eventParticipationMedia: { findUnique: async ({ where }) => records.find((record) =>
    record.id === where.participationId_type.participationId)?.media.find((media) => media.type === where.participationId_type.type) },
};
const storage = { read: async (key, variant) => { reads.push({ key, variant }); return avatar; } };
const service = new EventParticipationsService(prisma, {}, storage, {});
const layout = validateTicketDesign(defaultTicketDesign());
const title = layout.elements.find((element) => element.id === 'athlete-title');
const name = layout.elements.find((element) => element.field === 'ATHLETE_NAME');
const unit = layout.elements.find((element) => element.field === 'FEDERATION');
const pdfService = new TicketPdfService();
if (process.env.TICKET_PDF_DIR) mkdirSync(process.env.TICKET_PDF_DIR, { recursive: true });

for (const record of records) {
  const publicTicket = await service.getTicket(` ${record.referenceCode.toLowerCase()} `);
  assert.equal(publicTicket.roleLabel, roles[record.role]);
  assert.equal(publicTicket.isValid, true);
  assert.equal(new URL(publicTicket.athlete.avatarUrl, 'https://example.invalid').pathname,
    `/api/participant-auth/event-participations/${record.id}/avatar`);
  const portraitUrl = imageHelpers.exports.imageUrl(publicTicket.athlete.avatarUrl, 'portrait');
  assert.equal(new URL(portraitUrl, 'https://example.invalid').searchParams.get('variant'), 'portrait');
  assert.equal(reads.length, 0, 'Public ticket JSON does not fetch private files');
  assert.equal(publicTicket.assets, undefined);
  const serialized = JSON.stringify(publicTicket);
  for (const secret of ['private@example.invalid', 'private-phone', 'private-encrypted-identity', 'documents/']) {
    assert.ok(!serialized.includes(secret), 'QR payload must not expose identity or contact data');
  }
  assert.equal(ticketTextValue(title, publicTicket), roles[record.role].toUpperCase());
  assert.equal(ticketTextValue({ ...title, field: 'CUSTOM', text: 'VẬN ĐỘNG VIÊN' }, publicTicket),
    roles[record.role].toUpperCase(), 'Previously saved layouts continue to print the correct role');
  assert.equal(ticketTextValue(name, publicTicket), record.contactName);
  assert.equal(ticketTextValue(unit, publicTicket), record.federation.name);
  assert.ok(!ticketTextLayout(title, ticketTextValue(title, publicTicket)).lines.join(' ').includes('…'));

  const issued = await service.getIssuedTicket(record.referenceCode, true);
  assert.deepEqual(issued.assets.avatarData, avatar, 'PDF embeds the uploaded portrait');
  assert.equal(issued.assets.avatarMimeType, avatarMimeType);
  assert.deepEqual(reads.splice(0), [{ key: record.media[0].storageKey, variant: undefined }],
    'PDF uses the stored portrait and never reads an identity document');
  const pdf = await pdfService.generate([issued]);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal([...pdf.toString('latin1').matchAll(/\/Type \/Page\b/g)].length, 1, 'Each role receives one A6 page');
  assert.ok(pdf.toString('latin1').includes('/Subtype /Image'), 'Issued PDF contains the portrait');
  if (process.env.TICKET_PDF_DIR) writeFileSync(join(process.env.TICKET_PDF_DIR, `${record.role}.pdf`), pdf);
  await service.getPublicAvatar(record.id, 'portrait');
  assert.deepEqual(reads.splice(0), [{ key: record.media[0].storageKey, variant: 'portrait' }]);

  for (const status of ['SUBMITTED', 'REJECTED', 'CANCELLED']) {
    record.status = status;
    const unissued = await service.getTicket(record.referenceCode, true);
    assert.equal(unissued.isValid, false);
    assert.equal(unissued.athlete.avatarUrl, null);
    assert.equal(unissued.assets.avatarData, null);
    await assert.rejects(service.getIssuedTicket(record.referenceCode, true), /chỉ được phát hành/);
    await assert.rejects(service.getPublicAvatar(record.id), /chưa được phát hành/);
    assert.equal(reads.length, 0, 'Unissued and revoked portraits cannot be read publicly');
  }
  record.status = 'CONFIRMED';
}
assert.equal(ticketTextValue(title, { ticketCode: 'SD-ATHLETE', status: 'CONFIRMED', event,
  category: { name: 'Nam -70 kg' }, athlete: { fullName: 'VĐV' } }), 'VẬN ĐỘNG VIÊN');
console.log('PASS: coach, team leader and referee cards use the correct role/name/unit/portrait; legacy and athlete layouts; A6 PDFs; QR privacy; revoked/unissued portrait and PDF access.');
