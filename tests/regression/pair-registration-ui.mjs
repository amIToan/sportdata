// Read-only browser regression: API calls are mocked, including submission.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PAIR_PLAYWRIGHT_MODULE || '/private/tmp/sportdata-ui-check/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PAIR_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const event = { id: 'pair-ui', name: 'Giải Ju-Jitsu · Đăng ký cặp', startDate: '2035-01-01', registrationEnabled: true, paymentMode: 'MANUAL', categories: [
  { id: 'duo', name: 'Duo nam', sportId: 'jj', discipline: 'DUO', gender: 'MALE', sport: { name: 'Ju-Jitsu' } },
  { id: 'show', name: 'Show nam', sportId: 'jj', discipline: 'SHOW', gender: 'MALE', sport: { name: 'Ju-Jitsu' } },
] };
let submitted;
let resultInput;
let pairResult = { resultVersion: 0, resultStatus: 'DRAFT', athlete1Score: 0, athlete2Score: 0 };
const team1 = { id: 'team-1', name: 'Pair A', members: [{ athlete: { fullName: 'Nguyễn Văn A' } }, { athlete: { fullName: 'Trần Văn B' } }] };
const team2 = { id: 'team-2', name: 'Pair B', members: [{ athlete: { fullName: 'VĐV C' } }, { athlete: { fullName: 'VĐV D' } }] };
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace('/api', '');
    let body = {};
    if (path === '/auth/profile') body = { id: 'operator', name: 'Operator', role: 'GAMES_ADMIN' };
    else if (path === '/matches/pair-score') body = { id: 'pair-score', eventId: 'pair-ui', team1Id: team1.id, team2Id: team2.id, team1, team2 };
    else if (path.startsWith('/results/matches/pair-score')) {
      if (req.method() === 'POST') {
        const input = req.postDataJSON();
        assert.equal(input.expectedVersion, pairResult.resultVersion);
        const action = path.split('/').at(-1);
        if (action === 'enter') { resultInput = input; pairResult = { ...pairResult, ...input }; }
        pairResult = { ...pairResult, resultVersion: pairResult.resultVersion + 1,
          resultStatus: { enter: 'ENTERED', 'referee-confirm': 'REFEREE_CONFIRMED', approve: 'APPROVED', publish: 'PUBLISHED' }[action] };
      }
      body = pairResult;
    }
    else if (path === '/events/pair-ui') body = event;
    else if (path === '/countries') body = [{ id: 'VIE', code: 'VIE', name: 'Việt Nam' }];
    else if (path === '/federations' || path.includes('participations')) body = [];
    else if (path === '/participant-auth/identity/lookup') {
      const input = req.postDataJSON();
      const fullName = input.documentNumber === '123456789012' ? 'Nguyễn Văn A' : 'Trần Văn B';
      body = { status: 'FOUND', reuseToken: `reuse-${input.documentNumber}`, athlete: { fullName, birthDate: '2000-01-01',
        countryId: 'VIE', gender: 'MALE', hasAvatar: true, hasIdentity: true } };
    } else if (path === '/participant-auth/guest-registrations') {
      submitted = req.postDataJSON();
      body = { referenceCode: 'PAIR-TEST', registrations: [0, 1].map((index) => ({ id: `reg-${index}`, athleteId: `a-${index}`,
        athleteIndex: index, categoryId: 'duo', athleteName: submitted.athletes[index].fullName, ticketCode: `T-${index}`,
        status: 'SUBMITTED', paymentStatus: index ? 'NOT_REQUIRED' : 'PENDING', feeAmount: index ? 0 : 100000, currency: 'VND' })) };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const field = (root, label) => root.locator('label').filter({ hasText: label }).first().locator('..');
  const choose = async (root, label, option) => {
    await field(root, label).locator('.ant-select').click();
    await page.locator('.ant-select-dropdown:visible').getByText(option, { exact: true }).click();
  };
  await page.goto(`${process.env.PAIR_UI_URL || 'http://localhost:3000'}/events/pair-ui/register?role=ATHLETE`);
  await page.getByText('Người liên hệ hồ sơ', { exact: true }).waitFor();
  await field(page, 'Họ tên người liên hệ').locator('input').fill('Nguyễn Văn A');
  await field(page, 'Email').locator('input').fill('test@example.invalid');
  await field(page, 'Số điện thoại *').locator('input').fill('0901234567');
  const first = page.locator('#athlete-1');
  await first.getByText('Hồ sơ đã lưu', { exact: true }).click();
  await field(first, 'Số CCCD').locator('input').fill('123456789012');
  await first.getByRole('button', { name: 'Tìm và chọn hồ sơ đã lưu', exact: true }).click();
  await first.getByText('Đã chọn: Nguyễn Văn A', { exact: true }).waitFor();
  await choose(first, 'Nội dung 1', 'Ju-Jitsu · Duo System');
  await choose(first, 'Hạng cân / hạng đấu', 'Duo nam');
  await first.getByRole('button', { name: 'Chọn hồ sơ đã lưu', exact: true }).click();
  const second = page.locator('#athlete-2');
  await field(second, 'Số CCCD').locator('input').fill('123456789013');
  await second.getByRole('button', { name: 'Tìm và chọn hồ sơ đã lưu', exact: true }).click();
  await second.getByText('Đã chọn: Trần Văn B', { exact: true }).waitFor();
  await first.scrollIntoViewIfNeeded();
  await first.screenshot({ path: '/private/tmp/sportdata-pair-registration.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await first.boundingBox();
  assert.ok(bounds.width <= 390 && bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await first.screenshot({ path: '/private/tmp/sportdata-pair-registration-mobile.png' });
  await page.getByRole('button', { name: 'Gửi hồ sơ', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('PAIR-TEST'));
  assert.equal(submitted.athletes.length, 2);
  assert.deepEqual(submitted.pairs, [{ categoryId: 'duo', athleteIndex: 0, partnerIndex: 1 }]);
  assert.equal(submitted.athletes[1].categoryIds.length, 0, 'partner has no extra paid discipline');
  assert.ok(submitted.athletes.every((athlete) => athlete.reuseToken && athlete.profileConfirmed));
  await page.addInitScript(() => localStorage.setItem('cms_token', 'test-token'));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${process.env.PAIR_UI_URL || 'http://localhost:3000'}/cms/matches/pair-score/scoreboard`);
  await page.getByText('Kết quả DUO / SHOW', { exact: true }).waitFor();
  await page.getByRole('spinbutton').nth(0).fill('24.5');
  await page.getByRole('spinbutton').nth(1).fill('23.25');
  await choose(page, 'Cặp thắng', 'Nguyễn Văn A / Trần Văn B');
  await page.getByRole('button', { name: 'Lưu kết quả cặp', exact: true }).click();
  await page.getByRole('button', { name: 'Trọng tài xác nhận', exact: true }).click();
  await page.getByRole('button', { name: 'Phê duyệt kết quả', exact: true }).click();
  await page.getByRole('button', { name: 'Công bố kết quả', exact: true }).click();
  await page.getByRole('button', { name: 'Khóa kết quả', exact: true }).waitFor();
  assert.equal(resultInput.winnerTeamId, team1.id);
  assert.equal(resultInput.athlete1Score, 24.5);
  assert.equal(resultInput.athlete2Score, 23.25);
  assert.equal(pairResult.resultStatus, 'PUBLISHED');
  assert.deepEqual(errors, []);
  console.log('PASS: pair selector, saved partner, single-payer payload, submission, mobile layout and pair result entry/approval/publication.');
} finally { await browser.close(); }
