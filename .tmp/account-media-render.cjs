const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { App } = require('antd');

const frontendSource = path.resolve(__dirname, '../apps/frontend/src');
let fixture;
const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;
const originalUseState = React.useState;

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: filename,
    });
    module._compile(outputText, filename);
  };
}

Module._resolveFilename = function (request, ...args) {
  return originalResolve.call(this, request.startsWith('@/')
    ? path.join(frontendSource, request.slice(2)) : request, ...args);
};

const labels = { REFEREE: 'Trọng tài', COACH: 'Huấn luyện viên', TEAM_LEADER: 'Trưởng đoàn' };

function swrData(key) {
  if (key === '/participant-auth/me') return fixture.profile;
  if (key === '/participant-auth/registrations') return [];
  if (key === '/participant-auth/event-participations') return [fixture.participation];
  if (key === '/participant-auth/team/me') return {
    email: fixture.profile.email,
    verificationStatus: 'VERIFIED',
    federation: { name: 'Đoàn kiểm tra' },
    submissions: [],
  };
  if (key?.startsWith('/participant-auth/tickets/')) return fixture.ticket;
  return [];
}

Module._load = function (request, parent, isMain) {
  if (request === 'swr') return {
    __esModule: true,
    default: (key) => ({ data: swrData(key), error: undefined, isLoading: false, mutate: async () => swrData(key) }),
  };
  if (request === 'next/navigation') return { useRouter: () => ({ replace() {}, push() {} }) };
  if (request === '@/lib/participant-auth' || (request.endsWith('/participant-auth') && parent?.filename?.includes(frontendSource))) {
    return {
      getParticipantToken: () => 'local-render-fixture',
      getParticipantAccount: () => fixture.profile,
      participantApi: { get() { throw new Error('SSR must not fetch'); }, post() { throw new Error('SSR must not mutate'); } },
      participantError: () => 'fixture error', clearParticipantSession() {}, setParticipantSession() {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

React.useState = (initialValue) => originalUseState(
  initialValue === 'profile' && fixture.tab === 'tickets' ? 'tickets' : initialValue,
);

const AccountPage = require(path.join(frontendSource, 'app/account/page.tsx')).default;
const reports = [];

for (const role of Object.keys(labels)) {
  for (const identityType of ['CCCD', 'PASSPORT']) {
    const referenceCode = `FIXTURE-${role}-${identityType}`;
    const event = { id: 'event-render-only', name: 'Giải kiểm tra giao diện', startDate: '2026-10-13' };
    fixture = {
      tab: 'profile',
      profile: {
        id: 'render-only-account', email: 'render-only@example.invalid', displayName: 'Tài khoản kiểm tra',
        accountType: role, accountTypes: [role], hasAthleteProfile: false,
        identityType, createdAt: '2026-10-13', federationId: role === 'TEAM_LEADER' ? 'federation-render-only' : null,
        athlete: {
          id: '', fullName: 'Tài khoản kiểm tra', gender: 'MALE',
          country: { id: 'country-render-only', name: 'Việt Nam', code: 'VIE' }, media: [],
          federation: role === 'TEAM_LEADER' ? { id: 'federation-render-only', name: 'Đoàn kiểm tra' } : null,
        },
      },
      participation: {
        id: 'participation-render-only', role, referenceCode, status: 'CONFIRMED',
        contactName: 'Tài khoản kiểm tra', contactEmail: 'render-only@example.invalid',
        createdAt: '2026-10-13', event,
      },
      ticket: {
        ticketCode: referenceCode, role, roleLabel: labels[role], status: 'CONFIRMED', isValid: true,
        event, category: { name: labels[role] }, athlete: {
          fullName: 'Tài khoản kiểm tra', country: { code: 'VIE', name: 'Việt Nam' },
        },
      },
    };

    const profileHtml = renderToStaticMarkup(React.createElement(App, null, React.createElement(AccountPage)));
    assert.ok(profileHtml.includes('Ảnh và giấy tờ xác minh'), `${role}/${identityType}: media card absent`);
    assert.ok(profileHtml.includes('Ảnh đại diện'), `${role}/${identityType}: avatar absent`);
    assert.ok(profileHtml.includes('CCCD mặt trước') && profileHtml.includes('CCCD mặt sau'), `${role}/${identityType}: CCCD controls absent`);
    assert.ok(profileHtml.includes('Hộ chiếu'), `${role}/${identityType}: passport absent`);
    assert.equal((profileHtml.match(/type="file"/g) || []).length, 4, `${role}/${identityType}: four real file pickers expected`);
    assert.equal((profileHtml.match(/aria-label="Bắt buộc"/g) || []).length, identityType === 'CCCD' ? 3 : 2, `${role}/${identityType}: required labels wrong`);
    assert.ok(!profileHtml.includes('Bạn có thể chọn sự kiện để gửi hồ sơ đăng ký VĐV'), `${role}/${identityType}: misleading old panel present`);
    assert.ok(profileHtml.includes('Thẻ &amp; hồ sơ đã đăng ký (1)'), `${role}/${identityType}: role ticket tab missing`);
    assert.ok(profileHtml.includes('application/pdf'), `${role}/${identityType}: PDF accept absent`);

    fixture.tab = 'tickets';
    const ticketHtml = renderToStaticMarkup(React.createElement(App, null, React.createElement(AccountPage)));
    assert.ok(ticketHtml.includes('Thẻ tham gia theo vai trò (1)'), `${role}/${identityType}: role ticket list absent`);
    assert.ok(ticketHtml.includes(labels[role]), `${role}/${identityType}: role label absent`);
    assert.ok(ticketHtml.includes('aria-label="Thẻ tham dự sự kiện A6"'), `${role}/${identityType}: issued ticket absent`);
    assert.ok(ticketHtml.includes(`/tickets/${referenceCode}?print=1`), `${role}/${identityType}: print link absent`);
    assert.ok(ticketHtml.includes(`/api/participant-auth/tickets/${referenceCode}/pdf`), `${role}/${identityType}: PDF link absent`);
    reports.push(`${role}/${identityType}: media controls + required identity + issued role ticket/print/PDF passed`);
  }
}

console.log(reports.join('\n'));
console.log('PASS: 6 role/identity fixtures, 12 actual React SSR renders; no network calls or mutations.');
