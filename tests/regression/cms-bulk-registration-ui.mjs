// Browser regression with mocked APIs; never writes registration data to a database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BULK_PLAYWRIGHT_MODULE || '/private/tmp/sportdata-ui-check/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BULK_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const event = {
  id: 'bulk-ui', name: 'Bulk registration regression', startDate: '2035-01-01', endDate: '2035-01-02',
  paymentMode: 'MANUAL', registrationFee: 100000, registrationCurrency: 'VND',
  categories: [{ id: 'light', name: 'Nam 56 kg' }, { id: 'heavy', name: 'Nam 77 kg' }],
};
const athlete = (id, fullName) => ({ id, fullName, gender: 'MALE', birthDate: '2000-01-01', weight: 55, federation: { id: 'unit-a', name: 'Đơn vị A' } });
const firstPage = [athlete('a1', 'Nguyễn Văn A'), athlete('a2', 'Trần Văn B')];
const nextPage = [athlete('a21', 'Lê Văn C')];
const created = [];
const checked = [];
const queries = [];
const errors = [];
let rejectB = true;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('cms_token', 'test-token'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api', '');
    let body = [];
    if (path === '/auth/profile') body = { id: 'admin', name: 'Admin', role: 'ADMIN', permissions: [] };
    else if (path === '/events/bulk-ui/admin-detail') body = event;
    else if (path === '/federations') body = [{ id: 'unit-a', name: 'Đơn vị A' }, { id: 'unit-b', name: 'Đơn vị B' }];
    else if (path === '/athletes') {
      queries.push(url.searchParams.toString());
      const items = url.searchParams.get('page') === '2' ? nextPage : firstPage;
      body = { items: url.searchParams.get('federationId') === 'unit-b' ? [] : items, total: 21 };
    } else if (path.endsWith('/registrations/eligibility')) {
      const payload = request.postDataJSON();
      checked.push(payload);
      const eligible = payload.athleteId !== 'a2' || !rejectB;
      body = { eligible, reasons: eligible ? [] : ['VĐV đã đăng ký một hạng đấu trong nội dung này'], warnings: [] };
    } else if (path.endsWith('/registrations') && request.method() === 'POST') {
      const payload = request.postDataJSON();
      created.push(payload);
      body = { id: `registration-${payload.athleteId}` };
    } else if (path.includes('/notifications')) body = { items: [], total: 0, unreadCount: 0 };
    await route.fulfill({ json: body });
  });
  await page.goto(`${process.env.BULK_UI_URL || 'http://localhost:3000'}/cms/events/bulk-ui?tab=registrations`);
  await page.getByRole('button', { name: 'Thêm VĐV đăng ký', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByText('Nguyễn Văn A', { exact: true }).waitFor();
  assert.equal(await modal.getByText('Giấy tờ định danh', { exact: true }).count(), 0);
  const choose = async (selector, label) => {
    await selector.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await selector.click();
    await page.locator('.ant-select-dropdown:visible').getByText(label, { exact: true }).click();
  };
  await choose(modal.locator('#registration-federation').locator('..'), 'Đơn vị A');
  await page.waitForFunction(() => document.querySelector('#registration-federation')?.closest('.ant-select')?.textContent.includes('Đơn vị A'));
  await choose(modal.locator('#categoryId').locator('..'), 'Nam 56 kg');
  await modal.locator('.ant-table').first().locator('thead input[type=checkbox]').check();
  await modal.getByText(/Đã chọn 2 VĐV/).waitFor();
  await modal.locator('.ant-pagination-item-2').click();
  await modal.getByText('Lê Văn C', { exact: true }).waitFor();
  await modal.locator('.ant-table').first().getByRole('checkbox', { name: 'Select row 1', exact: true }).check();
  await modal.getByText(/Đã chọn 3 VĐV/).waitFor();
  await choose(modal.getByRole('combobox', { name: 'Hạng đấu của Lê Văn C' }).locator('..'), 'Nam 77 kg');
  await choose(modal.locator('#categoryId').locator('..'), 'Nam 77 kg');
  await choose(modal.locator('#categoryId').locator('..'), 'Nam 56 kg');
  await choose(modal.locator('#registration-federation').locator('..'), 'Đơn vị B');
  await modal.getByText(/Đã chọn 3 VĐV/).waitFor();
  await modal.getByRole('button', { name: 'Kiểm tra điều kiện', exact: true }).click();
  await modal.getByText('VĐV đã đăng ký một hạng đấu trong nội dung này', { exact: false }).waitFor();
  assert.equal(created.length, 0, 'Checking eligibility must not create registrations');
  await modal.getByRole('button', { name: 'Thêm 3 VĐV', exact: true }).click();
  await modal.getByRole('button', { name: 'Thêm 1 VĐV', exact: true }).waitFor();
  assert.deepEqual(created.map((payload) => [payload.athleteId, payload.categoryId]), [['a1', 'light'], ['a21', 'heavy']]);
  assert.ok(created.every((payload) => !payload.mediaUploads && !payload.athlete && payload.paymentStatus === 'PENDING'));
  assert.ok(queries.some((query) => query.includes('federationId=unit-a')));
  assert.ok(queries.some((query) => query.includes('page=2')));
  await modal.screenshot({ path: '/private/tmp/sportdata-bulk-registration.png' });
  rejectB = false;
  await modal.getByText('Đã thu phí thủ công', { exact: true }).click();
  await modal.locator('#paymentNote').fill('Đã thu tiền mặt tại quầy');
  await modal.getByRole('button', { name: 'Thêm 1 VĐV', exact: true }).click();
  await modal.getByRole('button', { name: 'Thêm 0 VĐV', exact: true }).waitFor();
  assert.deepEqual(created.map((payload) => payload.athleteId), ['a1', 'a21', 'a2'], 'Retry must only submit unsuccessful athletes');
  assert.equal(created[2].paymentStatus, 'PAID');
  assert.equal(created[2].paymentNote, 'Đã thu tiền mặt tại quầy');
  assert.ok(await modal.getByRole('button', { name: 'Thêm 0 VĐV', exact: true }).isDisabled());
  await modal.getByRole('button', { name: 'Hủy', exact: true }).click();
  await page.getByRole('button', { name: 'Thêm VĐV đăng ký', exact: true }).click();
  await modal.getByText(/Đã chọn 0 VĐV/).waitFor();
  await modal.getByText('Thêm VĐV mới', { exact: true }).click();
  await modal.getByText('Giấy tờ định danh', { exact: true }).waitFor();
  await modal.getByText('Chọn VĐV đang có', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await modal.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, 'Modal must fit mobile viewport');
  await modal.screenshot({ path: '/private/tmp/sportdata-bulk-registration-mobile.png' });
  assert.deepEqual(errors, []);
  console.log(`Bulk registration UI checks passed (${checked.length} eligibility checks).`);
} finally {
  await browser.close();
}
