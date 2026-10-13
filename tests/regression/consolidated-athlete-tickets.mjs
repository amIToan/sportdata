// Run after npm run build:backend. No database, email or external services.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
const { ParticipantsService } = require('./dist/src/participants/participants.service.js');
const { TicketPdfService } = require('./dist/src/participants/ticket-pdf.service.js');
const { TicketEmailWorkerService } = require('./dist/src/participants/ticket-email-worker.service.js');
const { defaultTicketDesign, ticketTextValue, ticketTextLayout } = require('./dist/src/events/ticket-design.js');
const ts = require('typescript');
const frontendHelpers = { exports: {} };
new Function('exports', ts.transpileModule(readFileSync(new URL('../../apps/frontend/src/lib/athlete-tickets.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(frontendHelpers.exports);
const { distinctAthleteTickets } = frontendHelpers.exports;

const event = { id: 'event', name: 'Giải Ju-Jitsu', startDate: new Date('2030-01-01'),
  endDate: new Date('2030-01-02'), paymentMode: 'FREE', paymentProviders: [], registrationFee: 0 };
const athlete = { id: 'athlete', fullName: 'Nguyễn Văn An', statistics: [], media: [], country: { name: 'Việt Nam' } };
const sport = { id: 'jujitsu', name: 'Ju-Jitsu', code: 'JJ' };
const disciplines = [['NEWAZA', 'NO_GI'], ['NEWAZA', 'GI'], ['FULL_CONTACT', null], ['FIGHTING', null]];
const registrations = disciplines.map(([discipline, uniform], index) => ({
  id: `registration-${index}`, eventId: event.id, athleteId: athlete.id,
  submissionId: index === 3 ? 'later' : 'submission', event, athlete, federation: null,
  ticketCode: `SD-TICKET-${index}`, status: 'CONFIRMED', paymentStatus: 'NOT_REQUIRED',
  feeAmount: 0, currency: 'VND', createdAt: new Date('2026-01-01'),
  category: { id: `category-${index}`, name: 'Nam -70 kg', discipline, uniform, gender: 'MALE',
    minWeight: null, maxWeight: 70, sportId: sport.id, sport },
}));
const first = registrations[0];
registrations.push(
  { ...first, id: 'other-athlete', ticketCode: 'SD-OTHER-ATHLETE', athleteId: 'other', athlete: { ...athlete, id: 'other' } },
  { ...first, id: 'other-event', ticketCode: 'SD-OTHER-EVENT', submissionId: 'other-submission',
    eventId: 'other-event', event: { ...event, id: 'other-event' } },
  ...[['SUBMITTED', 'PENDING'], ['REJECTED', 'PAID'], ['CANCELLED', 'PAID'], ['CONFIRMED', 'PENDING']]
    .map(([status, paymentStatus], index) => ({ ...first, id: `unissued-${index}`,
      ticketCode: `SD-UNISSUED-${index}`, submissionId: 'unissued', status, paymentStatus, feeAmount: 100000,
      category: { ...first.category, id: `unissued-category-${index}` } })),
);
// Reverse storage order to ensure every alias uses a deterministic common QR.
registrations.reverse();
const prisma = {
  eventRegistration: {
    findUnique: async ({ where }) => registrations.find((item) => item.ticketCode === where.ticketCode),
    findMany: async ({ where, orderBy }) => {
      const rows = registrations.filter((item) => item.eventId === where.eventId && item.athleteId === where.athleteId
        && item.status === where.status && where.paymentStatus.in.includes(item.paymentStatus));
      assert.deepEqual(orderBy, [{ createdAt: 'asc' }, { id: 'asc' }]);
      return rows.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    },
  },
  registrationSubmission: {
    findUnique: async ({ where }) => ({ referenceCode: where.referenceCode, contactEmail: 'test@example.invalid',
      registrations: registrations.filter((item) => item.submissionId === (where.referenceCode === 'UNISSUED' ? 'unissued' : 'submission')) }),
  },
};
const service = new ParticipantsService(prisma, {}, {}, {}, {}, {}, {}, {});
const tickets = await Promise.all(disciplines.map((_, index) => service.getIssuedTicket(`SD-TICKET-${index}`)));
for (const ticket of tickets) {
  assert.equal(ticket.ticketCode, 'SD-TICKET-0');
  assert.equal(ticket.athlete.id, athlete.id);
  assert.equal(ticket.categories.length, 4, 'includes a later submission, excludes unpaid/rejected/cancelled categories');
  assert.deepEqual(ticket.categories.map((category) => category.id), [0, 1, 2, 3].map((index) => `category-${index}`));
}
assert.deepEqual(await service.getTicket(' sd-ticket-3 '), tickets[0], 'old links resolve to the same consolidated pass');
const batch = await service.getSubmissionTickets('submission', ' TEST@example.invalid ');
assert.equal(batch.tickets.length, 2, 'two athletes sharing a name get two passes');
assert.deepEqual(batch.tickets.map((ticket) => ticket.categories.length).sort(), [1, 4]);
assert.equal((await service.getIssuedTicket('SD-OTHER-EVENT')).categories.length, 1, 'events stay separate');
await assert.rejects(service.getSubmissionTickets('submission', 'wrong@example.invalid'), /Không tìm thấy/);
await assert.rejects(service.getSubmissionTickets('unissued', 'test@example.invalid'), /chỉ được phát hành/);
for (let index = 0; index < 4; index++) {
  await assert.rejects(service.getIssuedTicket(`SD-UNISSUED-${index}`), /chỉ được phát hành/);
  const pending = await service.getTicket(`SD-UNISSUED-${index}`);
  assert.equal(pending.ticketCode, `SD-UNISSUED-${index}`, 'payment continues to target its own registration');
  assert.equal(pending.feeAmount, 100000);
  assert.equal(pending.isValid, false);
}

const categoryElement = defaultTicketDesign().elements.find((element) => element.field === 'CATEGORY');
const categoryText = ticketTextValue(categoryElement, tickets[0]);
assert.equal(categoryText, 'No-Gi · Nam -70 kg\nGi · Nam -70 kg\nFull Contact · Nam -70 kg\nFighting · Nam -70 kg');
assert.ok(!ticketTextLayout(categoryElement, categoryText).lines.join(' ').includes('…'), 'four disciplines fit on one A6 pass');
const pdfService = new TicketPdfService();
const pdf = await pdfService.generate([tickets[0]]);
const pageCount = (buffer) => [...buffer.toString('latin1').matchAll(/\/Type \/Page\b/g)].length;
assert.equal(pageCount(pdf), 1, 'individual PDF has one page');
assert.equal(pageCount(await pdfService.generate(batch.tickets, batch.meta)), 3, 'group PDF has a cover and two athlete pages');
if (process.env.TICKET_PDF_PATH) writeFileSync(process.env.TICKET_PDF_PATH, pdf);
if (process.env.TICKET_FIXTURE_PATH) writeFileSync(process.env.TICKET_FIXTURE_PATH, JSON.stringify({ ticket: tickets[0], registrations }));

const rows = distinctAthleteTickets(registrations, (item) => `${item.eventId}:${item.athleteId}`);
assert.equal(rows.length, 7, 'UI shows three passes and four unissued registration records');
assert.equal(rows.filter((item) => item.status === 'SUBMITTED').length, 1);

// Both email paths must use the same consolidated payload as PDF downloads.
const sent = [];
const jobs = [
  { id: 'batch', to: 'test@example.invalid', referenceCode: 'SUBMISSION' },
  { id: 'single', to: 'test@example.invalid', ticketCode: 'SD-TICKET-3' },
];
const queue = { claim: async () => jobs.shift(), renew: async () => ({ count: 1 }),
  finish: async () => {}, retry: async (_, error) => { throw error; } };
const worker = new TicketEmailWorkerService(queue, service, {
  isEnabled: async () => true,
  send: async (_, payload) => { sent.push(payload); return true; },
}, {});
await worker.processNext();
await worker.processNext();
assert.equal(sent[0].length, 2);
assert.equal(sent[1].length, 1);
assert.equal(sent[1][0].categories.length, 4);
console.log('PASS: one A6 pass/QR per athlete/event, all four disciplines, batch/email exports, later additions, legacy links, identity isolation, payment eligibility and UI grouping.');
