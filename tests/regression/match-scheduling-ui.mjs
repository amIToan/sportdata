// Invoked by match-scheduling-database.mjs with SCHEDULE_UI=1. Scheduling
// requests use the real API and disposable PostgreSQL schema, not canned data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const require = createRequire(import.meta.url);

export async function runScheduleUi({ apiBase, db, eventId, token, actor, categoryId, categoryName }) {
  const { chromium } = require(process.env.SCHEDULE_PLAYWRIGHT_MODULE || '/private/tmp/sportdata-browser/node_modules/playwright');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const output = `${root}output/qa/match-scheduling`;
  mkdirSync(output, { recursive: true });
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const frontend = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/next/dist/bin/next', import.meta.url)), 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: `${root}apps/frontend`, env: { ...process.env, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  frontend.stdout.on('data', (data) => { log += data; }); frontend.stderr.on('data', (data) => { log += data; });
  let browser;
  try {
    for (let i = 0; i < 60; i++) {
      if (log.includes('Ready')) break;
      if (frontend.exitCode != null) throw new Error(`Frontend exited: ${log}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    browser = await chromium.launch({ headless: true, executablePath: process.env.SCHEDULE_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'UTC' });
    await context.addInitScript(({ token, actor }) => {
      localStorage.setItem('cms_token', token); localStorage.setItem('cms_user', JSON.stringify(actor)); localStorage.setItem('cms_color_mode', 'light');
    }, { token, actor: { id: actor.id, name: actor.name, role: actor.role } });
    const page = await context.newPage();
    const browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      if (path.startsWith('/scheduling/') || path.startsWith('/auth/')) {
        const response = await route.fetch({ url: `${apiBase}${path}`, headers: { ...route.request().headers(), authorization: `Bearer ${token}` } });
        return route.fulfill({ response });
      }
      if (path === `/events/${eventId}/admin-detail`) {
        const event = await db.event.findUnique({ where: { id: eventId }, include: { categories: { include: { sport: true } }, fops: true, sport: true,
          sports: true, _count: { select: { matches: true, athletes: true, registrations: true } } } });
        return route.fulfill({ json: event });
      }
      if (path === '/notifications') return route.fulfill({ json: { items: [], unreadCount: 0 } });
      return route.fulfill({ json: [] });
    });
    await page.goto(`http://127.0.0.1:${port}/cms/events/${eventId}?tab=matches`);
    await page.getByRole('heading', { name: 'Sắp xếp trận đấu', exact: true }).waitFor();
    await page.getByText('Lịch A · GI', { exact: true }).first().waitFor();
    await page.getByText('Lịch B · Fighting', { exact: true }).first().waitFor();
    assert.ok(await page.getByText('09:00–09:10', { exact: true }).count() >= 2, 'UTC browser renders Vietnam 09:00 for A and B');
    await page.screenshot({ path: `${output}/01-overview.png`, fullPage: true });
    const beforePlans = await db.matchSchedulePlan.count({ where: { eventId } });
    await page.getByRole('button', { name: '+ Tạo lịch', exact: true }).first().click();
    await page.getByLabel('Tên lịch', { exact: true }).fill('Lịch C · Full Contact');
    assert.equal(await db.matchSchedulePlan.count({ where: { eventId } }), beforePlans, 'opening a wizard does not write a plan');
    await page.getByLabel('Thêm nội dung thi đấu', { exact: true }).click();
    await page.getByText('FULL_CONTACT · Nam', { exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Thêm nội dung', exact: true }).click();
    await page.getByRole('checkbox', { name: categoryName, exact: true }).check();
    await page.getByText('Sơ đồ cây', { exact: true }).click();
    await page.getByText('Giữ thay đổi bản nháp?', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Ở lại', exact: true }).click();
    assert.equal(await page.getByLabel('Tên lịch', { exact: true }).inputValue(), 'Lịch C · Full Contact');
    await page.getByLabel('Giờ bắt đầu tự động', { exact: true }).fill('09:00');
    await page.screenshot({ path: `${output}/02-step-content.png`, fullPage: true });
    const autoResponse = page.waitForResponse((response) => response.url().endsWith('/preview') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sắp xếp tự động', exact: true }).click();
    const automatic = await (await autoResponse).json();
    await page.getByText('31/31 trận đã xếp', { exact: true }).waitFor();
    assert.equal(automatic.canApply, true);
    assert.ok(new Set(automatic.assignments.map((item) => item.localDate)).size > 1, 'one click distributes all matches across event days');
    assert.equal(await db.match.count({ where: { categoryId, startTime: { not: null } } }), 0, 'automatic scheduling remains a reviewable preview');
    const automaticPlan = await db.matchSchedulePlan.findFirst({ where: { eventId, name: 'Lịch C · Full Contact' } });
    assert.equal(automaticPlan.draft.windows.length, 3);
    assert.ok(automaticPlan.draft.windows.every((window) => window.startLocalTime === '09:00' && window.endLocalTime === '10:30'));
    await page.screenshot({ path: `${output}/11-automatic-preview.png`, fullPage: true });
    const secondMatch = automatic.assignments[1];
    const secondNumber = automatic.matchDetails.find((item) => item.id === secondMatch.matchId).matchNumber;
    const pinnedTime = automatic.assignments[0].end + 4 * 60000;
    const movedTime = pinnedTime + 2 * 60000;
    const clock = (value) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
    await page.locator('.ant-collapse-header').filter({ hasText: 'Vòng 32 người' }).first().click();
    const secondRow = page.getByText(`STT 2 · Trận #${secondNumber}`, { exact: true }).locator('..').locator('..');
    await secondRow.getByRole('button', { name: 'Cố định giờ', exact: true }).click();
    await page.getByLabel('Giờ dời trận', { exact: true }).fill(clock(pinnedTime));
    const pinnedResponse = page.waitForResponse((response) => response.url().endsWith('/preview') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Tính lại phần sau', exact: true }).click();
    const pinnedPreview = await (await pinnedResponse).json();
    assert.equal(pinnedPreview.canApply, true, JSON.stringify(pinnedPreview.violations));
    assert.equal(pinnedPreview.assignments.find((item) => item.matchId === secondMatch.matchId).start, pinnedTime);
    await page.locator('.ant-collapse-header').filter({ hasText: 'Vòng 32 người' }).first().click();
    await secondRow.getByRole('button', { name: 'Dời từ đây', exact: true }).click();
    assert.equal(await page.getByLabel('Giờ dời trận', { exact: true }).inputValue(), clock(pinnedTime), 'drawer restores existing pin');
    await page.getByLabel('Giờ dời trận', { exact: true }).fill(clock(movedTime));
    const movedResponse = page.waitForResponse((response) => response.url().endsWith('/preview') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Tính lại phần sau', exact: true }).click();
    const movedPreview = await (await movedResponse).json();
    assert.equal(movedPreview.canApply, true, JSON.stringify(movedPreview.violations));
    assert.equal(movedPreview.assignments.find((item) => item.matchId === secondMatch.matchId).start, movedTime);
    const movedDraft = await db.matchSchedulePlan.findUnique({ where: { id: automaticPlan.id } });
    assert.ok(!movedDraft.draft.pinnedStarts.some((item) => item.matchId === secondMatch.matchId), 'moving replaces the old pin');
    await page.locator('.ant-collapse-header').filter({ hasText: 'Vòng 32 người' }).first().click();
    await secondRow.getByRole('button', { name: 'Dời từ đây', exact: true }).click();
    const clearedResponse = page.waitForResponse((response) => response.url().endsWith('/preview') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Bỏ mốc giờ của trận này', exact: true }).click();
    await clearedResponse;
    await page.getByRole('button', { name: 'Quay lại', exact: true }).click();
    await page.getByRole('button', { name: 'Xóa ngày', exact: true }).last().click();
    await page.getByRole('button', { name: 'Xóa ngày', exact: true }).last().click();
    await page.getByLabel('Bắt đầu ngày 1', { exact: true }).fill('09:00');
    await page.getByLabel('Kết thúc ngày 1', { exact: true }).fill('09:10');
    await page.screenshot({ path: `${output}/03-step-windows.png`, fullPage: true });
    await page.getByRole('button', { name: 'Quay lại', exact: true }).click();
    assert.equal(await page.getByLabel('Tên lịch', { exact: true }).inputValue(), 'Lịch C · Full Contact');
    await page.getByRole('button', { name: 'Tùy chỉnh lịch', exact: true }).click();
    assert.equal(await page.getByLabel('Kết thúc ngày 1', { exact: true }).inputValue(), '09:10');
    await page.getByRole('button', { name: 'Sắp xếp tự động', exact: true }).click();
    await page.getByText('Không còn khoảng liên tục đủ dài; các trận phía sau chưa được xếp.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Áp dụng lịch', exact: true }).isDisabled(), true);
    await page.getByLabel('Đóng thông báo', { exact: true }).first().click();
    await page.getByRole('button', { name: /Hiện lại .* thông báo đã đóng/ }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Áp dụng lịch', exact: true }).isDisabled(), true, 'closing an error cannot enable Apply');
    await page.getByRole('button', { name: /Hiện lại .* thông báo đã đóng/ }).click();
    await page.getByText('Không còn khoảng liên tục đủ dài; các trận phía sau chưa được xếp.', { exact: true }).waitFor();
    await page.getByText('31 trận chưa xếp', { exact: true }).click();
    assert.ok(await page.getByRole('button', { name: 'Dời từ đây', exact: true }).count() > 0, 'overflow offers an explicit continuation marker');
    await page.screenshot({ path: `${output}/04-overflow.png`, fullPage: true });
    await page.getByRole('button', { name: 'Quay lại', exact: true }).click();
    await page.getByLabel('Kết thúc ngày 1', { exact: true }).fill('10:30');
    await page.getByRole('button', { name: '+ Thêm ngày tiếp tục', exact: true }).click();
    await page.getByRole('button', { name: 'Sắp xếp tự động', exact: true }).click();
    await page.getByText('31/31 trận đã xếp', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/05-step-preview.png`, fullPage: true });
    await page.getByRole('button', { name: 'Áp dụng lịch', exact: true }).click();
    await page.getByText('Xác nhận thay đổi lịch toàn chuỗi', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/06-diff.png`, fullPage: true });
    const acknowledge = page.getByRole('checkbox', { name: /Tôi đã xem/ });
    if (await acknowledge.count()) await acknowledge.check();
    await page.getByRole('button', { name: 'Xác nhận áp dụng', exact: true }).click();
    await page.getByRole('heading', { name: 'Sắp xếp trận đấu', exact: true }).waitFor();
    assert.equal(await db.match.count({ where: { eventId, categoryId, startTime: { not: null }, schedulePlanId: { not: null } } }), 31);
    await page.screenshot({ path: `${output}/07-applied.png`, fullPage: true });
    await page.locator('.ant-card').filter({ hasText: 'Lịch C · Full Contact' }).first().getByRole('button', { name: 'Mở lịch', exact: true }).click();
    await page.getByRole('button', { name: 'Chỉnh sửa lịch', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Quay lại Tổng quan', exact: true }).click();
    const card = page.locator('.ant-card').filter({ hasText: 'Lịch A · GI' }).filter({ hasText: 'Tiếp tục' }).first();
    await card.getByRole('button', { name: 'Mở lịch', exact: true }).click();
    await page.getByText('Đang xem lịch đã áp dụng', { exact: true }).waitFor();
    assert.ok(await page.locator('.ant-tabs-tab-active[data-node-key="2026-10-12"]').isVisible());
    await page.screenshot({ path: `${output}/08-continuation.png`, fullPage: true });
    await page.getByRole('button', { name: 'Tiếp tục chỉnh bản nháp', exact: true }).click();
    await page.getByLabel('Tên lịch', { exact: true }).fill('Lịch A · GI (nháp)');
    await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click();
    await page.getByRole('button', { name: 'Quay lại Tổng quan', exact: true }).click();
    await page.getByText('Có thay đổi chưa áp dụng', { exact: true }).first().waitFor();
    assert.ok(await page.getByText('Lịch A · GI', { exact: true }).count(), 'overview retains applied name');
    await page.locator('.ant-card').filter({ hasText: 'Lịch A · GI' }).first().getByRole('button', { name: 'Mở lịch', exact: true }).click();
    await page.getByRole('button', { name: 'Tiếp tục chỉnh bản nháp', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Quay lại Tổng quan', exact: true }).click();
    const draftRow = page.getByText('Lịch A · GI (nháp)', { exact: true }).locator('..').locator('..');
    await draftRow.getByRole('button', { name: 'Xoá bản nháp', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Giữ lại', exact: true }).click();
    assert.ok(await page.getByText('Lịch A · GI (nháp)', { exact: true }).count(), 'cancel preserves the draft');
    await draftRow.getByRole('button', { name: 'Xoá bản nháp', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Xoá bản nháp', exact: true }).click();
    await page.getByText('Lịch A · GI (nháp)', { exact: true }).waitFor({ state: 'hidden' });
    await page.locator('.ant-card').filter({ hasText: 'Lịch A · GI' }).first().getByRole('button', { name: 'Mở lịch', exact: true }).click();
    await page.getByRole('button', { name: 'Chỉnh sửa lịch', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Quay lại Tổng quan', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${output}/09-mobile.png`, fullPage: true });
    assert.ok(await page.getByLabel('Ngày xem lịch', { exact: true }).isVisible());
    await page.locator('.ant-card:visible').filter({ hasText: 'Lịch B · Fighting' }).first().getByRole('button', { name: 'Mở lịch', exact: true }).click();
    await page.getByRole('button', { name: 'Chỉnh sửa lịch', exact: true }).click();
    await page.getByLabel('Tên lịch', { exact: true }).focus();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Lich B - Fighting updated');
    await page.getByRole('button', { name: 'Tùy chỉnh lịch', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Sắp xếp tự động', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByText('3/3 trận đã xếp', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/10-mobile-preview.png`, fullPage: true });
    await page.getByRole('button', { name: 'Áp dụng lịch', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Xác nhận áp dụng', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Sắp xếp trận đấu', exact: true }).waitFor();
    assert.ok(await page.getByText('Lich B - Fighting updated', { exact: true }).count());
    assert.deepEqual(browserErrors, []);
    console.log('PASS: real API UI overview A/B, wizard/back state, overflow, preview/diff/apply, draft isolation, continuation, UTC and mobile. Screenshots: output/qa/match-scheduling.');
  } finally {
    if (browser) await browser.close();
    frontend.kill('SIGTERM');
  }
}
