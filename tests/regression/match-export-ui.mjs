// Run with a local frontend and DRAW_PLAYWRIGHT_MODULE pointing to Playwright if needed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DRAW_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.DRAW_CHROME_PATH ? { executablePath: process.env.DRAW_CHROME_PATH } : {}) });
const event = { id: 'export-test', name: 'Event title must not be added to PDF', startDate: '2026-10-14', endDate: '2026-10-15',
  categories: [{ id: 'cat', name: 'Nam −85 kg', sport: { name: 'Jujitsu' } }], fops: [] };
const athlete = (id, fullName) => ({ id, fullName, country: { code: 'VIE', name: 'Việt Nam' }, federation: { name: 'CLB Hà Nội' } });
const matches = [
  { id: 'm1', matchNumber: 1, round: 1, bracketPosition: 0, athlete1: athlete('a', 'Nguyễn Văn An'), athlete2: athlete('b', 'Trần Bình'),
    winnerToMatchId: 'm3', winnerToSide: 'ATHLETE1', status: 'FINISHED', winnerId: 'a', athlete1Score: 5, athlete2Score: 2 },
  { id: 'm2', matchNumber: 2, round: 1, bracketPosition: 1, athlete1: athlete('c', 'Lê Minh'), athlete2: athlete('d', 'Phạm Hùng'),
    winnerToMatchId: 'm3', winnerToSide: 'ATHLETE2', status: 'SCHEDULED', athlete1Score: 0, athlete2Score: 0 },
  { id: 'm3', matchNumber: 3, round: 2, bracketPosition: 0, athlete1: athlete('a', 'Nguyễn Văn An'), athlete2: null,
    status: 'SCHEDULED', athlete1Score: 0, athlete2Score: 0 },
].map((match) => ({ ...match, matchDate: '2026-10-14T00:00:00Z', startTime: '2026-10-14T03:05:00Z', fop: 'Thảm 1' }));
const draw = { id: 'draw', name: 'Nhánh chính', type: 'MAIN_TREE', sortOrder: 0, bracketSize: 4, matches };
const output = process.env.EXPORT_UI_OUTPUT || '/tmp/sportdata-export-ui';
mkdirSync(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Ho_Chi_Minh' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('cms_token', 'test-token');
    const original = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      const url = original.apply(this, args);
      if (this.width > 500 && this.height > 300) window.exportImage = url;
      return url;
    };
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api', '');
    let body = {};
    if (path === '/auth/profile') body = { id: 'admin', role: 'ADMIN', name: 'Admin' };
    else if (path.endsWith('/admin-detail')) body = event;
    else if (path.endsWith('/plans/overview')) body = { drafts: [], segments: [], days: [], fops: [], timezone: 'Asia/Ho_Chi_Minh' };
    else if (path.endsWith('/draws')) body = { draws: [draw] };
    else if (path.includes('/avatar/')) return route.fulfill({ status: 404 });
    else if (path === '/matches') body = { items: matches, meta: { page: 1, total: 63 } };
    else if (path.endsWith('/export/matches.csv')) {
      assert.equal(url.searchParams.has('page'), false);
      assert.equal(url.searchParams.has('limit'), false);
      assert.equal(url.searchParams.get('hideByes'), 'true');
      assert.equal(url.searchParams.get('scheduleOrder'), 'asc');
      return route.fulfill({ contentType: 'text/csv', body: '\uFEFF"Thứ tự thi đấu"\r\n"63"\r\n' });
    }
    await route.fulfill({ json: body });
  });
  await page.goto(`${process.env.DRAW_UI_URL || 'http://localhost:3000'}/cms/events/${event.id}?tab=matches`);
  await page.getByText('Sơ đồ cây', { exact: true }).click();
  await page.locator('.sportdata-bracket-board').waitFor();
  assert.equal(await page.locator('.sportdata-bracket-node').count(), 7);
  const before = await page.locator('.sportdata-bracket-board').getAttribute('style');
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.getByRole('button', { name: 'Xuất PDF Nhánh chính', exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(`${output}/bracket.pdf`);
  const captured = await page.evaluate(() => window.exportImage);
  writeFileSync(`${output}/captured.png`, Buffer.from(captured.split(',')[1], 'base64'));
  const pixels = await page.evaluate(async (url) => {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const ratio = image.width / 1370;
    const pixel = (x, y) => [...context.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data];
    return { background: pixel(2, 570), connector: pixel(430, 210), participant: pixel(200, 140) };
  }, captured);
  assert.equal(pixels.background[3], 255, 'PDF image must not be blank/transparent');
  assert.ok(pixels.connector[0] > 100, 'SVG connector lines must appear in the PDF');
  assert.ok(pixels.participant[0] > 100, 'participant cards must appear in the PDF');

  assert.equal(readFileSync(`${output}/bracket.pdf`).subarray(0, 4).toString(), '%PDF');
  assert.equal(await page.locator('.sportdata-bracket-board').getAttribute('style'), before, 'export preserves viewport zoom');
  assert.equal(await page.locator('body > div[style*="-100000px"]').count(), 0, 'temporary capture is cleaned up');
  await page.locator('.sportdata-draw').screenshot({ path: `${output}/bracket-ui.png` });
  draw.bracketSize = 64;
  draw.matches = [];
  for (let round = 1, count = 32; count >= 1; round++, count /= 2) {
    for (let position = 0; position < count; position++) {
      draw.matches.push({ ...matches[0], id: `large-${round}-${position}`, matchNumber: draw.matches.length + 1,
        round, bracketPosition: position, winnerToMatchId: count > 1 ? `large-${round + 1}-${Math.floor(position / 2)}` : null,
        winnerToSide: position % 2 ? 'ATHLETE2' : 'ATHLETE1' });
    }
  }
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.sportdata-bracket-node').length === 127);
  const largeDownload = page.waitForEvent('download', { timeout: 120000 });
  await page.getByRole('button', { name: 'Xuất PDF Nhánh chính', exact: true }).click();
  await (await largeDownload).saveAs(`${output}/bracket-large.pdf`);
  const largePixels = await page.evaluate(async () => {
    const image = new Image(); image.src = window.exportImage; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const ratio = image.width / 3250;
    return { width: image.width, height: image.height,
      bottomCard: [...context.getImageData(Math.round(200 * ratio), Math.round(7448 * ratio), 1, 1).data] };
  });
  assert.ok(largePixels.height > 7000, 'large PDF captures the whole tree beyond the scroll viewport');
  assert.ok(largePixels.bottomCard[0] > 100 && largePixels.bottomCard[3] === 255, 'last participant card is not cropped');
  assert.match(readFileSync(`${output}/bracket-large.pdf`).toString('latin1'), /\/Count 1\b/);
  await page.getByText('Danh sách', { exact: true }).click();
  const csvPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất CSV', exact: true }).click();
  await (await csvPromise).saveAs(`${output}/matches.csv`);
  assert.deepEqual(errors, []);
  console.log(`PASS: PDF downloads from rendered tree; viewport preserved; CSV requests all pages. Artifacts: ${output}`);
} finally { await browser.close(); }
