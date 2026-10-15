// Build first, then: node --test apps/backend/scripts/smoke-certificates.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import fs from 'node:fs';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { defaultCertificateDesign, validateCertificateDesign, certificateText } = require('../dist/src/events/certificate-design.js');
const { EventCertificatesService } = require('../dist/src/events/event-certificates.service.js');
const { certificateAwards } = require('../dist/src/events/certificate-awards.js');
const ts = require('typescript');
const printModule = new Module(fileURLToPath(new URL('../../frontend/src/lib/certificate-print.ts', import.meta.url)));
printModule.filename = printModule.id;
printModule.paths = Module._nodeModulePaths(process.cwd());
// Compile the browser-independent print markup with the actual shared contract.
const source = fs.readFileSync(new URL('../../frontend/src/lib/certificate-print.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replace("from './certificate-design'", `from ${JSON.stringify(require.resolve('../dist/src/events/certificate-design.js'))}`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
printModule._compile(compiled, printModule.filename);
const { certificatePrintHtml } = printModule.exports;

test('layout validates A4 bounds and rejects malformed or unsafe fields', () => {
  assert.deepEqual(validateCertificateDesign(defaultCertificateDesign()), defaultCertificateDesign());
  for (const mutate of [
    (d) => { d.elements[0].x = NaN; },
    (d) => { d.elements[0].width = 300; },
    (d) => { d.elements[0].color = 'red;display:none'; },
    (d) => { d.elements[0].field = '__proto__'; },
    (d) => { d.elements.push(d.elements[0]); },
    (d) => { d.offsetY = 21; },
    (d) => { d.awards = { a: '<'.repeat(501) }; },
  ]) { const design = defaultCertificateDesign(); mutate(design); assert.throws(() => validateCertificateDesign(design)); }
});

test('print produces one A4 page per recipient, escapes text, omits the preprinted background by default', () => {
  const design = defaultCertificateDesign();
  const recipient = { id: 'athlete:category', athleteName: '<script>"Nguyễn & An"</script>', federation: 'Hà Nội', category: '-62 kg', sport: 'Ju-Jitsu', country: 'Việt Nam', birthDate: '2000-01-01' };
  const event = { name: 'Giải toàn quốc', startDate: '2026-10-01', endDate: '2026-10-03', location: 'Hà Nội' };
  design.awards[recipient.id] = 'Huy chương Vàng';
  const html = certificatePrintHtml(design, event, [recipient, { ...recipient, id: 'another' }]);
  assert.equal((html.match(/class="sheet"/g) || []).length, 2);
  assert.match(html, /size:A4 portrait;margin:0/);
  assert.match(html, /width:210mm;height:297mm/);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;SCRIPT&gt;&quot;NGUYỄN &amp; AN/);
  assert.match(html, /HUY CHƯƠNG VÀNG/);
  assert.equal(certificateText({ field: 'AWARD' }, recipient, event, design), 'Huy chương Vàng');
  assert.match(certificatePrintHtml(design, event, [recipient], 'blob:test'), /class="background"/);
  design.orientation = 'landscape';
  assert.match(certificatePrintHtml(design, event, [recipient]), /width:297mm;height:210mm/);
});

test('reference template fills the year, full date range, award and issuer without copying sample identities', () => {
  const design = { ...defaultCertificateDesign(), issueDate: '2026-05-09', issuePlace: 'Bắc Ninh', signerName: 'Người ký thực tế' };
  const recipient = { id: 'athlete:category', athleteName: 'Bùi Khôi Nguyên', birthDate: '2010-08-12', federation: 'TP.HCM', category: '-56KG NAM NỘI DUNG GI - U18', award: 'Huy chương Đồng' };
  const event = { name: 'Giải vô địch các lứa tuổi trẻ Jujitsu quốc gia 2026', startDate: '2026-05-05', endDate: '2026-05-14' };
  const text = (field) => certificateText({ field }, recipient, event, design);
  assert.equal(text('ATHLETE_NAME_UPPER'), 'BÙI KHÔI NGUYÊN');
  assert.equal(text('BIRTH_YEAR'), '2010');
  assert.equal(text('EVENT_DATE_LONG'), 'Từ ngày 05 đến ngày 14 tháng 05 năm 2026');
  assert.equal(text('ISSUE_LINE'), 'Bắc Ninh, ngày 09 tháng 05 năm 2026');
  assert.equal(text('AWARD_LINE'), 'ĐẠT HUY CHƯƠNG ĐỒNG HẠNG -56KG NAM NỘI DUNG GI - U18');
  assert.equal(text('SIGNER_NAME'), 'Người ký thực tế');
  assert.equal(defaultCertificateDesign().signerName, '');
  assert.equal(certificateText({ field: 'BIRTH_YEAR' }, { ...recipient, birthDate: null }, event, design), '');
  design.awards[recipient.id] = '';
  assert.match(text('AWARD_LINE'), /^THAM GIA THI ĐẤU/);
  assert.deepEqual(validateCertificateDesign(design), design);
  assert.equal(certificateText({ field: 'EVENT_DATE_LONG' }, recipient, { ...event, endDate: '2026-06-02' }, design), 'Từ ngày 05 tháng 05 năm 2026 đến ngày 02 tháng 06 năm 2026');
});

test('certificate awards use published placements, include both sides and team members', () => {
  const final = { id: 'final', status: 'FINISHED', resultStatus: 'PUBLISHED', matchType: 'FINAL', athlete1Id: 'a', athlete2Id: 'b', winnerId: 'a', winnerTeamId: null, winnerToMatchId: null, loserToMatchId: null, team1: null, team2: null };
  const draw = { eventId: 'event', categoryId: 'category', divisionId: null, type: 'MAIN_TREE', matches: [final] };
  assert.equal(certificateAwards([draw]).get('a:category'), 'Huy chương Vàng');
  assert.equal(certificateAwards([draw]).get('b:category'), 'Huy chương Bạc');
  assert.equal(certificateAwards([{ ...draw, matches: [{ ...final, resultStatus: 'APPROVED' }] }]).size, 0);
  const teamFinal = { ...final, athlete1Id: null, athlete2Id: null, winnerId: null, winnerTeamId: 't1', team1: { id: 't1', members: [{ athleteId: 'a' }, { athleteId: 'c' }] }, team2: { id: 't2', members: [{ athleteId: 'b' }] } };
  assert.equal(certificateAwards([{ ...draw, matches: [teamFinal] }]).get('c:category'), 'Huy chương Vàng');
});

test('recipient list deduplicates confirmed registrations and uses the event category scope', async () => {
  const athlete = { id: 'athlete', fullName: 'Nguyễn Văn An', birthDate: new Date('2000-01-01'), country: { name: 'Việt Nam' }, federation: { name: 'CLB' } };
  const category = { id: 'category', name: '-62 kg', sport: { name: 'Ju-Jitsu' } };
  const prisma = {
    event: { findUnique: async () => ({ categories: [{ id: category.id }], athletes: [{ ...athlete, categories: [category, { ...category, id: 'other-event' }] }] }) },
    eventRegistration: { findMany: async (query) => { assert.equal(query.where.eventId, 'event'); assert.equal(query.where.status, 'CONFIRMED'); return [{ athlete, category, federation: { name: 'Đoàn Hà Nội' } }]; } },
    draw: { findMany: async () => [] },
  };
  const rows = await new EventCertificatesService(prisma, {}).recipients('event');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'athlete:category');
  assert.equal(rows[0].federation, 'Đoàn Hà Nội');
});

test('background upload rejects active content and cleans storage on failed database writes', async () => {
  const deleted = [];
  const service = new EventCertificatesService({ event: { findUnique: async () => ({ id: 'event' }) }, $transaction: async () => { throw new Error('write failed'); } }, {
    upload: async () => ({ key: 'local:new', mimeType: 'image/png' }), deleteQuietly: async (key) => deleted.push(key),
  });
  await assert.rejects(service.uploadBackground('event', { buffer: Buffer.from('<svg/>'), size: 6, mimetype: 'image/svg+xml' }), /PNG|JPG/);
  await assert.rejects(service.uploadBackground('event', { buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), size: 8, mimetype: 'image/png' }), /write failed/);
  assert.deepEqual(deleted, ['local:new']);
});
