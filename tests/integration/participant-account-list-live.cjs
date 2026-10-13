// Run from /app in an isolated backend container with its own PostgreSQL database.
// Uses TEST_BASE_URL and ADMIN_USERNAME/ADMIN_EMAIL + ADMIN_PASSWORD; fixtures are removed.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const { randomUUID, randomInt } = require('node:crypto');
const backendDir = process.env.TEST_BACKEND_DIR || path.resolve(process.cwd(), 'apps/backend');
const backendRequire = createRequire(path.join(backendDir, 'package.json'));
const { PrismaClient } = backendRequire('@prisma/client');
const { ConfigService } = backendRequire('@nestjs/config');
const bcrypt = backendRequire('bcrypt');
const { AthleteIdentityService } = backendRequire('./dist/src/athletes/athlete-identity.service');
const { StorageService } = backendRequire('./dist/src/storage/storage.service');
const { SystemSettingsService } = backendRequire('./dist/src/system-settings/system-settings.service');
const prisma = new PrismaClient();
const identity = new AthleteIdentityService();
const storage = new StorageService(new ConfigService(), new SystemSettingsService(prisma));
const base = (process.env.TEST_BASE_URL || 'http://127.0.0.1:4000/api').replace(/\/$/, '');
const marker = `ACCOUNT_LIST_${randomUUID()}`;
const fixturePassword = 'Synthetic-account-list-QA-123';
const accountIds = [], athleteIds = [], eventIds = [], userIds = [], storageKeys = [];
const expected = [];
let countryId, sportId, federationId, createdCountry = false, createdSport = false;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');

// A valid one-page PDF containing an empty content stream.
function pdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(text);
  text += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  text += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(text);
}
const pdf = pdfFixture();
function request(url, token, method = 'GET', body) {
  return fetch(`${base}${url}`, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
}
async function json(response, status = 200) {
  assert.equal(response.status, status, await response.clone().text());
  assert.ok(response.headers.get('content-type').includes('application/json'));
  return response.json();
}
async function files(types, label) {
  const output = [];
  for (const type of types) {
    const bytes = type === 'AVATAR' ? png : pdf;
    const mimeType = type === 'AVATAR' ? 'image/png' : 'application/pdf';
    const storageKey = await storage.put(bytes, mimeType, `integration-account-list/${marker}/${label}`);
    storageKeys.push(storageKey);
    output.push({ type, storageKey, mimeType, size: bytes.length,
      verificationStatus: type === 'AVATAR' ? null : 'VERIFIED' });
  }
  return output;
}
const fullTypes = (type) => type === 'CCCD' ? ['AVATAR', 'CCCD_FRONT', 'CCCD_BACK'] : ['AVATAR', 'PASSPORT'];
function identityKeys(fullName, identityType = 'CCCD') {
  const documentNumber = identityType === 'CCCD' ? `992${randomInt(100000000, 999999999)}` : `Q${randomInt(1000000, 9999999)}`;
  return { documentNumber, keys: identity.normalize({ fullName, gender: 'MALE', countryId,
    identityType, documentNumber }) };
}
async function addAccount(label, accountType, complete, extra = {}) {
  const displayName = `${marker} ${label}`;
  const account = await prisma.participantAccount.create({ data: {
    email: `${randomUUID()}@account-list.invalid`, password: await bcrypt.hash(fixturePassword, 8), displayName,
    accountType, accountTypes: [accountType], phone: '0901234567', ...extra,
  } });
  accountIds.push(account.id);
  expected.push({ ...account, complete });
  return account;
}
async function addAthlete(account, media, identityRecord = null) {
  const athlete = await prisma.athlete.create({ data: {
    firstName: account.displayName, lastName: 'Synthetic', fullName: account.displayName,
    gender: 'MALE', countryId, participantAccountId: account.id,
    photoUrl: 'https://example.invalid/legacy-link.png', media: { create: media },
    ...(identityRecord ? { identity: { create: identityRecord } } : {}),
  } });
  athleteIds.push(athlete.id);
  return athlete;
}
async function addParticipation(account, type, media, eventIndex = 0, metadata = true) {
  const identityRecord = type ? identityKeys(account.displayName, type) : null;
  const participation = await prisma.eventParticipation.create({ data: {
    accountId: account.id, eventId: eventIds[eventIndex], role: account.accountType,
    contactName: account.displayName, contactEmail: account.email,
    federationId: ['TEAM_LEADER', 'REFEREE'].includes(account.accountType) ? federationId : null,
    identityType: type, documentEncrypted: metadata && identityRecord
      ? identityRecord.keys.cccdEncrypted || identityRecord.keys.passportEncrypted : null,
    referenceCode: `QA-${randomUUID()}`, createdAt: new Date(`2026-10-${eventIndex ? '02' : '01'}`), media: { create: media },
  } });
  return { participation, documentNumber: identityRecord?.documentNumber };
}
async function list(token, filters = {}) {
  const query = new URLSearchParams({ search: marker, limit: '100', ...filters });
  const response = await request(`/participant-auth/admin/accounts?${query}`, token);
  const result = await json(response);
  assert.ok(response.headers.get('cache-control').includes('no-store'));
  return result;
}
function checkSummary(result, fixtures) {
  assert.equal(result.total, fixtures.length);
  assert.deepEqual(result.summary, { total: fixtures.length, complete: fixtures.filter((item) => item.complete).length,
    incomplete: fixtures.filter((item) => !item.complete).length,
    pending: fixtures.filter((item) => item.verificationStatus === 'PENDING').length });
  for (const item of result.items) assert.equal(item.profile.complete, fixtures.find((fixture) => fixture.id === item.id).complete, item.displayName);
}

async function main() {
  try {
    assert.equal(process.env.STORAGE_DRIVER || 'local', 'local', 'This test must use isolated local storage');
    const login = await json(await request('/auth/login', null, 'POST', {
      identifier: process.env.ADMIN_USERNAME || process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD,
    }), 201);
    const adminToken = login.accessToken;
    let country = await prisma.country.findFirst();
    if (!country) { country = await prisma.country.create({ data: { code: marker, name: marker } }); createdCountry = true; }
    countryId = country.id;
    let sport = await prisma.sport.findFirst();
    if (!sport) { sport = await prisma.sport.create({ data: { code: marker, name: marker } }); createdSport = true; }
    sportId = sport.id;
    federationId = (await prisma.federation.create({ data: { name: `${marker} Synthetic Unit`, countryId } })).id;
    for (let index = 0; index < 2; index += 1) {
      eventIds.push((await prisma.event.create({ data: { name: `${marker} Event ${index}`, sportId,
        startDate: new Date('2035-01-01'), endDate: new Date('2035-01-02') } })).id);
    }

    const linked = await addAccount('A Complete Athlete', 'ATHLETE', true, { identityType: 'CCCD', federationId });
    const linkedIdentity = identityKeys(linked.displayName);
    await addAthlete(linked, await files(fullTypes('CCCD'), 'linked'), linkedIdentity.keys);
    const legacy = await addAccount('B Legacy Avatar Link', 'ATHLETE', false, { identityType: 'CCCD' });
    await addAthlete(legacy, []);
    const missingAvatar = await addAccount('C Missing Avatar', 'ATHLETE', false, { identityType: 'CCCD' });
    await addAthlete(missingAvatar, await files(['CCCD_FRONT', 'CCCD_BACK'], 'no-avatar'));
    const coach = await addAccount('D Coach Old Complete', 'COACH', true, { verificationStatus: 'PENDING', federationId });
    await addAthlete(coach, await files(fullTypes('CCCD'), 'coach-athlete'), identityKeys(coach.displayName).keys);
    const oldCoach = await addParticipation(coach, 'PASSPORT', await files(fullTypes('PASSPORT'), 'coach-old'));
    await addParticipation(coach, 'CCCD', await files(['AVATAR', 'CCCD_FRONT'], 'coach-latest'), 1);
    const referee = await addAccount('E Referee No Number', 'REFEREE', true);
    await addParticipation(referee, 'PASSPORT', await files(fullTypes('PASSPORT'), 'referee'), 0, false);
    const split = await addAccount('F Split Documents', 'TEAM_LEADER', false, { verificationStatus: 'PENDING' });
    await addParticipation(split, 'CCCD', await files(['CCCD_BACK'], 'split-old'));
    await addParticipation(split, 'CCCD', await files(['AVATAR', 'CCCD_FRONT'], 'split-latest'), 1);
    const inferred = await addAccount('G Inferred Passport', 'ATHLETE', true);
    await addAthlete(inferred, await files(fullTypes('PASSPORT'), 'inferred'));
    const wrong = await addAccount('H Wrong Known Type', 'ATHLETE', false, { identityType: 'CCCD' });
    await addAthlete(wrong, await files(fullTypes('PASSPORT'), 'wrong'));
    const encryptedKnown = await addAccount('I Encrypted Known Type', 'ATHLETE', false);
    await addAthlete(encryptedKnown, await files(fullTypes('PASSPORT'), 'encrypted-wrong'), identityKeys(encryptedKnown.displayName).keys);
    await addAccount('J Disabled', 'ATHLETE', false, { isActive: false, verificationStatus: 'REJECTED' });
    const nullStorage = await addAccount('K Null Storage Key', 'ATHLETE', false, { identityType: 'CCCD' });
    const nullFiles = await files(fullTypes('CCCD'), 'null-key');
    nullFiles.find((item) => item.type === 'AVATAR').storageKey = null;
    await addAthlete(nullStorage, nullFiles);
    const passportIdentity = await addAccount('L Encrypted Passport', 'ATHLETE', true);
    await addAthlete(passportIdentity, await files(fullTypes('PASSPORT'), 'encrypted-passport'), identityKeys(passportIdentity.displayName, 'PASSPORT').keys);
    const unknownStaff = await addAccount('M Unknown Staff Type', 'REFEREE', true);
    await addParticipation(unknownStaff, null, await files(fullTypes('CCCD'), 'unknown-staff'));
    const noNumber = await addAccount('N Athlete No Number', 'ATHLETE', true, { identityType: 'CCCD', verificationStatus: 'PENDING' });
    await addAthlete(noNumber, await files(fullTypes('CCCD'), 'no-number'));

    const all = await list(adminToken);
    if (all.summary.complete !== expected.filter((item) => item.complete).length) {
      const completeDiagnostic = await list(adminToken, { profileStatus: 'COMPLETE' });
      const includedIds = new Set(completeDiagnostic.items.map((item) => item.id));
      console.error('Synthetic completeness diagnostics:', JSON.stringify(all.items.map((item) => ({
        name: item.displayName.replace(`${marker} `, ''),
        expected: expected.find((fixture) => fixture.id === item.id).complete,
        projected: item.profile.complete, databaseComplete: includedIds.has(item.id), identityType: item.profile.identityType,
      })), null, 2));
    }
    checkSummary(all, expected);
    assert.equal(all.items.length, expected.length);
    for (const sensitive of ['storageKey', 'documentEncrypted', 'password', 'documentHash', 'athlete', 'eventParticipations']) {
      assert.ok(!JSON.stringify(all).includes(`"${sensitive}"`), `${sensitive} must not be disclosed`);
    }
    const coachProfile = all.items.find((item) => item.id === coach.id).profile;
    assert.equal(coachProfile.identityType, 'PASSPORT');
    assert.equal(coachProfile.documentNumber, oldCoach.documentNumber);
    assert.equal(all.items.find((item) => item.id === linked.id).profile.documentNumber, linkedIdentity.documentNumber);
    for (const item of all.items.flatMap((row) => row.profile.media)) assert.ok(item.mediaUrl.startsWith('/participant-auth/admin/accounts/'));
    for (const profileStatus of ['COMPLETE', 'INCOMPLETE']) {
      const selected = expected.filter((item) => item.complete === (profileStatus === 'COMPLETE'));
      const result = await list(adminToken, { profileStatus });
      checkSummary(result, selected);
      assert.equal(result.items.length, selected.length);
    }
    for (const [filter, value, predicate] of [
      ['accountType', 'COACH', (item) => item.accountType === 'COACH'],
      ['verificationStatus', 'PENDING', (item) => item.verificationStatus === 'PENDING'],
      ['isActive', 'false', (item) => !item.isActive],
      ['federationId', federationId, (item) => item.federationId === federationId],
      ['federationId', 'none', (item) => item.federationId === null],
    ]) checkSummary(await list(adminToken, { [filter]: value }), expected.filter(predicate));
    checkSummary(await list(adminToken, { profileStatus: 'COMPLETE', accountType: 'ATHLETE' }), expected.filter((item) => item.complete && item.accountType === 'ATHLETE'));
    checkSummary(await list(adminToken, { search: linked.email.toUpperCase() }), expected.filter((item) => item.id === linked.id));
    checkSummary(await list(adminToken, { search: `${marker} Synthetic Unit` }), expected.filter((item) => item.federationId === federationId));
    const first = await list(adminToken, { page: '1', limit: '3', sortBy: 'displayName', sortOrder: 'asc' });
    const second = await list(adminToken, { page: '2', limit: '3', sortBy: 'displayName', sortOrder: 'asc' });
    checkSummary(first, expected); checkSummary(second, expected);
    assert.deepEqual(first.items.map((item) => item.id), expected.slice(0, 3).map((item) => item.id));
    assert.deepEqual(second.items.map((item) => item.id), expected.slice(3, 6).map((item) => item.id));
    assert.equal((await list(adminToken, { page: '99', limit: '3' })).items.length, 0);
    for (const query of ['limit=101', 'page=0', 'isActive=unknown', 'profileStatus=FULL', 'sortBy=password', 'accountType=UNKNOWN']) {
      assert.equal((await request(`/participant-auth/admin/accounts?${query}`, adminToken)).status, 400);
    }

    const participant = await json(await request('/participant-auth/login', null, 'POST', { email: coach.email, password: fixturePassword }), 201);
    const avatarPath = `/participant-auth/admin/accounts/${coach.id}/media/AVATAR?variant=avatar`;
    const passportPath = `/participant-auth/admin/accounts/${coach.id}/media/PASSPORT?variant=preview`;
    for (const token of [null, participant.accessToken]) {
      assert.equal((await request('/participant-auth/admin/accounts', token)).status, 401);
      assert.equal((await request(avatarPath, token)).status, 401);
      assert.equal((await request(passportPath, token)).status, 401);
    }
    for (const [url, bytes, mimeType] of [[avatarPath, png, 'image/png'], [passportPath, pdf, 'application/pdf']]) {
      const response = await request(url, adminToken);
      assert.equal(response.status, 200, await response.clone().text());
      assert.ok(response.headers.get('content-type').includes(mimeType));
      assert.ok(response.headers.get('cache-control').includes('no-store'));
      assert.equal(response.headers.get('content-disposition'), 'inline');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    assert.equal((await request(`/participant-auth/admin/accounts/${coach.id}/media/CCCD_FRONT`, adminToken)).status, 404);
    assert.equal((await request(`/participant-auth/admin/accounts/${coach.id}/media/UNKNOWN`, adminToken)).status, 400);
    assert.equal((await request(`/participant-auth/admin/accounts/${coach.id}/media/AVATAR?variant=unknown`, adminToken)).status, 400);
    assert.equal((await request('/participant-auth/admin/accounts/missing/media/AVATAR', adminToken)).status, 404);
    for (const role of ['READ_ONLY', 'GAMES_ADMIN', 'CONTENT']) {
      const user = await prisma.user.create({ data: { name: marker, email: `${randomUUID()}@account-list.invalid`, role,
        password: await bcrypt.hash(fixturePassword, 8) } });
      userIds.push(user.id);
      const session = await json(await request('/auth/login', null, 'POST', { identifier: user.email, password: fixturePassword }), 201);
      const status = role === 'CONTENT' ? 403 : 200;
      assert.equal((await request(`/participant-auth/admin/accounts?search=${marker}`, session.accessToken)).status, status);
      assert.equal((await request(passportPath, session.accessToken)).status, status);
    }
    console.log('PASS: PostgreSQL account completeness/null semantics, fallback source selection, search/filter/summary/pagination validation, roles/privacy and authenticated PNG/PDF blobs.');
  } finally {
    if (eventIds.length) await prisma.event.deleteMany({ where: { id: { in: eventIds }, name: { startsWith: marker } } });
    if (athleteIds.length) await prisma.athlete.deleteMany({ where: { id: { in: athleteIds }, fullName: { startsWith: marker } } });
    if (accountIds.length) await prisma.participantAccount.deleteMany({ where: { id: { in: accountIds }, displayName: { startsWith: marker } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds }, name: marker } });
    if (federationId) await prisma.federation.deleteMany({ where: { id: federationId, name: { startsWith: marker } } });
    if (createdSport && sportId) await prisma.sport.deleteMany({ where: { id: sportId, name: marker } });
    if (createdCountry && countryId) await prisma.country.deleteMany({ where: { id: countryId, name: marker } });
    for (const key of storageKeys) await storage.deleteQuietly(key);
    await prisma.$disconnect();
    console.log('Temporary account-list fixtures removed.');
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
