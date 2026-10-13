// Build first: npm run build:backend
// Run from repository root. Uses a disposable schema on LOCAL PostgreSQL only.
// Existing application data and accounts are never changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
require('reflect-metadata');
const { Client } = require('pg');
const { parse } = require('dotenv');
const { NestFactory } = require('@nestjs/core');
const { Module, ValidationPipe } = require('@nestjs/common');
const { ConfigModule } = require('@nestjs/config');
const bcrypt = require('bcrypt');
const { PrismaService } = require('./dist/src/prisma/prisma.service.js');
const { PrismaModule } = require('./dist/src/prisma/prisma.module.js');
const { AuthModule } = require('./dist/src/auth/auth.module.js');
const { MatchesModule } = require('./dist/src/matches/matches.module.js');
const { MatchesService } = require('./dist/src/matches/matches.service.js');
const { UsersModule } = require('./dist/src/users/users.module.js');
const { CompetitionsModule } = require('./dist/src/competitions/competitions.module.js');
const { ResultsModule } = require('./dist/src/results/results.module.js');

// Exercise arrangements independently of storage: all counts, modes and pair
// counts, with fixed pairs containing the highest seeded athletes.
const algorithm = new MatchesService({});
for (let count = 2; count <= 65; count++) {
  const size = 2 ** Math.ceil(Math.log2(count));
  const athletes = Array.from({ length: count }, (_, index) => ({
    id: `a${index}`, seed: index + 1, countryId: `c${index % 3}`, federationId: `f${index % 4}`,
  }));
  for (const mode of ['STANDARD', 'ORDERED', 'RANDOM', 'COUNTRY_SEPARATED', 'FEDERATION_SEPARATED']) {
    for (let pairCount = 0; pairCount <= count - size / 2; pairCount++) {
      const pairs = Array.from({ length: pairCount }, (_, index) => [`a${index * 2}`, `a${index * 2 + 1}`]);
      const slots = algorithm.placePreconfiguredPairs(athletes, size, mode, pairs);
      assert.equal(slots.length, size);
      assert.deepEqual(slots.filter(Boolean).map((athlete) => athlete.id).sort(), athletes.map((athlete) => athlete.id).sort());
      assert.equal(slots.filter((athlete) => !athlete).length, size - count);
      pairs.forEach(([first, second]) => {
        const position = slots.findIndex((athlete) => athlete?.id === first);
        assert.equal(slots[position ^ 1]?.id, second);
      });
      for (let index = 0; index < size; index += 2) assert.ok(slots[index] || slots[index + 1]);
    }
  }
}
console.log('PASS: arrangements for 2–65 athletes, five seeding modes, all feasible pair counts.');

const settings = parse(readFileSync(new URL('../../.env', import.meta.url)));
const sourceUrl = new URL(process.env.DATABASE_URL || settings.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(sourceUrl.hostname), 'Smoke test only supports local PostgreSQL');
const schema = `smoke_draw_${randomUUID().replaceAll('-', '')}`;
const control = new Client({ connectionString: sourceUrl.toString() });
const isolatedUrl = new URL(sourceUrl);
isolatedUrl.searchParams.set('schema', schema);
let app;
await control.connect();
try {
  await control.query(`CREATE SCHEMA "${schema}"`);
  process.env.DATABASE_URL = isolatedUrl.toString();
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  const migration = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'prisma', 'migrate', 'deploy', '--schema', fileURLToPath(new URL('../../apps/backend/prisma/schema.prisma', import.meta.url)),
  ], { env: process.env, encoding: 'utf8' });
  assert.equal(migration.status, 0, `Disposable-schema migration failed: ${migration.stderr.replaceAll(sourceUrl.toString(), '[redacted]')}`);

  class SmokeModule {}
  Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrismaModule, AuthModule, MatchesModule, CompetitionsModule, UsersModule, ResultsModule] })(SmokeModule);
  app = await NestFactory.create(SmokeModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;
  const prisma = app.get(PrismaService);
  async function api(path, token, body, method = body ? 'POST' : 'GET', expected = 200) {
    const response = await fetch(`${base}${path}`, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  }
  async function account(role = 'GAMES_ADMIN', permissions = []) {
    const password = randomBytes(24).toString('hex');
    const email = `${randomUUID()}@example.test`;
    const user = await prisma.user.create({ data: { email, name: 'Smoke user', password: await bcrypt.hash(password, 4), role, permissions } });
    const session = await api('/auth/login', null, { identifier: email, password }, 'POST', 201);
    return { ...user, token: session.accessToken };
  }
  const privileged = await account('ADMIN', ['DRAW_PRECONFIGURE']);
  const ordinary = await account();
  const admin = await account('ADMIN');
  assert.deepEqual((await api('/auth/profile', privileged.token)).permissions, ['DRAW_PRECONFIGURE']);
  const managerWithPermission = await account('GAMES_ADMIN', ['DRAW_PRECONFIGURE']);
  const content = await account('CONTENT');
  const viewer = await account('READ_ONLY');
  for (const role of ['SPORT_MANAGER', 'VENUE_OPERATOR', 'SCOREKEEPER', 'RESULT_APPROVER']) {
    await api('/users', admin.token, {
      name: 'Removed role', username: `removed.${role.toLowerCase()}`, email: `${randomUUID()}@example.test`,
      password: randomBytes(24).toString('hex'), role,
    }, 'POST', 400);
  }
  await api('/users', ordinary.token, null, 'GET', 403);
  await api('/results/matches/nonexistent/reopen', ordinary.token, { expectedVersion: 0, reason: 'Test' }, 'POST', 403);
  const sport = await prisma.sport.create({ data: { name: 'Smoke sport', code: 'SMOKE' } });
  const country = await prisma.country.create({ data: { name: 'Smoke country', code: 'ZZ' } });
  const category = await prisma.category.create({ data: { name: 'Smoke category', sportId: sport.id, gender: 'MIXED' } });
  async function fixture(count) {
    const event = await prisma.event.create({ data: { name: 'Smoke event', sportId: sport.id,
      startDate: new Date('2026-11-01'), endDate: new Date('2026-11-03'), categories: { connect: { id: category.id } } } });
    const entries = [];
    for (let index = 0; index < count; index++) {
      const athlete = await prisma.athlete.create({ data: { firstName: String.fromCharCode(65 + index), lastName: 'Smoke',
        fullName: String.fromCharCode(65 + index), countryId: country.id, gender: 'MALE',
        events: { connect: { id: event.id } }, categories: { connect: { id: category.id } } } });
      entries.push(await prisma.competitionEntry.create({ data: { eventId: event.id, categoryId: category.id,
        countryId: country.id, type: 'INDIVIDUAL', status: 'VERIFIED', athleteId: athlete.id, seed: index + 1 } }));
    }
    const path = `/matches/event/${event.id}/category/${category.id}`;
    const dto = { athleteIds: entries.map((entry) => entry.athleteId), type: 'MAIN_TREE', seedingMode: 'RANDOM' };
    return { event, entries, path, dto };
  }
  const fixtureA = await fixture(5);
  const { event, entries, path, dto } = fixtureA;
  const query = '?drawType=MAIN_TREE';
  const pairs = [{ entry1Id: entries[0].id, entry2Id: entries[2].id }];
  for (const caller of [content, viewer, ordinary, admin, managerWithPermission]) {
    for (const type of ['MAIN_TREE', 'DOUBLE_ELIMINATION', 'REPECHAGE', 'REPECHAGE_ROUND_OF_16', 'ROUND_ROBIN_POOL']) {
      await api(`${path}/preconfiguration?drawType=${type}`, caller.token, null, 'GET', 403);
      await api(`${path}/preconfiguration/history?drawType=${type}`, caller.token, null, 'GET', 403);
      await api(`${path}/preconfiguration`, caller.token, { drawType: type, pairs, revision: 0, seedingMode: 'RANDOM' }, 'PATCH', 403);
      await api(`${path}/preview-draw`, caller.token, { ...dto, type }, 'POST', 403);
    }
  }
  await api(`${path}/preconfiguration${query}`, null, null, 'GET', 401);
  await api(`${path}/preconfiguration${query}`, privileged.token);
  await api(`/users/${ordinary.id}`, admin.token, { permissions: ['DRAW_PRECONFIGURE'] }, 'PATCH', 400);
  console.log('PASS: Only ADMIN with DRAW_PRECONFIGURE can use configuration, preview and history; permissions cannot be granted to event managers.');

  await api(`${path}/preconfiguration`, privileged.token, { drawType: 'MAIN_TREE', pairs: [pairs[0], pairs[0]], revision: 0, seedingMode: 'RANDOM' }, 'PATCH', 400);
  await api(`${path}/preconfiguration`, privileged.token, { drawType: 'MAIN_TREE', pairs: [{ entry1Id: entries[0].id, entry2Id: 'foreign-entry' }], revision: 0, seedingMode: 'RANDOM' }, 'PATCH', 400);
  await api(`${path}/preconfiguration`, privileged.token, { drawType: 'MAIN_TREE', pairs: [pairs[0], { entry1Id: entries[1].id, entry2Id: entries[3].id }], revision: 0, seedingMode: 'RANDOM' }, 'PATCH', 400);
  let config = await api(`${path}/preconfiguration`, privileged.token, { drawType: 'MAIN_TREE', pairs, revision: 0, seedingMode: 'RANDOM' }, 'PATCH');
  await api(`${path}/generate-draw`, ordinary.token, dto, 'POST', 409);
  await api(`${path}/preconfiguration`, privileged.token, { drawType: 'MAIN_TREE', pairs: [], revision: 0, seedingMode: 'RANDOM' }, 'PATCH', 409);
  config = await api(`${path}/preview-draw`, privileged.token, { ...dto, revision: config.revision }, 'POST', 201);
  assert.equal(await prisma.draw.count({ where: { eventId: event.id } }), 0);
  assert.equal(await prisma.match.count({ where: { eventId: event.id } }), 0);
  assert.equal(config.preview[0].bracketSize, 8);
  assert.equal(config.preview[0].matches.filter((match) => match.round === 1 && match.status === 'FINISHED').length, 3);
  assert.equal((await api(`${path}/preconfiguration${query}`, privileged.token)).stale, false, 'JSONB key ordering must not invalidate fingerprints');
  const history = await api(`${path}/preconfiguration/history${query}`, privileged.token);
  assert.equal(history.length, 2);
  assert.ok(history.some((record) => record.action === 'PREVIEW' && record.snapshot.plan));
  await prisma.competitionEntry.update({ where: { id: entries[1].id }, data: { seed: 20 } });
  await api(`${path}/generate-draw`, ordinary.token, dto, 'POST', 409);
  assert.equal((await api(`${path}/preconfiguration${query}`, privileged.token)).stale, true);
  config = await api(`${path}/preview-draw`, privileged.token, { ...dto, revision: config.revision }, 'POST', 201);
  await prisma.athlete.update({ where: { id: entries[1].athleteId }, data: { federationId: null, weight: 70 } });
  await api(`${path}/generate-draw`, ordinary.token, dto, 'POST', 409);
  config = await api(`${path}/preview-draw`, privileged.token, { ...dto, revision: config.revision }, 'POST', 201);
  await prisma.competitionEntry.update({ where: { id: entries[4].id }, data: { status: 'WITHDRAWN' } });
  await api(`${path}/generate-draw`, ordinary.token, dto, 'POST', 409);
  await prisma.competitionEntry.update({ where: { id: entries[4].id }, data: { status: 'VERIFIED' } });
  await api(`${path}/generate-draw`, ordinary.token, dto, 'POST', 409);
  config = await api(`${path}/preview-draw`, privileged.token, { ...dto, revision: config.revision }, 'POST', 201);
  await prisma.category.update({ where: { id: category.id }, data: { matchDurationSeconds: 180 } });
  await api(`${path}/generate-draw`, ordinary.token, dto, 'POST', 409);
  config = await api(`${path}/preview-draw`, privileged.token, { ...dto, revision: config.revision }, 'POST', 201);
  console.log('PASS: preview writes no draws/matches; seeds, athlete edits, roster changes and category edits block stale generation.');

  const requests = await Promise.all(Array.from({ length: 4 }, () => fetch(`${base}${path}/generate-draw`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ordinary.token}` },
    body: JSON.stringify({ ...dto, seedingMode: 'STANDARD', name: 'Caller cannot override the saved plan' }),
  })));
  assert.equal(requests.filter((response) => response.status === 201).length, 1);
  assert.equal(requests.filter((response) => response.status === 409).length, 3);
  assert.equal(await prisma.draw.count({ where: { eventId: event.id } }), 1);
  const generated = await prisma.match.findMany({ where: { eventId: event.id } });
  for (const match of config.preview.flatMap((draw) => draw.matches)) {
    const actual = generated.find((candidate) => candidate.id === match.id);
    assert.ok(actual, 'Persist the preview match IDs and progression links');
    for (const key of ['athlete1Id', 'athlete2Id', 'winnerToMatchId', 'winnerToSide', 'loserToMatchId', 'loserToSide', 'round', 'bracketPosition', 'status', 'matchNumber']) {
      assert.equal(actual[key] ?? null, match[key] ?? null, key);
    }
  }
  assert.ok(generated.some((match) => match.round === 1 && match.athlete1Id === entries[0].athleteId && match.athlete2Id === entries[2].athleteId));
  const publicDraws = await api(`${path}/draws`, ordinary.token);
  for (const hiddenKey of ['entry1Id', 'entry2Id', 'inputVersion', 'revision', 'preconfiguration']) assert.ok(!JSON.stringify(publicDraws).includes(`"${hiddenKey}"`));
  console.log('PASS: A–C → preview → switch user → identical tree; one winner among four concurrent generation requests; normal API has no private data.');

  // Revert must ignore automatic byes, keep entries/configuration and require
  // a fresh preview before an ordinary operator can generate again.
  const revertState = await api(`${path}/draw-state`, ordinary.token);
  assert.equal(revertState.canRevert, true);
  const reader = await account('READ_ONLY');
  await api(`${path}/draw-state`, reader.token, null, 'GET', 403);
  await api(`${path}/revert-draw`, reader.token, { version: revertState.version }, 'POST', 403);
  await api(`${path}/revert-draw`, null, { version: revertState.version }, 'POST', 401);
  await api(`${path}/revert-draw`, ordinary.token, { version: 'old-draw' }, 'POST', 409);
  const reverts = await Promise.all(Array.from({ length: 3 }, () => fetch(`${base}${path}/revert-draw`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ordinary.token}` },
    body: JSON.stringify({ version: revertState.version }),
  })));
  assert.equal(reverts.filter((response) => response.status === 201).length, 1);
  assert.equal(reverts.filter((response) => response.status === 409).length, 2, JSON.stringify(await Promise.all(reverts.map(async (response) => ({ status: response.status, body: await response.clone().json() })))));
  assert.equal(await prisma.draw.count({ where: { eventId: event.id } }), 0);
  assert.equal(await prisma.match.count({ where: { eventId: event.id } }), 0);
  assert.equal(await prisma.competitionEntry.count({ where: { eventId: event.id } }), 5);
  assert.equal((await prisma.competitionEntry.findUnique({ where: { id: entries[1].id } })).seed, 20);
  const revertedConfig = await api(`${path}/preconfiguration${query}`, privileged.token);
  assert.deepEqual(revertedConfig.pairs, pairs);
  assert.equal(revertedConfig.stale, true);
  assert.ok(revertedConfig.revision > config.revision);
  assert.equal(await prisma.auditLog.count({ where: { action: 'REVERT_DRAW', entityId: category.id } }), 1);
  assert.ok((await api(`${path}/preconfiguration/history${query}`, privileged.token)).some((record) => record.action === 'REVERT'));
  await api(`${path}/generate-draw`, ordinary.token, dto, 'POST', 409);
  await api(`/competitions/entries/${entries[0].id}/seed`, ordinary.token, { seed: 11 }, 'PATCH');
  await api(`/competitions/entries/${entries[4].id}/seed`, ordinary.token, { seed: 1 }, 'PATCH');
  config = await api(`${path}/preview-draw`, privileged.token, { ...dto, revision: revertedConfig.revision }, 'POST', 201);
  await api(`${path}/generate-draw`, ordinary.token, dto, 'POST', 201);
  await assertPersistedPlan(fixtureA, config);
  await api(`${path}/revert-draw`, ordinary.token, { version: revertState.version }, 'POST', 409);
  console.log('PASS: revert byes, preserve roster/seeds/pairs and audit history, edit seed, preview and regenerate; stale/concurrent reverts are rejected.');

  const double = await fixture(6);
  const doubleDto = { ...double.dto, type: 'DOUBLE_ELIMINATION' };
  const doublePairs = [{ entry1Id: double.entries[0].id, entry2Id: double.entries[2].id }];
  let doubleConfig = await api(`${double.path}/preconfiguration`, privileged.token, { drawType: 'DOUBLE_ELIMINATION', pairs: doublePairs, seedingMode: 'COUNTRY_SEPARATED', revision: 0 }, 'PATCH');
  doubleConfig = await api(`${double.path}/preview-draw`, privileged.token, { ...doubleDto, seedingMode: 'COUNTRY_SEPARATED', revision: doubleConfig.revision }, 'POST', 201);
  assert.equal(doubleConfig.preview.length, 2);
  assert.ok(doubleConfig.preview[0].matches.some((match) => match.loserToMatchId));
  await api(`${double.path}/generate-draw`, ordinary.token, doubleDto, 'POST', 201);
  const doubleMatches = await prisma.match.findMany({ where: { eventId: double.event.id } });
  assert.equal(doubleMatches.length, doubleConfig.preview.flatMap((draw) => draw.matches).length);
  for (const match of doubleConfig.preview.flatMap((draw) => draw.matches)) {
    const actual = doubleMatches.find((candidate) => candidate.id === match.id);
    assert.equal(actual.winnerToMatchId ?? null, match.winnerToMatchId ?? null);
    assert.equal(actual.loserToMatchId ?? null, match.loserToMatchId ?? null);
  }

  async function assertPersistedPlan(fixture, config) {
    const actual = await prisma.match.findMany({ where: { eventId: fixture.event.id } });
    const planned = config.preview.flatMap((draw) => draw.matches);
    assert.equal(actual.length, planned.length);
    for (const match of planned) {
      const saved = actual.find((candidate) => candidate.id === match.id);
      assert.ok(saved);
      for (const key of ['athlete1Id', 'athlete2Id', 'winnerToMatchId', 'winnerToSide', 'loserToMatchId', 'loserToSide', 'round', 'bracketPosition', 'status', 'matchNumber', 'roundRobinGroupId']) {
        assert.equal(saved[key] ?? null, match[key] ?? null, key);
      }
    }
  }
  for (const type of ['REPECHAGE', 'REPECHAGE_ROUND_OF_16']) for (const count of [6, 16, 32]) {
    const repechage = await fixture(count);
    const fixed = [{ entry1Id: repechage.entries[0].id, entry2Id: repechage.entries[2].id }];
    // Configurations for other rules must not interfere with this rule's preview/generation.
    await api(`${repechage.path}/preconfiguration`, privileged.token, { drawType: 'MAIN_TREE', pairs: [], seedingMode: 'STANDARD', revision: 0 }, 'PATCH');
    let config = await api(`${repechage.path}/preconfiguration`, privileged.token, { drawType: type, pairs: fixed, seedingMode: 'RANDOM', revision: 0 }, 'PATCH');
    const request = { ...repechage.dto, type, revision: config.revision };
    config = await api(`${repechage.path}/preview-draw`, privileged.token, request, 'POST', 201);
    assert.equal(config.preview.length, 2);
    assert.equal(config.preview[1].type, type);
    assert.equal(config.preview[1].matches.filter((match) => match.notes?.startsWith('Generated repechage bronze medal')).length, 2);
    assert.ok(config.preview[0].matches.some((match) => match.round === 1 && match.athlete1Id === repechage.entries[0].athleteId && match.athlete2Id === repechage.entries[2].athleteId));
    assert.equal(await prisma.draw.count({ where: { eventId: repechage.event.id } }), 0);
    assert.equal((await api(`${repechage.path}/preconfiguration?drawType=${type}`, privileged.token)).stale, false);
    assert.equal((await api(`${repechage.path}/preconfiguration/history?drawType=${type}`, privileged.token)).length, 2);
    await api(`${repechage.path}/generate-draw`, ordinary.token, request, 'POST', 201);
    await assertPersistedPlan(repechage, config);
  }
  console.log('PASS: Both Repechage formats with 6/16/32 athletes previews both bronze paths, keeps fixed pairs and persists the exact plan independently of other rules.');

  for (const [count, type, groupCount] of [[2, 'ROUND_ROBIN_POOL', 1], [5, 'ROUND_ROBIN_POOL', 1], [6, 'ROUND_ROBIN_POOL', 2], [16, 'ROUND_ROBIN_POOL', 3], [5, 'REPECHAGE', 1], [5, 'REPECHAGE_ROUND_OF_16', 1]]) {
    const robin = await fixture(count);
    const fixed = Array.from({ length: Math.min(2, Math.floor(count / 2)) }, (_, index) => ({ entry1Id: robin.entries[index * 2].id, entry2Id: robin.entries[index * 2 + 1].id }));
    let config = await api(`${robin.path}/preconfiguration`, privileged.token, { drawType: type, pairs: fixed, groupCount, seedingMode: 'RANDOM', revision: 0 }, 'PATCH');
    const request = { ...robin.dto, type, groupCount, revision: config.revision };
    await api(`${robin.path}/generate-draw`, ordinary.token, request, 'POST', 409);
    config = await api(`${robin.path}/preview-draw`, privileged.token, request, 'POST', 201);
    assert.equal(config.preview.length, groupCount);
    assert.ok(config.preview.every((draw) => draw.type === 'ROUND_ROBIN_POOL'));
    assert.equal(await prisma.roundRobinGroup.count({ where: { eventId: robin.event.id } }), 0);
    assert.equal(await prisma.match.count({ where: { eventId: robin.event.id } }), 0);
    const planned = config.preview.flatMap((draw) => draw.matches);
    for (const pair of fixed) {
      const first = robin.entries.find((entry) => entry.id === pair.entry1Id).athleteId;
      const second = robin.entries.find((entry) => entry.id === pair.entry2Id).athleteId;
      assert.ok(planned.some((match) => match.round === 1 && match.athlete1Id === first && match.athlete2Id === second));
    }
    for (const draw of config.preview) {
      const opponents = new Set(draw.matches.map((match) => [match.athlete1Id, match.athlete2Id].sort().join(':')));
      assert.equal(opponents.size, draw.bracketSize * (draw.bracketSize - 1) / 2);
      assert.equal(draw.matches.length, opponents.size);
      for (const round of new Set(draw.matches.map((match) => match.round))) {
        const athletes = draw.matches.filter((match) => match.round === round).flatMap((match) => [match.athlete1Id, match.athlete2Id]);
        assert.equal(new Set(athletes).size, athletes.length, 'Each athlete plays at most once per round');
      }
    }
    if (count === 6) {
      await prisma.competitionEntry.update({ where: { id: robin.entries[0].id }, data: { seed: 99 } });
      const legacyPath = `/competitions/events/${robin.event.id}/categories/${category.id}/round-robin/generate`;
      await api(legacyPath, ordinary.token, { entryIds: robin.entries.map((entry) => entry.id), groupCount }, 'POST', 409);
      config = await api(`${robin.path}/preview-draw`, privileged.token, { ...request, revision: config.revision }, 'POST', 201);
      await api(legacyPath, ordinary.token, { entryIds: robin.entries.map((entry) => entry.id), groupCount: 1 }, 'POST', 201);
    } else {
      await api(`${robin.path}/generate-draw`, ordinary.token, { ...request, groupCount: 1 }, 'POST', 201);
    }
    await assertPersistedPlan(robin, config);
    const groups = await prisma.roundRobinGroup.findMany({ where: { eventId: robin.event.id }, include: { members: true } });
    assert.equal(groups.length, groupCount);
    assert.equal(groups.flatMap((group) => group.members).length, count);
    assert.equal(await prisma.matchParticipant.count({ where: { match: { eventId: robin.event.id } } }), planned.length * 2);
    const state = await api(`${robin.path}/draw-state`, ordinary.token);
    assert.equal(state.canRevert, true);
    await api(`${robin.path}/revert-draw`, ordinary.token, { version: state.version }, 'POST', 201);
    assert.equal(await prisma.roundRobinGroup.count({ where: { eventId: robin.event.id } }), 0);
    assert.equal(await prisma.matchParticipant.count({ where: { matchId: { in: planned.map((match) => match.id) } } }), 0);
    assert.equal(await prisma.roundRobinGroupMember.count({ where: { groupId: { in: groups.map((group) => group.id) } } }), 0);
    assert.equal(await prisma.competitionEntry.count({ where: { eventId: robin.event.id } }), count);
  }
  const absolute = await fixture(3);
  const absoluteRequest = { ...absolute.dto, name: 'Hạng Tuyệt đối' };
  const absoluteConfig = await api(`${absolute.path}/preview-draw`, privileged.token, absoluteRequest, 'POST', 201);
  await api(`${absolute.path}/generate-draw`, ordinary.token, absoluteRequest, 'POST', 201);
  await assertPersistedPlan(absolute, absoluteConfig);
  assert.equal(absoluteConfig.preview[0].name, 'Hạng Tuyệt đối');
  console.log('PASS: round-robin fixed pairs in round 1, all unique opponents, balanced groups, stale legacy endpoint protection, Repechage under 6 and Open Weight.');
  // Revocation applies to an already-issued JWT, because permissions are read
  // from the database for every request.
  await prisma.user.update({ where: { id: privileged.id }, data: { permissions: [] } });
  await api(`${path}/preconfiguration${query}`, privileged.token, null, 'GET', 403);
  await api(`/users/${ordinary.id}`, ordinary.token, { permissions: ['DRAW_PRECONFIGURE'] }, 'PATCH', 403);
  await api(`/users/${privileged.id}`, admin.token, { permissions: ['DRAW_PRECONFIGURE'] }, 'PATCH');
  await api(`${path}/preconfiguration${query}`, privileged.token);
  const legacy = await fixture(3);
  await api(`${legacy.path}/generate-draw`, ordinary.token, { ...legacy.dto, fops: ['New FOP'] }, 'POST', 201);
  assert.equal(await prisma.fop.count({ where: { eventId: legacy.event.id, name: 'New FOP' } }), 1);
  const numbered = await fixture(3);
  const existingMatch = { eventId: numbered.event.id, categoryId: category.id, matchDate: numbered.event.startDate };
  await prisma.match.create({ data: { ...existingMatch, matchNumber: 50 } });
  let numberedConfig = await api(`${numbered.path}/preview-draw`, privileged.token, { ...numbered.dto, revision: 0 }, 'POST', 201);
  assert.equal(numberedConfig.preview[0].matches[0].matchNumber, 51);
  await prisma.match.create({ data: { ...existingMatch, matchNumber: 51 } });
  await api(`${numbered.path}/generate-draw`, ordinary.token, numbered.dto, 'POST', 409);
  numberedConfig = await api(`${numbered.path}/preview-draw`, privileged.token, { ...numbered.dto, revision: numberedConfig.revision }, 'POST', 201);
  await api(`${numbered.path}/generate-draw`, ordinary.token, numbered.dto, 'POST', 201);
  for (const match of numberedConfig.preview[0].matches) {
    assert.equal((await prisma.match.findUnique({ where: { id: match.id } })).matchNumber, match.matchNumber);
  }
  console.log('PASS: preview match numbers are retained; an occupied number range requires a new preview.');
  console.log('PASS: permission grants require ADMIN; categories without preconfiguration retain automatic generation and FOP creation.');

  const assertSeedTree = (matches, athleteIds) => {
    const byId = new Map(matches.map((match) => [match.id, match]));
    const paths = athleteIds.map((id) => {
      let match = matches.find((item) => item.round === 1 && [item.athlete1Id, item.athlete2Id].includes(id));
      const path = [];
      while (match) {
        path.push(match);
        match = byId.get(match.winnerToMatchId);
      }
      return path;
    });
    assert.equal(paths[0].find((match) => paths[1].some((other) => other.id === match.id)).round, 3);
    for (let first = 0; first < 4; first += 1) {
      for (let second = first + 1; second < 4; second += 1) {
        assert.ok(paths[first].find((match) => paths[second].some((other) => other.id === match.id)).round >= 2);
      }
    }
  };
  for (const mode of ['STANDARD', 'ORDERED', 'RANDOM', 'COUNTRY_SEPARATED', 'FEDERATION_SEPARATED']) {
    const seeded = await fixture(8);
    const request = { ...seeded.dto, athleteIds: [...seeded.dto.athleteIds].reverse(), seedingMode: mode };
    // Both direct generation and preview→ordinary operator must use the same
    // seeded progression, regardless of caller order or mode overrides.
    await api(`${seeded.path}/generate-draw`, ordinary.token, request, 'POST', 201);
    const actual = await prisma.match.findMany({ where: { eventId: seeded.event.id } });
    assertSeedTree(actual, seeded.dto.athleteIds);
    const state = await api(`${seeded.path}/draw-state`, ordinary.token);
    await api(`${seeded.path}/revert-draw`, ordinary.token, { version: state.version }, 'POST', 201);
    const preview = await api(`${seeded.path}/preview-draw`, privileged.token, { ...request, revision: 0 }, 'POST', 201);
    assertSeedTree(preview.preview[0].matches, seeded.dto.athleteIds);
    await api(`${seeded.path}/generate-draw`, ordinary.token, { ...request, seedingMode: 'RANDOM' }, 'POST', 201);
    const saved = await prisma.match.findMany({ where: { eventId: seeded.event.id } });
    assertSeedTree(saved, seeded.dto.athleteIds);
    assert.deepEqual(saved.map((match) => match.id).sort(), preview.preview[0].matches.map((match) => match.id).sort());
  }
  console.log('PASS: actual match progression separates seed 1/2 until the final and top four until semifinals in all modes, both directly and through persisted previews.');
  const doubleState = await api(`${double.path}/draw-state`, ordinary.token);
  assert.equal(doubleState.canRevert, true);
  await api(`${double.path}/revert-draw`, ordinary.token, { version: doubleState.version }, 'POST', 201);
  assert.equal(await prisma.draw.count({ where: { eventId: double.event.id } }), 0);
  assert.equal(await prisma.match.count({ where: { eventId: double.event.id } }), 0);

  async function scoreboardFixture() {
    const current = await fixture(4);
    const now = new Date();
    await prisma.event.update({ where: { id: current.event.id }, data: {
      startDate: new Date(now.getTime() - 86400000), endDate: new Date(now.getTime() + 86400000),
    } });
    await api(`${current.path}/generate-draw`, ordinary.token, current.dto, 'POST', 201);
    const fop = await prisma.fop.create({ data: { eventId: current.event.id, name: 'Revert smoke FOP' } });
    const match = await prisma.match.findFirst({ where: { eventId: current.event.id, round: 1 } });
    await prisma.match.update({ where: { id: match.id }, data: { fopId: fop.id, fop: fop.name,
      matchDate: now, startTime: new Date(now.getTime() - 60000), endTime: new Date(now.getTime() + 600000) } });
    const board = `/results/matches/${match.id}/scoreboard`;
    const clientId = `revert-smoke-${randomUUID()}`;
    await api(`${board}/claim`, ordinary.token, { clientId }, 'POST', 201);
    return { ...current, board, clientId, match };
  }
  const playing = await scoreboardFixture();
  let state = await api(`${playing.path}/draw-state`, ordinary.token);
  assert.equal(state.canRevert, true, 'Claiming a scoreboard and assigning a schedule must not count as starting');
  await api(playing.board, ordinary.token, { action: 'START', clientId: playing.clientId, expectedVersion: 0 }, 'POST', 201);
  assert.equal((await api(`${playing.path}/draw-state`, ordinary.token)).canRevert, false);
  await api(`${playing.path}/revert-draw`, ordinary.token, { version: state.version }, 'POST', 409);
  await api(playing.board, ordinary.token, { action: 'PAUSE', clientId: playing.clientId, expectedVersion: 1 }, 'POST', 201);
  await api(`${playing.path}/revert-draw`, ordinary.token, { version: state.version }, 'POST', 409);
  await api(playing.board, ordinary.token, { action: 'FINISH', clientId: playing.clientId, expectedVersion: 2,
    winnerId: playing.match.athlete1Id, winMethod: 'DECISION' }, 'POST', 201);
  await api(`${playing.path}/revert-draw`, ordinary.token, { version: state.version }, 'POST', 409);
  await prisma.match.update({ where: { id: playing.match.id }, data: { status: 'SCHEDULED', resultStatus: 'DRAFT' } });
  await api(`${playing.path}/revert-draw`, ordinary.token, { version: state.version }, 'POST', 409);
  assert.equal(await prisma.draw.count({ where: { eventId: playing.event.id } }), 1);

  // A started event/category elsewhere must not prohibit reverting this category.
  const untouched = await fixture(3);
  await api(`${untouched.path}/generate-draw`, ordinary.token, untouched.dto, 'POST', 201);
  const manual = await prisma.match.create({ data: { eventId: untouched.event.id, categoryId: category.id,
    matchDate: untouched.event.startDate, notes: 'Standalone match is preserved' } });
  state = await api(`${untouched.path}/draw-state`, ordinary.token);
  await api(`${untouched.path}/revert-draw`, ordinary.token, { version: state.version }, 'POST', 201);
  assert.ok(await prisma.match.findUnique({ where: { id: manual.id } }));
  assert.equal(await prisma.match.count({ where: { eventId: playing.event.id } }), 3);

  for (let attempt = 0; attempt < 3; attempt++) {
    const race = await scoreboardFixture();
    const state = await api(`${race.path}/draw-state`, ordinary.token);
    const [start, revert] = await Promise.all([
      fetch(`${base}${race.board}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ordinary.token}` },
        body: JSON.stringify({ action: 'START', expectedVersion: 0, clientId: race.clientId }) }),
      fetch(`${base}${race.path}/revert-draw`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ordinary.token}` },
        body: JSON.stringify({ version: state.version }) }),
    ]);
    if (start.status === 201) {
      assert.equal(revert.status, 409);
      assert.equal(await prisma.match.count({ where: { eventId: race.event.id } }), 3);
      assert.equal((await prisma.match.findUnique({ where: { id: race.match.id } })).status, 'RUNNING');
    } else {
      assert.equal(revert.status, 201);
      assert.equal(start.status, 404);
      assert.equal(await prisma.match.count({ where: { eventId: race.event.id } }), 0);
    }
  }
  console.log('PASS: scheduled/claimed matches can revert; started, paused, completed or reopened matches cannot; standalone matches survive; START/revert races retain started matches.');
  console.log('PASS: double-elimination preview/generation and immediate permission revocation.');
} finally {
  if (app) await app.close();
  await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.end();
}
