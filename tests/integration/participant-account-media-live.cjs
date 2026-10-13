// Run against an isolated backend and PostgreSQL database after applying migrations/building.
// Set TEST_BASE_URL, DATABASE_URL, JWT_SECRET and the server's STORAGE_LOCAL_DIR.
// Tests own account uploads through HTTP; only exact synthetic accounts/files are removed.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const { randomUUID, randomInt, createHash } = require('node:crypto');

const backendDir = process.env.TEST_BACKEND_DIR || path.resolve(process.cwd(), 'apps/backend');
const backendRequire = createRequire(path.join(backendDir, 'package.json'));
const { PrismaClient, SportDataAccountType } = backendRequire('@prisma/client');
const { JwtService } = backendRequire('@nestjs/jwt');
const { ConfigService } = backendRequire('@nestjs/config');
const { AthleteIdentityService } = backendRequire('./dist/src/athletes/athlete-identity.service');
const { StorageService } = backendRequire('./dist/src/storage/storage.service');
const { SystemSettingsService } = backendRequire('./dist/src/system-settings/system-settings.service');
const prisma = new PrismaClient();
const settings = new SystemSettingsService(prisma);
const storage = new StorageService(new ConfigService({
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: process.env.TEST_STORAGE_LOCAL_DIR || process.env.STORAGE_LOCAL_DIR || path.join(backendDir, 'static/uploads'),
}), settings);
const jwt = new JwtService({ secret: process.env.JWT_SECRET });
const identity = new AthleteIdentityService();
const base = (process.env.TEST_BASE_URL || 'http://127.0.0.1:4002/api').replace(/\/$/, '');
const marker = `ACCOUNT_MEDIA_${randomUUID()}`;
const accountIds = [], userIds = [], storageKeys = new Set();
const fixtures = [];
let countryId;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');

function pdfFixture(label) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
    `<< /Producer (${label}) >>`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(output);
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  output += `trailer\n<< /Size 6 /Root 1 0 R /Info 5 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(output);
}

function descriptor(role, type, revision = 1) {
  const label = `${marker}-${role}-${type}-${revision}`;
  return {
    // Valid PNGs permit trailing bytes; each owner/revision remains distinguishable.
    bytes: type === 'AVATAR' ? Buffer.concat([png, Buffer.from(`\n${label}`)]) : pdfFixture(label),
    mimeType: type === 'AVATAR' ? 'image/png' : 'application/pdf',
    filename: type === 'AVATAR' ? 'portrait.png' : 'identity.pdf',
  };
}

function token(id, email, participant = true) {
  return jwt.sign({ sub: id, email, ...(participant ? { type: 'participant' } : {}), sessionIssuedAt: Date.now() }, { expiresIn: '15m' });
}

function request(route, accessToken, method = 'GET', body) {
  const form = body instanceof FormData;
  return fetch(`${base}${route}`, { method, headers: {
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(body && !form ? { 'Content-Type': 'application/json' } : {}),
  }, ...(body ? { body: form ? body : JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
}

async function json(response, status = 200) {
  assert.equal(response.status, status, await response.clone().text());
  assert.ok(response.headers.get('content-type').includes('application/json'));
  return response.json();
}

function multipart(file, extra = {}) {
  const body = new FormData();
  body.set('file', new Blob([file.bytes], { type: file.mimeType }), file.filename);
  for (const [name, value] of Object.entries(extra)) body.set(name, value);
  return body;
}

function assertSafeMetadata(value) {
  for (const field of ['storageKey', 'documentEncrypted', 'documentHash', 'password', 'accountId', 'athleteId']) {
    assert.ok(!JSON.stringify(value).includes(`"${field}"`), `${field} must not be returned in account media metadata`);
  }
}

async function noAthlete() {
  assert.equal(await prisma.athlete.count({ where: { participantAccountId: { in: accountIds } } }), 0,
    'Editing account files must never create a persisted Athlete');
}

async function upload(fixture, type, file, extra) {
  const result = await json(await request(`/participant-auth/me/media/${type}`, fixture.accessToken, 'POST', multipart(file, extra)), 201);
  assertSafeMetadata(result);
  assert.equal(result.type, type);
  assert.equal(result.mimeType, file.mimeType);
  assert.equal(result.size, file.bytes.length);
  assert.equal(result.verificationStatus, type === 'AVATAR' ? null : 'VERIFIED');
  assert.equal(result.ocr, null, 'OCR-off uploads must not trigger provider requests');
  const row = await prisma.participantAccountMedia.findUniqueOrThrow({ where: { accountId_type: { accountId: fixture.id, type } } });
  assert.equal(row.size, file.bytes.length);
  assert.ok(row.storageKey.startsWith('local:'));
  storageKeys.add(row.storageKey);
  if (type !== 'AVATAR') {
    assert.equal(row.verificationStatus, 'VERIFIED');
    assert.equal(row.verifiedBy, 'SYSTEM:OCR_DISABLED');
    assert.ok(row.verifiedAt instanceof Date);
    assert.ok(row.verificationNote);
    assert.equal(row.ocrStatus, 'NOT_REQUESTED');
  }
  fixture.files.set(type, file);
  await noAthlete();
  return row;
}

async function readBlob(route, accessToken, file) {
  const response = await request(route, accessToken);
  assert.equal(response.status, 200, await response.clone().text());
  assert.ok(response.headers.get('content-type').includes(file.mimeType));
  assert.ok(response.headers.get('cache-control').includes('no-store'));
  assert.equal(response.headers.get('content-disposition'), 'inline');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), file.bytes);
}

async function cmsList(adminToken, filters = {}) {
  const query = new URLSearchParams({ search: marker, limit: '100', ...filters });
  const response = await request(`/participant-auth/admin/accounts?${query}`, adminToken);
  assert.ok(response.headers.get('cache-control').includes('no-store'));
  const result = await json(response);
  assertSafeMetadata(result);
  return result;
}

async function main() {
  try {
    assert.ok(process.env.JWT_SECRET?.length >= 32, 'Use the isolated backend JWT/encryption secret');
    assert.equal(process.env.STORAGE_DRIVER || 'local', 'local', 'This fixture requires isolated local storage');
    assert.equal((await settings.get()).values.identityOcrEnabled, false, 'Start the isolated backend with IDENTITY_OCR_ENABLED=false');
    const driver = await prisma.integrationSetting.findUnique({ where: { name: 'STORAGE_DRIVER' } });
    assert.ok(!driver || driver.value === 'local', 'Uploads must use the isolated local storage provider');
    countryId = (await prisma.country.create({ data: { code: `QA${randomInt(100000000, 999999999)}`, name: marker } })).id;
    const admin = await prisma.user.create({ data: {
      email: `${randomUUID()}@account-media.invalid`, name: marker, role: 'ADMIN', password: 'unused-synthetic-JWT-only-fixture',
    } });
    userIds.push(admin.id);
    const adminToken = token(admin.id, admin.email, false);
    const denied = await prisma.user.create({ data: {
      email: `${randomUUID()}@account-media.invalid`, name: marker, role: 'CONTENT', password: 'unused-synthetic-JWT-only-fixture',
    } });
    userIds.push(denied.id);
    const deniedToken = token(denied.id, denied.email, false);

    for (const role of Object.values(SportDataAccountType)) {
      const identityType = ['REFEREE', 'MEDICAL_STAFF'].includes(role) ? 'PASSPORT' : 'CCCD';
      const displayName = `${marker} ${role}`;
      const documentNumber = identityType === 'CCCD' ? `993${randomInt(100000000, 999999999)}` : `P${randomInt(1000000, 9999999)}`;
      const keys = identity.normalize({ fullName: displayName, gender: 'MALE', countryId, identityType, documentNumber });
      const account = await prisma.participantAccount.create({ data: {
        email: `${randomUUID()}@account-media.invalid`, password: 'unused-synthetic-JWT-only-fixture', displayName,
        accountType: role, accountTypes: [role], identityType, documentHash: keys.documentHash,
        documentEncrypted: keys.cccdEncrypted || keys.passportEncrypted, countryId, gender: 'MALE',
      } });
      accountIds.push(account.id);
      const fixture = { ...account, documentNumber, accessToken: token(account.id, account.email), files: new Map() };
      fixtures.push(fixture);
      const emptyProfile = await json(await request('/participant-auth/me', fixture.accessToken));
      assertSafeMetadata(emptyProfile);
      assert.equal(emptyProfile.hasAthleteProfile, false);
      assert.equal(emptyProfile.athlete.id, '');
      assert.deepEqual(emptyProfile.media, []);
      const types = identityType === 'CCCD' ? ['AVATAR', 'CCCD_FRONT', 'CCCD_BACK'] : ['AVATAR', 'PASSPORT'];
      for (const type of types) {
        const file = descriptor(role, type);
        await upload(fixture, type, file);
        await readBlob(`/participant-auth/me/media/${type}`, fixture.accessToken, file);
      }
      const profile = await json(await request('/participant-auth/me', fixture.accessToken));
      assertSafeMetadata(profile);
      assert.equal(profile.hasAthleteProfile, false);
      assert.equal(profile.athlete.id, '');
      assert.deepEqual(profile.media.map((row) => row.type).sort(), [...types].sort());
      assert.deepEqual(profile.athlete.media, profile.media);
      assert.ok(profile.media.filter((row) => row.type !== 'AVATAR').every((row) => row.verificationStatus === 'VERIFIED'));
      const initialCms = (await cmsList(adminToken)).items.find((row) => row.id === fixture.id);
      assert.equal(initialCms.profile.complete, true);
      assert.equal(initialCms.profile.identityType, identityType);
      assert.equal(initialCms.profile.documentNumber, documentNumber);

      // Replace both portrait and identity PDF, checking revisions and storage retirement.
      for (const type of ['AVATAR', identityType === 'CCCD' ? 'CCCD_FRONT' : 'PASSPORT']) {
        const before = await prisma.participantAccountMedia.findUniqueOrThrow({ where: { accountId_type: { accountId: fixture.id, type } } });
        const beforeRevision = initialCms.profile.media.find((row) => row.type === type).revision;
        const replacement = descriptor(role, type, 2);
        const after = await upload(fixture, type, replacement);
        assert.equal(after.id, before.id, 'Replacement updates the same account/type record');
        assert.notEqual(after.storageKey, before.storageKey);
        await assert.rejects(storage.read(before.storageKey), (error) => error.getStatus() === 404, 'Replaced storage files must be removed');
        await readBlob(`/participant-auth/me/media/${type}?variant=preview`, fixture.accessToken, replacement);
        const currentCms = (await cmsList(adminToken)).items.find((row) => row.id === fixture.id);
        const asset = currentCms.profile.media.find((row) => row.type === type);
        assert.notEqual(asset.revision, beforeRevision);
        assert.equal(asset.revision, createHash('sha256').update(after.storageKey).digest('hex').slice(0, 16));
        assert.equal(asset.mediaUrl, `/participant-auth/admin/accounts/${fixture.id}/media/${type}`);
        await readBlob(asset.mediaUrl, adminToken, replacement);
      }
    }

    const coach = fixtures.find((fixture) => fixture.accountType === 'COACH');
    const referee = fixtures.find((fixture) => fixture.accountType === 'REFEREE');
    const coachAvatarPath = '/participant-auth/me/media/AVATAR';
    const refereeCmsPath = `/participant-auth/admin/accounts/${referee.id}/media/PASSPORT`;
    for (const accessToken of [null, adminToken, token(randomUUID(), 'missing@account-media.invalid')]) {
      assert.equal((await request('/participant-auth/me', accessToken)).status, 401);
      assert.equal((await request(coachAvatarPath, accessToken)).status, 401);
      assert.equal((await request(coachAvatarPath, accessToken, 'POST', multipart(descriptor('COACH', 'AVATAR', 3)))).status, 401);
    }
    for (const accessToken of [null, coach.accessToken]) {
      assert.equal((await request(refereeCmsPath, accessToken)).status, 401);
      assert.equal((await request(`/participant-auth/admin/accounts?search=${marker}`, accessToken)).status, 401);
    }
    assert.equal((await request(refereeCmsPath, deniedToken)).status, 403);
    assert.equal((await request(`/participant-auth/admin/accounts?search=${marker}`, deniedToken)).status, 403);

    // Client-supplied ownership fields cannot read or replace another participant's documents.
    assert.equal((await request(`/participant-auth/me/media/PASSPORT?accountId=${referee.id}`, coach.accessToken)).status, 404);
    await readBlob(`${coachAvatarPath}?accountId=${referee.id}`, coach.accessToken, coach.files.get('AVATAR'));
    const refereeBefore = await prisma.participantAccountMedia.findUniqueOrThrow({ where: { accountId_type: { accountId: referee.id, type: 'AVATAR' } } });
    await upload(coach, 'AVATAR', descriptor('COACH', 'AVATAR', 3), { accountId: referee.id, athleteId: referee.id });
    const refereeAfter = await prisma.participantAccountMedia.findUniqueOrThrow({ where: { accountId_type: { accountId: referee.id, type: 'AVATAR' } } });
    assert.equal(refereeAfter.storageKey, refereeBefore.storageKey);
    await readBlob(coachAvatarPath, referee.accessToken, referee.files.get('AVATAR'));
    await readBlob(coachAvatarPath, coach.accessToken, coach.files.get('AVATAR'));

    const beforeInvalid = await prisma.participantAccountMedia.findMany({ where: { accountId: coach.id }, orderBy: { type: 'asc' } });
    assert.equal((await request('/participant-auth/me/media/UNKNOWN', coach.accessToken)).status, 400);
    assert.equal((await request('/participant-auth/me/media/UNKNOWN', coach.accessToken, 'POST', multipart(descriptor('COACH', 'AVATAR')))).status, 400);
    assert.equal((await request(coachAvatarPath, coach.accessToken, 'POST', new FormData())).status, 400);
    assert.equal((await request(coachAvatarPath, coach.accessToken, 'POST', multipart(descriptor('COACH', 'CCCD_FRONT')))).status, 400);
    assert.equal((await request('/participant-auth/me/media/CCCD_FRONT', coach.accessToken, 'POST', multipart({
      bytes: Buffer.from('invalid PDF signature'), mimeType: 'application/pdf', filename: 'bad.pdf',
    }))).status, 400);
    assert.equal((await request('/participant-auth/me/media/CCCD_FRONT', coach.accessToken, 'POST', multipart({
      bytes: Buffer.alloc(8 * 1024 * 1024 + 1), mimeType: 'application/pdf', filename: 'oversized.pdf',
    }))).status, 413);
    assert.deepEqual(await prisma.participantAccountMedia.findMany({ where: { accountId: coach.id }, orderBy: { type: 'asc' } }), beforeInvalid,
      'Rejected uploads must not change existing media');

    await prisma.participantAccount.update({ where: { id: coach.id }, data: { isActive: false } });
    for (const [route, method, body] of [
      ['/participant-auth/me', 'GET'], [coachAvatarPath, 'GET'],
      [coachAvatarPath, 'POST', multipart(descriptor('COACH', 'AVATAR', 4))],
    ]) assert.equal((await request(route, coach.accessToken, method, body)).status, 401, 'Existing tokens stop working when an account is disabled');
    assert.deepEqual(await prisma.participantAccountMedia.findMany({ where: { accountId: coach.id }, orderBy: { type: 'asc' } }), beforeInvalid);
    await noAthlete();
    const complete = await cmsList(adminToken, { profileStatus: 'COMPLETE' });
    assert.equal(complete.total, fixtures.length);
    assert.equal(complete.summary.complete, fixtures.length);
    assert.equal(complete.summary.incomplete, 0);
    assert.equal((await cmsList(adminToken, { profileStatus: 'INCOMPLETE' })).total, 0);
    console.log('PASS: HTTP own account portrait/CCCD/passport upload/read/replace for all five roles, OCR-off approval, CMS revisions/blobs, ownership/auth/inactive guards, size/signature validation and no persisted Athlete.');
  } finally {
    if (accountIds.length) {
      const remaining = await prisma.participantAccountMedia.findMany({ where: { accountId: { in: accountIds } }, select: { storageKey: true } });
      remaining.forEach((row) => { if (row.storageKey) storageKeys.add(row.storageKey); });
      await prisma.athlete.deleteMany({ where: { participantAccountId: { in: accountIds }, fullName: { startsWith: marker } } });
      await prisma.participantAccount.deleteMany({ where: { id: { in: accountIds }, displayName: { startsWith: marker } } });
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds }, name: marker } });
    if (countryId) await prisma.country.deleteMany({ where: { id: countryId, name: marker } });
    for (const key of storageKeys) await storage.deleteQuietly(key);
    await prisma.$disconnect();
    console.log('Exact temporary account-media fixtures and files removed.');
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
