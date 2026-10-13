// Generate the fixture with TICKET_FIXTURE_PATH=/private/tmp/sportdata-consolidated-ticket.json
// node tests/regression/consolidated-athlete-tickets.mjs, then run against a local frontend.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TICKET_PLAYWRIGHT_MODULE || 'playwright');
const { ticket, registrations } = JSON.parse(await readFile(
  process.env.TICKET_FIXTURE_PATH || '/private/tmp/sportdata-consolidated-ticket.json', 'utf8',
));
ticket.athlete.avatarUrl = null;
const browser = await chromium.launch({ headless: true,
  ...(process.env.TICKET_CHROME_PATH ? { executablePath: process.env.TICKET_CHROME_PATH } : {}) });
const baseUrl = process.env.TICKET_UI_URL || 'http://localhost:3000';
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  const account = { id: 'account', email: 'test@example.invalid', displayName: ticket.athlete.fullName,
    accountTypes: ['ATHLETE'], hasAthleteProfile: true,
    athlete: { ...ticket.athlete, media: [], country: { id: 'VIE', code: 'VIE', name: 'Việt Nam' } } };
  await page.addInitScript((account) => {
    localStorage.setItem('participant_token', 'test-token');
    localStorage.setItem('participant_account', JSON.stringify(account));
  }, account);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api', '');
    let body = {};
    if (path.startsWith('/participant-auth/tickets/')) body = ticket;
    else if (path === '/participant-auth/me') body = account;
    else if (path === '/participant-auth/registrations') body = registrations.filter((item) =>
      item.athleteId === 'athlete' && item.eventId === 'event'
      && (item.status === 'CONFIRMED' && item.paymentStatus === 'NOT_REQUIRED' || item.id === 'unissued-0'));
    else if (path === '/countries' || path === '/federations' || path.includes('participations')) body = [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`${baseUrl}/tickets/SD-TICKET-3`);
  const card = page.locator('.event-pass-card');
  await card.waitFor();
  assert.equal(await card.count(), 1);
  const categoryText = await card.locator('[data-ticket-element-id="category"]').textContent();
  for (const label of ['No-Gi', 'Gi', 'Full Contact', 'Fighting']) assert.ok(categoryText.includes(label));
  assert.equal(await page.locator('[data-ticket-element-type="QR"]').count(), 1);
  assert.equal(await page.getByRole('link', { name: 'Tải thẻ PDF', exact: true }).getAttribute('href'),
    '/api/participant-auth/tickets/SD-TICKET-0/pdf');
  assert.equal(await page.getByText('Nội dung thi đấu (4)', { exact: true }).count(), 1);
  await card.screenshot({ path: process.env.TICKET_SCREENSHOT_PATH || '/private/tmp/sportdata-consolidated-ticket.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await card.boundingBox();
  assert.ok(bounds.width <= 390 && bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await page.goto(`${baseUrl}/account`);
  await page.getByText('Thẻ & hồ sơ đã đăng ký (2)', { exact: true }).click();
  await card.waitFor();
  assert.equal(await card.count(), 1, 'four approved disciplines display only one card');
  assert.equal(await page.getByRole('link', { name: 'Tải PDF', exact: true }).count(), 1);
  assert.equal(await page.getByRole('link', { name: 'Theo dõi hồ sơ', exact: true }).count(), 1,
    'unpaid registration remains accessible');
  assert.deepEqual(errors, []);
  console.log('PASS: ticket page displays four disciplines and one QR/PDF link; account displays one pass and preserves unpaid registration; mobile layout fits.');
} finally {
  await browser.close();
}
