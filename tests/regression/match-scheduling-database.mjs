// Build first. Uses a disposable schema on LOCAL PostgreSQL only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
require('reflect-metadata');
const { Client } = require('pg');
const { parse } = require('dotenv');
const { NestFactory } = require('@nestjs/core');
const { Module, ValidationPipe } = require('@nestjs/common');
const { ConfigModule } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const { PrismaService } = require('./dist/src/prisma/prisma.service.js');
const { PrismaModule } = require('./dist/src/prisma/prisma.module.js');
const { AuthModule } = require('./dist/src/auth/auth.module.js');
const { SchedulingModule } = require('./dist/src/scheduling/scheduling.module.js');
const { SchedulePlansService } = require('./dist/src/scheduling/schedule-plans.service.js');
const { MatchesService } = require('./dist/src/matches/matches.service.js');
const { ResultsModule } = require('./dist/src/results/results.module.js');
const { CompetitionsService } = require('./dist/src/competitions/competitions.service.js');
const { EventsService } = require('./dist/src/events/events.service.js');
const { contentGroupKey } = require('./dist/src/scheduling/planner/main-tree.js');
const { semanticStages } = require('./dist/src/scheduling/planner/snapshot-planner.js');
const { PublicEventStreamInterceptor } = require('./dist/src/matches/public-event-stream.interceptor.js');
const { firstValueFrom, of, throwError } = require('rxjs');
const settings = parse(readFileSync(new URL('../../.env', import.meta.url)));
const sourceUrl = new URL(process.env.DATABASE_URL || settings.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(sourceUrl.hostname), 'Local database required');
const schema = `schedule_test_${randomUUID().replaceAll('-', '')}`;
const url = new URL(sourceUrl); url.searchParams.set('schema', schema);
const control = new Client({ connectionString: sourceUrl.toString() });
let app;
const migrationRoot = mkdtempSync(join(tmpdir(), 'sportdata-schedule-migrations-'));
await control.connect();
try {
  await control.query(`CREATE SCHEMA "${schema}"`);
  process.env.DATABASE_URL = url.toString();
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  // Git does not track empty directories. A local leftover migration directory
  // must not prevent testing exactly the SQL files present in the checkout.
  const prismaRoot = fileURLToPath(new URL('../../apps/backend/prisma/', import.meta.url));
  copyFileSync(join(prismaRoot, 'schema.prisma'), join(migrationRoot, 'schema.prisma'));
  mkdirSync(join(migrationRoot, 'migrations'));
  for (const entry of readdirSync(join(prismaRoot, 'migrations'), { withFileTypes: true })) {
    if (entry.isFile()) { copyFileSync(join(prismaRoot, 'migrations', entry.name), join(migrationRoot, 'migrations', entry.name)); continue; }
    const files = readdirSync(join(prismaRoot, 'migrations', entry.name));
    if (!files.length) { console.log(`Ignoring untracked empty directory: ${entry.name}`); continue; }
    assert.ok(files.includes('migration.sql'), `Nonempty migration ${entry.name} is missing SQL`);
    mkdirSync(join(migrationRoot, 'migrations', entry.name));
    copyFileSync(join(prismaRoot, 'migrations', entry.name, 'migration.sql'), join(migrationRoot, 'migrations', entry.name, 'migration.sql'));
  }
  const migration = spawnSync(fileURLToPath(new URL('../../node_modules/.bin/prisma', import.meta.url)), [
    'migrate', 'deploy', '--schema', join(migrationRoot, 'schema.prisma'),
  ], { env: process.env, encoding: 'utf8' });
  assert.equal(migration.status, 0, `Migration failed: ${migration.stderr.replaceAll(sourceUrl.toString(), '[redacted]')}`);
  class TestModule {}
  Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrismaModule, AuthModule, SchedulingModule, ResultsModule] })(TestModule);
  app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const db = app.get(PrismaService);
  const plans = app.get(SchedulePlansService);
  const generator = new MatchesService(db);
  const actor = await db.user.create({ data: { name: 'Test admin', email: 'admin@example.test', password: 'disabled', role: 'GAMES_ADMIN' } });
  const viewer = await db.user.create({ data: { name: 'Test reader', email: 'reader@example.test', password: 'disabled', role: 'READ_ONLY' } });
  const token = (user) => app.get(JwtService).sign({ sub: user.id, email: user.email });
  const base = `${await app.getUrl()}/api`;
  const sport = await db.sport.create({ data: { name: 'Test Jujitsu', code: 'SCHEDULE_TEST' } });
  const country = await db.country.create({ data: { name: 'Test', code: 'ZZ' } });
  async function fixture(count = 8, discipline = 'NEWAZA', type = 'MAIN_TREE', reuse, sharedAthlete, gender = 'MALE') {
    const category = await db.category.create({ data: { name: `Test ${randomUUID()}`, sportId: sport.id, gender,
      discipline, uniform: 'GI', maxWeight: 56, matchDurationSeconds: 300 } });
    const event = reuse?.event || await db.event.create({ data: { name: 'Schedule integration', sportId: sport.id,
      startDate: new Date('2026-10-11T00:00:00+07:00'), endDate: new Date('2026-10-13T00:00:00+07:00'), categories: { connect: { id: category.id } } } });
    if (reuse) await db.event.update({ where: { id: event.id }, data: { categories: { connect: { id: category.id } } } });
    const fops = reuse?.fops || await Promise.all([1, 2].map((n) => db.fop.create({ data: { name: `Thảm ${n}`, eventId: event.id } })));
    if (!reuse) await db.sportSchedulingRule.create({ data: { eventId: event.id, sportId: sport.id, matchDurationMinutes: 5, turnaroundMinutes: 0, minRestMinutes: 0 } });
    const athletes = [];
    for (let i = 0; i < count; i++) {
      const athlete = i === 0 && sharedAthlete ? sharedAthlete : await db.athlete.create({ data: { firstName: `${i}`, lastName: 'Test', fullName: `VĐV ${i}`, gender, countryId: country.id } });
      await db.competitionEntry.create({ data: { eventId: event.id, categoryId: category.id, type: 'INDIVIDUAL', status: 'VERIFIED', athleteId: athlete.id, countryId: country.id } });
      athletes.push(athlete);
    }
    const generated = generator.buildDrawPlan(await generator.loadDrawInput(db, event.id, category.id), {
      type, athleteIds: athletes.map((athlete) => athlete.id), seedingMode: 'STANDARD',
    }, []);
    for (const draw of generated.draws) await db.draw.create({ data: { ...draw, eventId: event.id, categoryId: category.id } });
    for (const group of generated.groups) await db.roundRobinGroup.create({ data: {
      id: group.id, eventId: event.id, categoryId: category.id, name: group.name,
      members: { create: group.members },
    } });
    // The FK targets must exist before progression edges are attached.
    for (const match of generated.matches) {
      const { winnerToMatchId, loserToMatchId, ...data } = match;
      await db.match.create({ data });
    }
    for (const match of generated.matches) if (match.winnerToMatchId || match.loserToMatchId) {
      await db.match.update({ where: { id: match.id }, data: { winnerToMatchId: match.winnerToMatchId, loserToMatchId: match.loserToMatchId } });
    }
    const config = { schemaVersion: 1, name: 'Lịch thử', timezone: 'Asia/Ho_Chi_Minh', autoContinue: true,
      windows: ['11', '12', '13'].map((day) => ({ id: `window-${day}`, localDate: `2026-10-${day}`, fopId: fops[0].id,
        startLocalTime: '09:00', endLocalTime: day === '11' ? '09:10' : '18:00', enabled: true, breaks: [] })),
      blocks: [{ id: 'block', groupKey: contentGroupKey(category), categoryIds: [category.id], estimatedDurationSeconds: 300, turnaroundSeconds: 0 }],
      matchOrders: [], earliestStarts: [], pinnedStarts: [] };
    return { event, category, fops, athletes, generated, config };
  }
  async function draft(f, config = f.config) { return plans.create(f.event.id, actor.id, { config, expectedDraftVersion: 0, idempotencyKey: randomUUID() }); }
  async function preview(f, plan, config = f.config) { return plans.preview(f.event.id, plan.id, actor.id, { config, expectedDraftVersion: plan.draftVersion }); }
  const payload = (proposal) => ({ previewId: proposal.previewId, draftVersion: proposal.draftVersion,
    expectedAppliedRevision: proposal.expectedAppliedRevision, idempotencyKey: randomUUID(), acknowledgeWarnings: true });
  const apply = (f, plan, proposal, request = payload(proposal)) => plans.apply(f.event.id, plan.id, actor.id, request);
  const f = await fixture();
  const plan = await draft(f);
  const first = await preview(f, plan);
  assert.equal(first.canApply, true, JSON.stringify(first.violations));
  assert.equal(first.assignments.length, 7);
  assert.equal(await db.match.count({ where: { eventId: f.event.id, startTime: { not: null } } }), 0, 'preview does not project Match');
  assert.equal((await plans.overview(f.event.id)).segments.length, 0, 'draft does not reserve a mat');
  const request = payload(first);
  const applied = await apply(f, plan, first, request);
  assert.deepEqual(await apply(f, plan, first, request), applied, 'network retry is idempotent');
  await assert.rejects(apply(f, plan, first, { ...request, acknowledgeWarnings: false }), /nội dung khác/);
  assert.equal(await db.matchScheduleItem.count(), 7);
  assert.equal((await plans.overview(f.event.id)).segments.length, 2);
  const summary = await generator.findScheduleSummary(f.event.id);
  assert.deepEqual(summary.dates, ['2026-10-11', '2026-10-12'].map((date) => ({ date, count: first.assignments.filter((item) => item.localDate === date).length })));
  const publicMatch = await generator.findOne(first.assignments[0].matchId);
  assert.equal(publicMatch.startTime.getTime(), first.assignments[0].start);
  assert.equal(publicMatch.fopId, first.assignments[0].fopId);
  const notifications = [];
  const interceptor = new PublicEventStreamInterceptor({ notifyScheduleChanged: (id) => notifications.push(id) }, db);
  const context = (action) => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ method: 'POST',
    path: `/api/scheduling/events/${f.event.id}/plans/${plan.id}/${action}`, params: { eventId: f.event.id }, body: {} }) }) });
  await firstValueFrom(await interceptor.intercept(context('apply'), { handle: () => of(applied) }));
  await firstValueFrom(await interceptor.intercept(context('preview'), { handle: () => of(first) }));
  await assert.rejects(firstValueFrom(await interceptor.intercept(context('apply'), { handle: () => throwError(() => new Error('rollback')) })), /rollback/);
  assert.deepEqual(notifications, [f.event.id], 'only successful apply emits schedule stream notification');
  const current = await plans.detail(f.event.id, plan.id);
  const ids = first.assignments.filter((item) => item.stageKey === 'QF').map((item) => item.matchId);
  const swapped = structuredClone(f.config);
  swapped.name = 'Tên lịch đổi ngay trong preview';
  swapped.matchOrders = [{ categoryId: f.category.id, drawId: f.generated.draws[0].id, stageKey: 'QF', orderedMatchIds: [ids[1], ids[0], ...ids.slice(2)] }];
  const swap = await preview(f, current, swapped);
  assert.equal(swap.canApply, true, JSON.stringify(swap.violations));
  await apply(f, current, swap);
  assert.equal((await db.match.findUnique({ where: { id: ids[1] } })).startTime.getTime(), first.assignments[0].start, 'swap works with immediate EXCLUDE');
  await assert.rejects(db.match.update({ where: { id: ids[1] }, data: { startTime: new Date('2026-10-11T03:00:00Z') } }), /Sắp xếp/);
  await assert.rejects(db.matchScheduleRevision.update({ where: { id: applied.revisionId }, data: { config: {} } }), /không được sửa/);
  await assert.rejects(generator.revertDraw(f.event.id, f.category.id, 'unused', actor.id), /lịch đã áp dụng/);
  console.log('PASS: draft isolation, apply, idempotency, continuation, EXCLUDE swap, legacy guards and immutable revision.');

  const stalePlan = await plans.detail(f.event.id, plan.id);
  const stale = await preview(f, stalePlan, swapped);
  await db.sportSchedulingRule.update({ where: { eventId_sportId: { eventId: f.event.id, sportId: sport.id } }, data: { minRestMinutes: 1 } });
  await assert.rejects(apply(f, stalePlan, stale), /thay đổi/);
  const freshPlan = await plans.detail(f.event.id, plan.id);
  const fresh = await preview(f, freshPlan, swapped);
  await db.team.create({ data: { eventId: f.event.id, sportId: sport.id, countryId: country.id, name: 'Changed roster' } });
  await assert.rejects(apply(f, freshPlan, fresh), /thay đổi/);
  const latest = await plans.detail(f.event.id, plan.id);
  const saved = await plans.save(f.event.id, plan.id, actor.id, { config: swapped, expectedDraftVersion: latest.draftVersion });
  await assert.rejects(plans.save(f.event.id, plan.id, actor.id, { config: swapped, expectedDraftVersion: latest.draftVersion }), /người khác/);
  assert.equal((await plans.overview(f.event.id)).segments[0].hasDraft, true);
  console.log('PASS: stale rules/roster and optimistic draft version.');

  const concurrent = await fixture(4);
  const p1 = await draft(concurrent);
  const p2 = await draft(concurrent);
  const v1 = await preview(concurrent, p1);
  const other = structuredClone(concurrent.config); other.windows.forEach((window) => { window.fopId = concurrent.fops[1].id; });
  const v2 = await preview(concurrent, p2, other);
  const results = await Promise.allSettled([apply(concurrent, p1, v1), apply(concurrent, p2, v2)]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(await db.matchScheduleCategory.count({ where: { eventId: concurrent.event.id } }), 1);
  assert.equal(await db.match.count({ where: { eventId: concurrent.event.id, schedulePlanId: { not: null } } }), 3);
  console.log('PASS: concurrent drafts on different mats cannot acquire the same category twice.');

  const independentA = await fixture(4);
  const independentB = await fixture(4, 'FIGHTING', 'MAIN_TREE', independentA);
  independentA.config.name = 'Lịch A · GI'; independentB.config.name = 'Lịch B · Fighting';
  independentB.config.windows.forEach((window) => { window.fopId = independentB.fops[1].id; });
  const pa = await draft(independentA); const va = await preview(independentA, pa); await apply(independentA, pa, va);
  const pb = await draft(independentB); const vb = await preview(independentB, pb); await apply(independentB, pb, vb);
  assert.equal(va.assignments[0].start, vb.assignments[0].start);
  assert.equal((await plans.overview(independentA.event.id)).segments.filter((segment) => segment.localDate === '2026-10-11').length, 2);
  const sameAthlete = await fixture(4, 'CONTACT', 'MAIN_TREE', independentA, independentA.athletes[0]);
  sameAthlete.config.windows.forEach((window) => { window.fopId = sameAthlete.fops[1].id; });
  sameAthlete.config.windows[0].endLocalTime = '09:30'; // Enough free time between first-content rounds: interleaving must still be forbidden.
  const pc = await draft(sameAthlete); const vc = await preview(sameAthlete, pc);
  assert.equal(vc.canApply, true, JSON.stringify(vc.violations));
  const matchingA = va.assignments.find((assignment) => independentA.generated.matches.find((match) => match.id === assignment.matchId)?.athlete1Id === independentA.athletes[0].id
    || independentA.generated.matches.find((match) => match.id === assignment.matchId)?.athlete2Id === independentA.athletes[0].id);
  const matchingC = vc.assignments.find((assignment) => sameAthlete.generated.matches.find((match) => match.id === assignment.matchId)?.athlete1Id === independentA.athletes[0].id
    || sameAthlete.generated.matches.find((match) => match.id === assignment.matchId)?.athlete2Id === independentA.athletes[0].id);
  assert.ok(matchingC.start >= matchingA.end || matchingC.end <= matchingA.start);
  assert.ok(matchingC.start >= va.assignments.at(-1).end, 'shared athlete waits until the last possible match of the first content');
  assert.ok(vc.violations.some((item) => item.code === 'PARTICIPANT_CONTENT_IN_PROGRESS' && item.description.includes('VĐV 0')), JSON.stringify(vc.violations));
  await assert.rejects(generator.update(matchingC.matchId, { fopId: independentA.fops[1].id,
    startTime: '2026-10-11T09:15:00+07:00', endTime: '2026-10-11T09:20:00+07:00' }), /xen kẽ/);
  assert.equal((await db.match.findUnique({ where: { id: matchingC.matchId } })).startTime, null, 'legacy interleaving rolls back');
  const originalOpening = await db.match.findUnique({ where: { id: matchingA.matchId } });
  const nextContentMatch = await db.match.findUnique({ where: { id: matchingC.matchId } });
  await db.match.update({ where: { id: matchingA.matchId }, data: { status: 'FINISHED', winnerId: independentA.athletes[0].id } });
  await assert.rejects(generator.assertScoreboardReady(db, nextContentMatch), /chưa hoàn tất nội dung/, 'a win with remaining rounds blocks another content');
  await db.match.update({ where: { id: matchingA.matchId }, data: { winnerId: originalOpening.athlete1Id === independentA.athletes[0].id ? originalOpening.athlete2Id : originalOpening.athlete1Id } });
  await assert.rejects(generator.assertScoreboardReady(db, nextContentMatch), /Cần xếp sân/, 'after elimination, content guard allows the next readiness checks');
  await db.match.update({ where: { id: matchingA.matchId }, data: { status: originalOpening.status, winnerId: originalOpening.winnerId } });
  await db.match.update({ where: { id: matchingA.matchId }, data: { resultData: { scoreboard: { finishedAt: new Date().toISOString() } } } });
  await assert.rejects(apply(sameAthlete, pc, vc), /thay đổi/);
  // Legacy writers cannot overwrite an occupied managed interval on another mat.
  await assert.rejects(db.match.update({ where: { id: matchingC.matchId }, data: {
    fopId: independentA.fops[1].id, startTime: new Date(matchingA.start), endTime: new Date(matchingA.end),
  } }));
  console.log('PASS: A/B run independently at 09:00; shared athlete checks, result invalidation and legacy collision protection.');

  const rollback = await fixture(4);
  const rp = await draft(rollback); const rv = await preview(rollback, rp);
  await db.$executeRawUnsafe(`CREATE FUNCTION "${schema}".reject_schedule_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."chainSequence" = 2 THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER reject_schedule_test BEFORE INSERT ON "MatchScheduleItem" FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_schedule_test()`);
  await assert.rejects(apply(rollback, rp, rv), /injected failure/);
  assert.equal(await db.match.count({ where: { eventId: rollback.event.id, startTime: { not: null } } }), 0);
  assert.equal(await db.matchScheduleCategory.count({ where: { eventId: rollback.event.id } }), 0);
  await db.$executeRawUnsafe('DROP TRIGGER reject_schedule_test ON "MatchScheduleItem"');
  console.log('PASS: injected write failure rolls back the entire chain and ownership.');

  const noWeight = await fixture(8);
  await db.category.update({ where: { id: noWeight.category.id }, data: { minWeight: null, maxWeight: null, weightKind: null } });
  const noWeightInput = await plans.plannerInput(noWeight.event.id);
  const selectable = noWeightInput.categories.find(category => category.id === noWeight.category.id);
  assert.equal(selectable.unsupported, null, 'existing matches can be selected without weight metadata');
  assert.equal(selectable.matchCount, 7);
  const noWeightPlan = await draft(noWeight);
  const noWeightPreview = await preview(noWeight, noWeightPlan);
  assert.equal(noWeightPreview.canApply, true, JSON.stringify(noWeightPreview.violations));
  assert.equal(noWeightPreview.assignments.length, 7);
  await apply(noWeight, noWeightPlan, noWeightPreview);
  assert.equal(await db.match.count({ where: { schedulePlanId: noWeightPlan.id } }), 7);
  console.log('PASS: missing weight metadata permits category selection, preview and apply for all existing matches.');
  for (const type of ['REPECHAGE', 'REPECHAGE_QUARTERFINALS', 'DOUBLE_ELIMINATION']) for (const size of [8, 16, 32]) {
    const shaped = await fixture(size, 'FIGHTING', type);
    const sp = await draft(shaped); const sv = await preview(shaped, sp);
    assert.equal(sv.canApply, true, `${type}/${size}: ${JSON.stringify(sv.violations)}`);
    assert.equal(sv.assignments.length, shaped.generated.matches.filter((match) => match.status !== 'FINISHED').length);
    const positions = new Map(sv.assignments.map((item, index) => [item.matchId, index]));
    for (const match of shaped.generated.matches) for (const target of [match.winnerToMatchId, match.loserToMatchId].filter(Boolean)) {
      assert.ok(positions.get(match.id) < positions.get(target), `${type}/${size}: dependency inversion`);
    }
    if (type === 'REPECHAGE' || type === 'REPECHAGE_QUARTERFINALS') {
      const final = shaped.generated.matches.find(m => m.matchType === 'FINAL');
      const bronze = shaped.generated.matches.filter(m => m.notes?.startsWith('Generated repechage bronze medal'));
      assert.equal(sv.assignments.at(-1).matchId, final.id, `${type}/${size}: final is the last bout`);
      const finalSlot = sv.assignments.find(item => item.matchId === final.id);
      for (const match of bronze) {
        assert.ok(positions.get(match.id) < positions.get(final.id), `${type}/${size}: bronze before final`);
        assert.ok(sv.assignments.find(item => item.matchId === match.id).end <= finalSlot.start, 'bronze finishes before final starts');
      }
    }
    if (type === 'REPECHAGE_QUARTERFINALS') {
      const semifinals = shaped.generated.matches.filter(m => m.matchType === 'SEMIFINAL');
      const repechage = shaped.generated.matches.filter(m => m.drawId === shaped.generated.draws[1].id && m.round === 1);
      for (const rep of repechage) for (const sf of semifinals) assert.ok(positions.get(sf.id) < positions.get(rep.id), 'both semifinals precede either repechage');
    }
    await apply(shaped, sp, sv);
    assert.equal(await db.match.count({ where: { schedulePlanId: sp.id } }), sv.assignments.length);
    const corrupt = structuredClone(shaped.generated.matches);
    const feeder = corrupt.find((match) => match.loserToMatchId);
    feeder.loserToSide = feeder.loserToSide === 'ATHLETE1' ? 'ATHLETE2' : 'ATHLETE1';
    const draws = await db.draw.findMany({ where: { eventId: shaped.event.id, categoryId: shaped.category.id } });
    assert.throws(() => semanticStages({ matches: corrupt, draws, heats: [] }, shaped.category.id), /topology/);
  }
  console.log('PASS: approved REPECHAGE, REPECHAGE_QUARTERFINALS and DOUBLE_ELIMINATION stage mappings for 8/16/32 actual generated trees.');
  const competitions = new CompetitionsService(db, generator);
  for (const discipline of ['DUO', 'SHOW']) {
    const category = await db.category.create({ data: { name: `Team ${discipline}`, sportId: sport.id, discipline, gender: 'MALE', weightKind: 'OPEN' } });
    await db.event.update({ where: { id: independentA.event.id }, data: { categories: { connect: { id: category.id } } } });
    const entries = [];
    for (let i = 0; i < 4; i++) {
      const mate = await db.athlete.create({ data: { firstName: `Team ${i}`, lastName: discipline, fullName: `Team member ${i}`, gender: 'MALE', countryId: country.id } });
      const team = await db.team.create({ data: { eventId: independentA.event.id, sportId: sport.id, countryId: country.id,
        name: `${discipline} ${i}`, members: { create: [{ athleteId: mate.id }, { athleteId: independentA.athletes[i].id }] } } });
      entries.push(await db.competitionEntry.create({ data: { eventId: independentA.event.id, categoryId: category.id, countryId: country.id, type: 'TEAM', status: 'VERIFIED', teamId: team.id } }));
    }
    if (discipline === 'DUO') await competitions.generateRoundRobin(independentA.event.id, category.id, { entryIds: entries.map((entry) => entry.id), groupCount: 1 });
    else await competitions.generateHeats(independentA.event.id, category.id, { entryIds: entries.map((entry) => entry.id), laneCount: 2 });
    const config = structuredClone(independentA.config);
    config.blocks = [{ id: 'team', groupKey: contentGroupKey(category), categoryIds: [category.id], estimatedDurationSeconds: 300, turnaroundSeconds: 0 }];
    config.windows = config.windows.filter((window) => window.localDate === '2026-10-13');
    const tf = { ...independentA, config }; const tp = await draft(tf); const tv = await preview(tf, tp);
    assert.equal(tv.canApply, true, `${discipline}: ${JSON.stringify(tv.violations)}`);
    assert.equal(tv.assignments.length, discipline === 'DUO' ? 6 : 2);
    await apply(tf, tp, tv);
    if (discipline === 'SHOW') {
      const heat = await db.heat.findFirst({ where: { categoryId: category.id }, include: { match: true } });
      assert.equal(heat.startTime.getTime(), heat.match.startTime.getTime());
    }
  }
  console.log('PASS: Duo TEAM round-robin and Show TEAM heats use actual rosters; Heat/Match times stay synchronized.');
  // Same content, different category: retired TBD warnings require no acknowledgement.
  // Different contents are now hard-separated, covered by sameAthlete above.
  const tbd = await fixture(2, 'NEWAZA', 'MAIN_TREE', independentA, independentA.athletes[0]);
  const thirdMat = await db.fop.create({ data: { eventId: independentA.event.id, name: 'Thảm 3' } });
  tbd.config.windows = [{ ...tbd.config.windows[1], fopId: thirdMat.id, endLocalTime: '10:00' }];
  const tbdPlan = await draft(tbd); const tbdPreview = await preview(tbd, tbdPlan);
  assert.equal(tbdPreview.canApply, true, JSON.stringify(tbdPreview.violations));
  assert.equal(tbdPreview.warningsRequiringAcknowledgement.length, 0);
  assert.ok(!tbdPreview.violations.some((item) => item.code === 'POTENTIAL_PARTICIPANT_CONFLICT'));
  await apply(tbd, tbdPlan, tbdPreview, { ...payload(tbdPreview), acknowledgeWarnings: false });
  const acknowledgedAudit = await db.auditLog.findFirst({ where: { action: 'APPLY_SCHEDULE_PLAN', entityId: tbdPlan.id } });
  assert.equal(acknowledgedAudit.metadata.acknowledgedWarnings.length, 0);
  const currentFinal = await db.match.findUnique({ where: { id: va.assignments.at(-1).matchId } });
  await assert.rejects(generator.assertScoreboardReady(db, currentFinal), /Vòng\/nội dung trước/);
  await db.match.update({ where: { id: currentFinal.id }, data: { athlete1Id: independentA.athletes[0].id } });
  const resolved = await plans.detail(independentA.event.id, pa.id);
  assert.ok(resolved.applied.proposal.violations.some((item) => item.code === 'RESOLVED_PARTICIPANT_CONFLICT'), 'resolved athletes are checked against live reservations');
  await db.match.update({ where: { id: currentFinal.id }, data: { athlete1Id: currentFinal.athlete1Id } });
  await db.match.update({ where: { id: va.assignments[0].matchId }, data: { scheduleLocked: true } });
  const lockedPlan = await plans.detail(independentA.event.id, pa.id);
  const pinned = structuredClone(independentA.config);
  pinned.pinnedStarts = [{ matchId: va.assignments[0].matchId, startTime: '2026-10-12T09:00:00+07:00' }];
  const lockedPreview = await preview(independentA, lockedPlan, pinned);
  assert.equal(lockedPreview.canApply, false);
  assert.ok(lockedPreview.violations.some((item) => item.code === 'IMMUTABLE_MATCH'));
  console.log('PASS: no retired TBD warnings or acknowledgement, apply audit, readiness stage barrier and immovable protected prefix.');
  const readerResponse = await fetch(`${base}/scheduling/events/${f.event.id}/plans`, { method: 'POST', headers: { Authorization: `Bearer ${token(viewer)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ config: f.config, expectedDraftVersion: 0, idempotencyKey: randomUUID() }) });
  assert.equal(readerResponse.status, 403);
  assert.equal((await fetch(`${base}/scheduling/events/${f.event.id}/plans/overview`, { headers: { Authorization: `Bearer ${token(viewer)}` } })).status, 200);
  assert.equal((await fetch(`${base}/scheduling/events/${f.event.id}/plans/${p1.id}`, { headers: { Authorization: `Bearer ${token(actor)}` } })).status, 404);
  assert.equal((await fetch(`${base}/scheduling/events/${f.event.id}/plans/overview`)).status, 401);
  console.log('PASS: read-only/authentication and event/plan ownership checks.');
  const deletable = await fixture(2);
  const deletedPlan = await draft(deletable); const deletedPreview = await preview(deletable, deletedPlan);
  const deleteRequest = (eventId, planId, version, user = actor) => fetch(`${base}/scheduling/events/${eventId}/plans/${planId}/draft`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token(user)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedDraftVersion: version }),
  });
  assert.equal((await deleteRequest(deletable.event.id, deletedPlan.id, deletedPreview.draftVersion, viewer)).status, 403);
  assert.equal((await deleteRequest(f.event.id, deletedPlan.id, deletedPreview.draftVersion)).status, 404);
  assert.equal((await deleteRequest(deletable.event.id, deletedPlan.id, deletedPlan.draftVersion)).status, 409);
  assert.equal((await deleteRequest(deletable.event.id, deletedPlan.id, deletedPreview.draftVersion)).status, 200);
  assert.equal(await db.matchSchedulePlan.findUnique({ where: { id: deletedPlan.id } }), null);
  assert.equal(await db.matchScheduleRevision.findUnique({ where: { id: deletedPreview.previewId } }), null);
  assert.equal(await db.match.count({ where: { eventId: deletable.event.id } }), 1, 'deleting a draft preserves draw matches');
  const retainedPlan = await draft(deletable); const retainedPreview = await preview(deletable, retainedPlan); await apply(deletable, retainedPlan, retainedPreview);
  const beforeDiscard = await db.match.findMany({ where: { eventId: deletable.event.id } });
  const changedDraft = structuredClone(deletable.config); changedDraft.name = 'Thay đổi cần xoá';
  const pendingPreview = await preview(deletable, await plans.detail(deletable.event.id, retainedPlan.id), changedDraft);
  assert.equal((await plans.detail(deletable.event.id, retainedPlan.id)).hasDraft, true);
  assert.equal((await deleteRequest(deletable.event.id, retainedPlan.id, pendingPreview.draftVersion)).status, 200);
  const restored = await plans.detail(deletable.event.id, retainedPlan.id);
  assert.equal(restored.hasDraft, false); assert.equal(restored.name, deletable.config.name);
  assert.ok(restored.draftVersion > pendingPreview.draftVersion, 'discard cannot reuse an old version');
  assert.deepEqual(restored.draft, deletable.config);
  assert.deepEqual(await db.match.findMany({ where: { eventId: deletable.event.id } }), beforeDiscard);
  assert.equal((await plans.revisions(deletable.event.id, retainedPlan.id)).length, 1);
  assert.equal((await plans.overview(deletable.event.id)).drafts.length, 0);
  await assert.rejects(apply(deletable, retainedPlan, pendingPreview), /khớp bản nháp/);
  await assert.rejects(plans.save(deletable.event.id, retainedPlan.id, actor.id, { config: changedDraft, expectedDraftVersion: pendingPreview.draftVersion }), /người khác sửa/);
  assert.equal(await db.auditLog.count({ where: { action: 'DELETE_SCHEDULE_DRAFT', entityId: { in: [deletedPlan.id, retainedPlan.id] } } }), 2);
  console.log('PASS: delete draft permissions/version guard; unapplied plan removed; applied schedule/history preserved and stale tabs rejected.');
  const transitionFixture = await fixture(4);
  transitionFixture.config.windows[0].endLocalTime = '18:00';
  transitionFixture.config.blocks[0].turnaroundSeconds = 300;
  const transitionPlan = await draft(transitionFixture);
  const nominal = await preview(transitionFixture, transitionPlan);
  const manual = structuredClone(transitionFixture.config);
  manual.pinnedStarts = [{ matchId: nominal.assignments[1].matchId, startTime: '2026-10-11T09:09:00+07:00' }];
  const compressedPreview = await preview(transitionFixture, await plans.detail(transitionFixture.event.id, transitionPlan.id), manual);
  assert.equal(compressedPreview.canApply, true, JSON.stringify(compressedPreview.violations));
  assert.equal(compressedPreview.assignments[0].turnaroundSeconds, 240);
  await apply(transitionFixture, transitionPlan, compressedPreview);
  assert.equal((await db.match.findUnique({ where: { id: nominal.assignments[1].matchId } })).startTime.getTime(), Date.parse(manual.pinnedStarts[0].startTime));
  assert.equal((await db.matchScheduleItem.findUnique({ where: { revisionId_matchId: { revisionId: compressedPreview.previewId, matchId: nominal.assignments[0].matchId } } })).turnaroundSeconds, 240);
  const lockedPrefix = await db.match.update({ where: { id: nominal.assignments[0].matchId }, data: { scheduleLocked: true } });
  manual.pinnedStarts[0].startTime = '2026-10-11T09:08:00+07:00';
  const lockedGap = await preview(transitionFixture, await plans.detail(transitionFixture.event.id, transitionPlan.id), manual);
  assert.equal(lockedGap.canApply, true, JSON.stringify(lockedGap.violations));
  await apply(transitionFixture, transitionPlan, lockedGap);
  const stillLocked = await db.match.findUnique({ where: { id: lockedPrefix.id } });
  assert.equal(stillLocked.startTime.getTime(), lockedPrefix.startTime.getTime());
  assert.equal(stillLocked.endTime.getTime(), lockedPrefix.endTime.getTime());
  manual.pinnedStarts[0].startTime = '2026-10-11T09:04:00+07:00';
  const overlapPreview = await preview(transitionFixture, await plans.detail(transitionFixture.event.id, transitionPlan.id), manual);
  assert.equal(overlapPreview.canApply, false);
  assert.equal(overlapPreview.violations.find((item) => item.code === 'PIN_CONFLICT').suggestedStart, Date.parse('2026-10-11T09:05:00+07:00'));
  await assert.rejects(apply(transitionFixture, transitionPlan, overlapPreview), /còn lỗi/);
  console.log('PASS: 09:05 finish → 09:09 manual start overrides default 5-minute transition; apply persists effective gap; locked match times preserved; real overlap blocked.');
  const removedImages = [];
  const events = new EventsService(db, { deleteQuietly: async (key) => { if (key) removedImages.push(key); } });
  const eventToDelete = await fixture(4);
  const deletionPlan = await draft(eventToDelete);
  const deletionPreview = await preview(eventToDelete, deletionPlan);
  await apply(eventToDelete, deletionPlan, deletionPreview);
  await db.event.update({ where: { id: eventToDelete.event.id }, data: { bannerStorageKey: 'event-delete/banner' } });
  await assert.rejects(db.match.deleteMany({ where: { eventId: eventToDelete.event.id } }), /không thể xóa/);
  await assert.rejects(db.matchScheduleRevision.delete({ where: { id: deletionPreview.previewId } }), /không được sửa/);
  await assert.rejects(db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('sportdata.event_delete', ${f.event.id}, true)`;
    await tx.match.deleteMany({ where: { eventId: eventToDelete.event.id } });
  }), /không thể xóa/, 'deletion marker cannot bypass protection for another event');
  await db.$executeRawUnsafe(`CREATE FUNCTION "${schema}".reject_event_delete_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected event delete failure'; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER reject_event_delete_test BEFORE DELETE ON "Event" FOR EACH ROW EXECUTE FUNCTION reject_event_delete_test()');
  await assert.rejects(events.remove(eventToDelete.event.id), /injected event delete failure/);
  assert.ok(await db.event.findUnique({ where: { id: eventToDelete.event.id } }));
  assert.equal(await db.match.count({ where: { eventId: eventToDelete.event.id } }), 3);
  assert.equal(await db.matchScheduleItem.count({ where: { revisionId: deletionPreview.previewId } }), 3);
  assert.ok(await db.matchScheduleRevision.findUnique({ where: { id: deletionPreview.previewId } }));
  assert.ok(await db.matchSchedulePlan.findUnique({ where: { id: deletionPlan.id } }));
  assert.equal(await db.matchScheduleCategory.count({ where: { eventId: eventToDelete.event.id } }), 1);
  assert.deepEqual(removedImages, [], 'failed deletion must preserve stored images');
  await db.$executeRawUnsafe('DROP TRIGGER reject_event_delete_test ON "Event"');
  const otherMatches = await db.match.count({ where: { eventId: f.event.id } });
  await events.remove(eventToDelete.event.id);
  assert.equal(await db.event.findUnique({ where: { id: eventToDelete.event.id } }), null);
  assert.equal(await db.match.count({ where: { eventId: eventToDelete.event.id } }), 0);
  assert.equal(await db.draw.count({ where: { eventId: eventToDelete.event.id } }), 0);
  assert.equal(await db.matchScheduleItem.count({ where: { revisionId: deletionPreview.previewId } }), 0);
  assert.equal(await db.matchScheduleRevision.findUnique({ where: { id: deletionPreview.previewId } }), null);
  assert.equal(await db.matchSchedulePlan.count({ where: { eventId: eventToDelete.event.id } }), 0);
  assert.equal(await db.matchScheduleCategory.count({ where: { eventId: eventToDelete.event.id } }), 0);
  assert.equal(await db.competitionEntry.count({ where: { eventId: eventToDelete.event.id } }), 0);
  assert.equal(await db.athlete.count({ where: { id: { in: eventToDelete.athletes.map((athlete) => athlete.id) } } }), 4);
  assert.equal(await db.match.count({ where: { eventId: f.event.id } }), otherMatches);
  assert.deepEqual(removedImages, ['event-delete/banner']);
  await assert.rejects(events.remove(eventToDelete.event.id), (error) => error.getStatus() === 404);
  await assert.rejects(db.match.deleteMany({ where: { eventId: f.event.id } }), /không thể xóa/, 'transaction marker must not leak after commit');
  const draftEventToDelete = await fixture(2);
  const draftToDelete = await draft(draftEventToDelete);
  const previewToDelete = await preview(draftEventToDelete, draftToDelete);
  await events.remove(draftEventToDelete.event.id);
  assert.equal(await db.matchSchedulePlan.findUnique({ where: { id: draftToDelete.id } }), null);
  assert.equal(await db.matchScheduleRevision.findUnique({ where: { id: previewToDelete.previewId } }), null);
  const emptyEvent = await db.event.create({ data: { name: 'Empty deletion fixture', sportId: sport.id,
    startDate: new Date('2030-01-01'), endDate: new Date('2030-01-02') } });
  await events.remove(emptyEvent.id);
  assert.equal(await db.event.findUnique({ where: { id: emptyEvent.id } }), null);
  console.log('PASS: event deletion with applied/draft schedules, atomic rollback, image cleanup, shared athlete preservation, event isolation and 404.');
  for (const [type, missingMetadata] of ['ROUND_ROBIN_POOL', 'REPECHAGE', 'REPECHAGE_QUARTERFINALS']
    .flatMap((type) => [false, true].map((missing) => [type, missing]))) {
    const male = await fixture(5, 'NEWAZA', type);
    const female57 = await fixture(5, 'NEWAZA', type, male, undefined, 'FEMALE');
    const female63 = await fixture(5, 'NEWAZA', type, male, undefined, 'FEMALE');
    await db.category.update({ where: { id: male.category.id }, data: { name: 'Nam +94 kg',
      minWeight: 94, maxWeight: null, weightKind: 'OVER' } });
    await db.category.update({ where: { id: female57.category.id }, data: { name: 'Nữ -57 kg',
      maxWeight: missingMetadata ? null : 57, weightKind: missingMetadata ? null : 'CAPPED' } });
    await db.category.update({ where: { id: female63.category.id }, data: { name: 'Nữ -63 kg',
      maxWeight: missingMetadata ? null : 63, weightKind: missingMetadata ? null : 'CAPPED' } });
    const config = structuredClone(male.config);
    config.blocks.push({ ...female57.config.blocks[0], id: 'female-block',
      categoryIds: [female63.category.id, female57.category.id] });
    const plan = await draft(male, config);
    const proposal = await preview(male, plan, config);
    assert.equal(proposal.canApply, true, JSON.stringify(proposal.violations));
    const rows = await db.match.findMany({ where: { eventId: male.event.id } });
    const weightOrder = [female57.category.id, female63.category.id, male.category.id];
    const expected = [...rows].sort((a, b) => a.round - b.round
      || weightOrder.indexOf(a.categoryId) - weightOrder.indexOf(b.categoryId) || a.bracketPosition - b.bracketPosition);
    assert.deepEqual(proposal.assignments.map((item) => item.matchId), expected.map((match) => match.id),
      `${type}, missingMetadata=${missingMetadata}: round 1 Female -57/-63 then Male +94; repeat for rounds 2–5`);
    assert.equal(proposal.assignments.filter((item) => item.localDate === '2026-10-11').length, 2);
    await apply(male, plan, proposal);
    const saved = await db.match.findMany({ where: { eventId: male.event.id }, orderBy: { scheduleSequence: 'asc' } });
    assert.deepEqual(saved.map((match) => match.id), expected.map((match) => match.id));
    // Existing gender-specific block IDs remain valid for saved continuation markers.
    const marked = structuredClone(config);
    marked.earliestStarts.push({ target: { blockId: 'female-block', stageKey: 'POOL_2' }, notBefore: '2026-10-13T02:00:00Z' });
    const current = await plans.detail(male.event.id, plan.id);
    const moved = await preview(male, current, marked);
    assert.equal(moved.canApply, true, JSON.stringify(moved.violations));
    assert.deepEqual(moved.assignments.map((item) => item.matchId), expected.map((match) => match.id));
    assert.equal(moved.requestedStarts[0].actual, Date.parse('2026-10-13T02:00:00Z'));
  }
  console.log('PASS: mixed-gender round-robin / both under-six repechage: -57, -63, +94 within every round, persisted apply, day continuation and legacy block markers.');
  // A scheduled match may start before its planned date/time. Test the actual
  // readiness -> lease -> START path and keep the planned time separate from actual time.
  const early = await fixture(2);
  const futureDay = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await db.event.update({ where: { id: early.event.id }, data: {
    startDate: new Date(`${futureDay}T00:00:00+07:00`), endDate: new Date(`${futureDay}T23:59:00+07:00`),
  } });
  early.config.windows = [{ ...early.config.windows[0], localDate: futureDay, endLocalTime: '18:00' }];
  const earlyPlan = await draft(early);
  const earlyPreview = await preview(early, earlyPlan);
  assert.equal(earlyPreview.canApply, true, JSON.stringify(earlyPreview.violations));
  await apply(early, earlyPlan, earlyPreview);
  const earlyId = earlyPreview.assignments[0].matchId;
  const scoreboardApi = async (id, suffix = '', body, expectedStatus = body ? 201 : 200, user = actor) => {
    const response = await fetch(`${base}/results/matches/${id}/scoreboard${suffix}`, {
      method: body ? 'POST' : 'GET', headers: { ...(user ? { Authorization: `Bearer ${token(user)}` } : {}),
        'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    assert.equal(response.status, expectedStatus, JSON.stringify(data));
    return data;
  };
  await scoreboardApi(earlyId, '', undefined, 401, null);
  await scoreboardApi(earlyId, '', undefined, 403, viewer);
  const readyEarly = await scoreboardApi(earlyId);
  assert.ok(Date.parse(readyEarly.startTime) > Date.now());
  assert.equal(readyEarly.blockedReason, null, 'future scheduled time must not disable Start');
  const clientId = randomUUID();
  await scoreboardApi(earlyId, '/claim', { clientId });
  await scoreboardApi(earlyId, '/claim', { clientId: randomUUID() }, 409);
  const startedEarly = await scoreboardApi(earlyId, '', {
    action: 'START', expectedVersion: readyEarly.resultVersion, clientId,
  });
  assert.equal(startedEarly.status, 'RUNNING');
  await scoreboardApi(earlyId, '', { action: 'START', expectedVersion: startedEarly.resultVersion, clientId }, 400);
  const persistedEarly = await db.match.findUnique({ where: { id: earlyId } });
  assert.equal(persistedEarly.startTime.getTime(), earlyPreview.assignments[0].start);
  assert.ok(Date.parse(persistedEarly.resultData.scoreboard.startedAt) < persistedEarly.startTime.getTime(),
    'actual start is recorded now without rewriting the planned schedule');
  const noSchedule = await fixture(2);
  const unscheduledClaim = await scoreboardApi(noSchedule.generated.matches[0].id, '/claim', { clientId: randomUUID() }, 400);
  assert.match(unscheduledClaim.message, /Cần xếp sân/);
  const occupied = await fixture(2, 'NEWAZA', 'MAIN_TREE', early);
  const occupiedMatch = await db.match.update({ where: { id: occupied.generated.matches[0].id }, data: {
    matchDate: persistedEarly.matchDate, fopId: early.fops[0].id,
    startTime: new Date(persistedEarly.endTime.getTime() + 60000),
    endTime: new Date(persistedEarly.endTime.getTime() + 360000),
  } });
  const readyOnSameMat = await scoreboardApi(occupiedMatch.id);
  assert.equal(readyOnSameMat.blockedReason, null, 'another running match on the mat must not block Start');
  const sameMatClientId = randomUUID();
  await scoreboardApi(occupiedMatch.id, '/claim', { clientId: sameMatClientId });
  const startedOnSameMat = await scoreboardApi(occupiedMatch.id, '', {
    action: 'START', expectedVersion: readyOnSameMat.resultVersion, clientId: sameMatClientId,
  });
  assert.equal(startedOnSameMat.status, 'RUNNING');
  assert.equal(await db.match.count({ where: { eventId: early.event.id, fopId: early.fops[0].id, status: 'RUNNING' } }), 2);
  const athleteBusy = await fixture(2, 'NEWAZA', 'MAIN_TREE', early, early.athletes[0]);
  const athleteBusyMatch = await db.match.update({ where: { id: athleteBusy.generated.matches[0].id }, data: {
    matchDate: persistedEarly.matchDate, fopId: early.fops[1].id,
    startTime: new Date(persistedEarly.endTime.getTime() + 600000),
    endTime: new Date(persistedEarly.endTime.getTime() + 900000),
  } });
  await assert.rejects(generator.assertScoreboardReady(db, athleteBusyMatch), /VĐV đang thi đấu/);
  const busyAthleteClaim = await scoreboardApi(athleteBusyMatch.id, '/claim', { clientId: randomUUID() }, 409);
  assert.match(busyAthleteClaim.message, /VĐV đang thi đấu/);
  const awardedEarly = await scoreboardApi(earlyId, '', { action: 'AWARD', side: 1, award: 'POINTS', points: 2,
    expectedVersion: startedEarly.resultVersion, clientId });
  const pausedEarly = await scoreboardApi(earlyId, '', { action: 'PAUSE', expectedVersion: awardedEarly.resultVersion, clientId });
  const finishedEarly = await scoreboardApi(earlyId, '', { action: 'FINISH', winnerId: readyEarly.athlete1Id,
    winMethod: 'POINTS', expectedVersion: pausedEarly.resultVersion, clientId });
  assert.equal(finishedEarly.status, 'FINISHED');
  assert.ok(Date.parse(finishedEarly.resultData.scoreboard.finishedAt) < Date.parse(finishedEarly.startTime));
  const afterQuickFinish = await fixture(2, 'NEWAZA', 'MAIN_TREE', early);
  const nextEarly = await db.match.update({ where: { id: afterQuickFinish.generated.matches[0].id }, data: {
    matchDate: persistedEarly.matchDate, fopId: early.fops[0].id,
    startTime: new Date(persistedEarly.endTime.getTime() + 1200000),
    endTime: new Date(persistedEarly.endTime.getTime() + 1500000),
  } });
  const nextReady = await scoreboardApi(nextEarly.id);
  assert.equal(nextReady.blockedReason, null);
  const nextClientId = randomUUID();
  await scoreboardApi(nextEarly.id, '/claim', { clientId: nextClientId });
  assert.equal((await scoreboardApi(nextEarly.id, '', { action: 'START', expectedVersion: nextReady.resultVersion, clientId: nextClientId })).status, 'RUNNING');
  console.log('PASS HTTP/DB: future START, occupied mat, quick finish -> next START, actual timestamps, auth, leases, duplicate START, unscheduled and busy-athlete guards.');
  if (process.env.SCHEDULE_UI === '1' || process.argv.includes('--ui')) {
    const uiCategory = await fixture(32, 'FULL_CONTACT', 'MAIN_TREE', independentA);
    const uiAdditionalCategory = await fixture(8, 'FULL_CONTACT', 'MAIN_TREE', independentA);
    const uiSport = await db.sport.create({ data: { name: 'Full Contact tự động', code: 'AUTO_SCHEDULE_UI' } });
    await db.sportSchedulingRule.create({ data: { eventId: independentA.event.id, sportId: uiSport.id,
      matchDurationMinutes: 5, turnaroundMinutes: 0, minRestMinutes: 0, earliestStart: '08:00', latestEnd: '10:30' } });
    // Use a valid individual discipline for the editable UI fixture; team
    // disciplines are exercised separately with actual team entries.
    await db.category.update({ where: { id: uiCategory.category.id }, data: { sportId: uiSport.id, discipline: 'FULL_CONTACT', name: 'Full Contact nam · -56 kg' } });
    await db.category.update({ where: { id: uiAdditionalCategory.category.id }, data: { sportId: uiSport.id, maxWeight: null, minWeight: null, weightKind: null, name: 'Full Contact nam · -69 kg' } });
    await db.event.update({ where: { id: independentA.event.id }, data: { name: 'Giải Jujitsu · Kiểm thử lịch thi đấu' } });
    await db.category.update({ where: { id: independentA.category.id }, data: { name: 'GI nam · -56 kg' } });
    await db.category.update({ where: { id: independentB.category.id }, data: { name: 'Fighting nam · -56 kg' } });
    const { runScheduleUi } = await import('./match-scheduling-ui.mjs');
    await runScheduleUi({ apiBase: base, db, eventId: independentA.event.id, token: token(actor), actor,
      categoryId: uiCategory.category.id, categoryName: 'Full Contact nam · -56 kg', additionalCategoryName: 'Full Contact nam · -69 kg' });
  }
} finally {
  if (app) await app.close();
  await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.end();
  rmSync(migrationRoot, { recursive: true, force: true });
}
