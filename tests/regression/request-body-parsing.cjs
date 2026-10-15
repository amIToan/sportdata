// Build first: npm run build:backend
// HTTP regression using the production application setup; no database required.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const backendRequire = createRequire(require('node:path').resolve('apps/backend/package.json'));
backendRequire('reflect-metadata');
const { NestFactory } = backendRequire('@nestjs/core');
const { Module, Controller, Post, Body, Req } = backendRequire('@nestjs/common');
const { configureApplication } = backendRequire('./dist/src/create-application');
const { PreviewDrawDto } = backendRequire('./dist/src/matches/dto/draw-preconfiguration.dto');
const { CheckAthleteIdentityDto } = backendRequire('./dist/src/participants/dto/check-athlete-identity.dto');

class ProbeController {
  preview(dto) { return dto; }
  identity(dto) { return dto; }
  certificate(body) { return { length: body.text.length }; }
  upload(request) { return { raw: Buffer.isBuffer(request.body), length: request.body.length }; }
}
Controller()(ProbeController);
for (const [method, path, dto] of [
  ['preview', 'matches/event/test/category/test/preview-draw', PreviewDrawDto],
  ['identity', 'participant-auth/identity/check', CheckAthleteIdentityDto],
  ['certificate', 'events/test/certificates', Object],
  ['upload', 'system-backup/import/uploads', Object],
]) {
  Post(path)(ProbeController.prototype, method, Object.getOwnPropertyDescriptor(ProbeController.prototype, method));
  (method === 'upload' ? Req() : Body())(ProbeController.prototype, method, 0);
  Reflect.defineMetadata('design:paramtypes', [dto], ProbeController.prototype, method);
}
class ProbeModule {}
Module({ controllers: [ProbeController] })(ProbeModule);

(async () => {
  const app = await NestFactory.create(ProbeModule, { logger: false });
  try {
    await configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    async function post(path, body, expectedStatus = 201, type = 'application/json') {
      const response = await fetch(`${base}/api/${path}`, {
        method: 'POST', headers: { 'Content-Type': type },
        body: type === 'application/json' ? JSON.stringify(body) : body,
      });
      const result = await response.json();
      assert.equal(response.status, expectedStatus, JSON.stringify(result));
      return result;
    }
    const draw = { athleteIds: ['a1', 'a2', 'a3', 'a4', 'a5'], type: 'REPECHAGE_QUARTERFINALS', revision: 0 };
    assert.deepEqual((await post('matches/event/test/category/test/preview-draw', draw)).athleteIds, draw.athleteIds);
    const identity = { fullName: 'Nguyễn Văn An', gender: 'MALE', countryId: 'vn', birthDate: '2000-01-01' };
    assert.deepEqual(await post('participant-auth/identity/check', identity), identity);
    await post('participant-auth/identity/check', {}, 400);
    await post('matches/event/test/category/test/preview-draw', { athleteIds: ['a1', 'a1'] }, 400);
    assert.equal((await post('events/test/certificates', { text: 'x'.repeat(200_000) })).length, 200_000);
    await post('participant-auth/identity/check', { ...identity, text: 'x'.repeat(200_000) }, 413);
    assert.deepEqual(await post('system-backup/import/uploads', Buffer.from('backup'), 201, 'application/octet-stream'), { raw: true, length: 6 });
    console.log('PASS: draw preview, identity validation, certificate limit, default limit and raw uploads');
  } finally {
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
