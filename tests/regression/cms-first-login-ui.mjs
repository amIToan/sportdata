// Mocked API; each scenario starts with an empty incognito browser context.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CMS_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CMS_CHROME_PATH ? { executablePath: process.env.CMS_CHROME_PATH } : {}),
});
const baseUrl = process.env.CMS_UI_URL || 'http://localhost:3000';

try {
  for (const entryPath of ['/cms/login', '/cms']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => {
      errors.push(error.stack || error.message);
      console.error(error.stack || error.message);
    });
    page.on('console', (message) => {
      if (message.text().includes('[antd: Drawer]') && message.text().includes('deprecated')) {
        errors.push(message.text());
      }
    });
    let loginCount = 0;
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body;
      if (path === '/api/auth/login') {
        loginCount += 1;
        body = { accessToken: `test-session-${loginCount}`, user: { username: `admin${loginCount}`, role: 'ADMIN' } };
      } else if (path === '/api/auth/profile') {
        assert.equal(route.request().headers().authorization, `Bearer test-session-${loginCount}`);
        body = { username: `admin${loginCount}`, role: 'ADMIN' };
      } else if (path === '/api/notifications') {
        body = { items: [], unreadCount: 0 };
      } else if (path === '/api/dashboard/stats') {
        body = { totalEvents: loginCount * 123, totalAthletes: 0, totalMatches: 0, liveMatches: 0 };
      } else if (path === '/api/events') {
        body = { items: [] };
      } else {
        body = [];
      }
      await route.fulfill({ json: body });
    });
    await page.goto(`${baseUrl}${entryPath}`);
    assert.equal(await page.evaluate(() => localStorage.length), 0);

    for (let session = 1; session <= 2; session += 1) {
      await page.locator('#identifier').fill(`admin${session}`);
      await page.locator('#password').fill('test-password');
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
      await page.getByText('Bảng điều khiển', { exact: true }).waitFor();
      await page.getByText(`admin${session}`, { exact: true }).waitFor();
      await page.locator('.ant-statistic-content-value').filter({ hasText: String(session * 123) }).waitFor();
      assert.deepEqual(errors, [], `${entryPath}: login ${session} must not crash`);

      if (session === 1) {
        await page.getByRole('button', { name: 'Mở menu tài khoản' }).click();
        await page.getByText('Đăng xuất', { exact: true }).click();
        await page.locator('#identifier').waitFor();
      }
    }

    await page.reload();
    await page.getByText('Bảng điều khiển', { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Mở điều hướng' }).click();
    const drawer = page.getByRole('dialog');
    await drawer.waitFor();
    assert.equal(Math.round((await drawer.boundingBox()).width), 264);
    assert.deepEqual(errors, [], `${entryPath}: reload must not crash`);
    await context.close();
    console.log(`PASS ${entryPath}: first login, logout/login with a new session, reload, mobile drawer`);
  }
} finally {
  await browser.close();
}
