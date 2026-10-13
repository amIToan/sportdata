// Run inside an isolated QA backend container only:
// node scripts/athletes-bulk-delete.integration.cjs --confirm-isolated-qa
// Creates and removes only its own marked fixtures; does not touch existing athletes.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid').pathname.slice(1);
if (!process.argv.includes('--confirm-isolated-qa') || !/^sportdata_.*_qa_[a-zA-Z0-9_]+$/.test(database)) {
  throw new Error('This regression requires an explicitly confirmed isolated SportData QA database');
}
if ((process.env.STORAGE_DRIVER || 'local') !== 'local') throw new Error('QA storage must be local');
const prisma = new PrismaClient();
const marker = `BulkQA${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const created = { users: [], athletes: [], accounts: [], country: null, sport: null, category: null, event: null, team: null };
const storageRoot = path.resolve(process.env.STORAGE_LOCAL_DIR || 'static/uploads');
const fixtureFolder = path.resolve(storageRoot, 'athletes', marker);
if (!fixtureFolder.startsWith(`${storageRoot}${path.sep}`)) throw new Error('QA file path is outside local storage');
const baseUrl = 'http://127.0.0.1:4000/api';
let token;

async function request(route, body, bearer = token) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function makeAthlete(name, extra = {}) {
  const athlete = await prisma.athlete.create({ data: {
    firstName: marker, lastName: name, fullName: `${marker}${name}`, gender: 'MALE', countryId: created.country,
    events: { connect: { id: created.event } }, categories: { connect: { id: created.category } },
    identity: { create: {} }, ...extra,
  } });
  created.athletes.push(athlete.id);
  return athlete;
}

async function run() {
  const anonymous = await request('/athletes/bulk-delete/preview', { filters: { search: marker } }, null);
  assert.equal(anonymous.status, 401, 'QA server must have the new authenticated routes loaded');
  for (const role of ['ADMIN', 'READ_ONLY']) {
    const user = await prisma.user.create({ data: { username: `${marker}-${role}`, email: `${marker}-${role}@test.invalid`,
      name: marker, password: 'qa-fixture-no-login', role } });
    created.users.push(user.id);
    const signed = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET || 'sportdata-dev-secret-change-me-please', { expiresIn: '10m' });
    if (role === 'ADMIN') token = signed;
    else {
      assert.equal((await request('/athletes/bulk-delete', { mode: 'SELECTED', ids: ['missing'] }, signed)).status, 403);
      assert.equal((await request('/athletes/bulk-delete/preview', { filters: {} }, signed)).status, 403);
    }
  }
  assert.equal((await request('/athletes/bulk-delete', { mode: 'SELECTED', ids: [] })).status, 400);
  assert.equal((await request('/athletes/bulk-delete', { mode: 'ALL_MATCHING', filters: {}, expectedCount: 1 })).status, 400);

  created.country = (await prisma.country.create({ data: { code: marker, name: marker } })).id;
  created.sport = (await prisma.sport.create({ data: { code: marker, name: marker } })).id;
  created.category = (await prisma.category.create({ data: { name: marker, sportId: created.sport, gender: 'MALE' } })).id;
  created.event = (await prisma.event.create({ data: { name: marker, sportId: created.sport,
    startDate: new Date('2026-10-13T00:00:00Z'), endDate: new Date('2026-10-14T00:00:00Z') } })).id;
  const account = await prisma.participantAccount.create({ data: { email: `${marker}@test.invalid`, password: 'qa-fixture-no-login', displayName: marker } });
  created.accounts.push(account.id);
  const selected = await makeAthlete('Selected', { participantAccountId: account.id });
  const protectedStats = await makeAthlete('ProtectedStats');
  const protectedTeam = await makeAthlete('ProtectedTeam');
  await prisma.statistic.create({ data: { athleteId: protectedStats.id, sportId: created.sport } });
  created.team = (await prisma.team.create({ data: { name: marker, sportId: created.sport, eventId: created.event, countryId: created.country } })).id;
  await prisma.teamMember.create({ data: { teamId: created.team, athleteId: protectedTeam.id } });
  await prisma.eventRegistration.create({ data: { athleteId: selected.id, eventId: created.event, categoryId: created.category,
    accountId: account.id, ticketCode: marker } });
  await fs.mkdir(fixtureFolder, { recursive: true });
  for (const athlete of [selected, protectedStats, protectedTeam]) {
    for (const type of ['AVATAR', 'PASSPORT']) {
      const relativeKey = `athletes/${marker}/${athlete.id}-${type}`;
      await fs.writeFile(path.resolve(storageRoot, relativeKey), Buffer.from('QA fixture'));
      await prisma.athleteMedia.create({ data: { athleteId: athlete.id, type, storageKey: `local:${relativeKey}`, mimeType: 'image/jpeg', size: 10 } });
    }
  }
  const selectedResult = await request('/athletes/bulk-delete', { mode: 'SELECTED',
    ids: [selected.id, protectedStats.id, protectedTeam.id, `${marker}-missing`, selected.id] });
  assert.equal(selectedResult.status, 200);
  assert.equal(selectedResult.body.requestedCount, 4);
  assert.equal(selectedResult.body.deletedCount, 1);
  assert.deepEqual(selectedResult.body.deletedIds, [selected.id]);
  assert.equal(selectedResult.body.deleted[0].fullName, selected.fullName);
  assert.equal(selectedResult.body.failed.length, 3);
  assert.ok(selectedResult.body.failed.every((entry) => entry.reason));
  assert.equal(await prisma.athlete.count({ where: { id: selected.id } }), 0);
  assert.equal(await prisma.athleteIdentity.count({ where: { athleteId: selected.id } }), 0);
  assert.equal(await prisma.athleteMedia.count({ where: { athleteId: selected.id } }), 0);
  assert.equal(await prisma.eventRegistration.count({ where: { athleteId: selected.id } }), 0);
  assert.equal(await prisma.participantAccount.count({ where: { id: account.id } }), 1);
  assert.equal(await prisma.athlete.count({ where: { id: { in: [protectedStats.id, protectedTeam.id] } } }), 2);
  for (const type of ['AVATAR', 'PASSPORT']) {
    await assert.rejects(fs.stat(path.resolve(fixtureFolder, `${selected.id}-${type}`)), { code: 'ENOENT' });
    await fs.stat(path.resolve(fixtureFolder, `${protectedStats.id}-${type}`));
  }

  const allMatching = [];
  for (let index = 0; index < 63; index++) allMatching.push(await makeAthlete(`All${index}`));
  const female = await makeAthlete('AllFemale', { gender: 'FEMALE' });
  const outside = await makeAthlete('Outside', { fullName: `${marker}OutsideScope` });
  const filters = { search: `${marker}All`, gender: 'MALE' };
  const list = await request(`/athletes?search=${filters.search}&gender=MALE&page=2&limit=30`);
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 63);
  assert.equal(list.body.items.length, 30);
  const stale = await request('/athletes/bulk-delete/preview', { filters });
  assert.equal(stale.status, 200);
  assert.equal(stale.body.total, 63);
  await prisma.athlete.update({ where: { id: allMatching[0].id }, data: { fullName: `${marker}AllChanged` } });
  assert.equal((await request('/athletes/bulk-delete', { mode: 'ALL_MATCHING', filters,
    expectedCount: stale.body.total, selectionToken: stale.body.selectionToken })).status, 409);
  assert.equal(await prisma.athlete.count({ where: { id: { in: allMatching.map((athlete) => athlete.id) } } }), 63);
  const preview = await request('/athletes/bulk-delete/preview', { filters });
  const allResult = await request('/athletes/bulk-delete', { mode: 'ALL_MATCHING', filters,
    expectedCount: preview.body.total, selectionToken: preview.body.selectionToken });
  assert.equal(allResult.status, 200);
  assert.equal(allResult.body.deletedCount, 63);
  assert.deepEqual(allResult.body.failed, []);
  assert.equal(await prisma.athlete.count({ where: { id: { in: allMatching.map((athlete) => athlete.id) } } }), 0);
  assert.equal(await prisma.athlete.count({ where: { id: { in: [female.id, outside.id, protectedStats.id, protectedTeam.id] } } }), 4);
  console.log('PASS: actual QA database/API auth, DTO validation, selected deletion, protected references, cascades, account preservation, storage cleanup, stale snapshots and deletion across 3 pages');
}

async function cleanup() {
  if (created.team) await prisma.team.deleteMany({ where: { id: created.team } });
  await prisma.statistic.deleteMany({ where: { athleteId: { in: created.athletes } } });
  await prisma.athlete.deleteMany({ where: { id: { in: created.athletes } } });
  await prisma.participantAccount.deleteMany({ where: { id: { in: created.accounts } } });
  if (created.event) await prisma.event.deleteMany({ where: { id: created.event } });
  if (created.category) await prisma.category.deleteMany({ where: { id: created.category } });
  if (created.sport) await prisma.sport.deleteMany({ where: { id: created.sport } });
  if (created.country) await prisma.country.deleteMany({ where: { id: created.country } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  await fs.rm(fixtureFolder, { recursive: true, force: true });
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  try { await cleanup(); } finally { await prisma.$disconnect(); }
});
