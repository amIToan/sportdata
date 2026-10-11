// npm run build:backend && node tests/regression/match-scheduling-engine.mjs
// Pure engine fixtures only: no database or production data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
const { planSchedule } = require('./dist/src/scheduling/planner/schedule-engine.js');
const { normalizeMainTree, isAutomaticScheduleBye, categoryWeight, scheduleParticipantIds } = require('./dist/src/scheduling/planner/main-tree.js');
const { MatchesService } = require('./dist/src/matches/matches.service.js');
const generator = new MatchesService({});
const instant = (day, hour = '09:00') => Date.parse(`2026-10-${day}T${hour}:00+07:00`);
const window = (day, end = '18:00', fopId = 'fop-1') => ({ id: `w-${day}`, localDate: `2026-10-${day}`,
  start: instant(day), end: instant(day, end), fopId, enabled: true, breaks: [] });

function fixture(counts = [32, 32, 32, 32, 32, 32]) {
  const matches = [];
  const originals = [];
  counts.forEach((count, categoryIndex) => {
    const categoryId = `category-${categoryIndex}`;
    const drawId = `draw-${categoryIndex}`;
    const athletes = Array.from({ length: count }, (_, i) => ({ id: `${categoryId}-athlete-${i}`, countryId: 'country' }));
    const slots = generator.placePreconfiguredPairs(athletes, 2 ** Math.ceil(Math.log2(count)), 'STANDARD', []);
    const tree = generator.buildWinnerBracket({ drawId, categoryId, eventId: 'event', matchDate: new Date(instant('11')),
      fops: [], fopCursor: { value: 0 }, slots, number: { value: 1 } }).flat();
    generator.resolveGeneratedWalkovers(tree);
    tree.forEach((match) => { match.resultStatus = 'DRAFT'; });
    originals.push(...structuredClone(tree));
    const stages = normalizeMainTree({ id: drawId, bracketSize: slots.length }, tree);
    const real = tree.filter((match) => !isAutomaticScheduleBye(match));
    function predecessors(id) {
      return tree.filter((match) => match.winnerToMatchId === id).flatMap((match) =>
        isAutomaticScheduleBye(match) ? predecessors(match.id) : [match.id]);
    }
    real.forEach((match) => matches.push({ ...match, ...stages.get(match.id), blockId: 'gi', blockOrder: 0,
      weightOrder: categoryIndex, predecessorIds: predecessors(match.id),
      participantIds: [match.athlete1Id, match.athlete2Id].filter(Boolean), candidateParticipantIds: [],
      durationSeconds: 300, turnaroundSeconds: 0, minRestSeconds: 0, immutable: false }));
  });
  return { matches, originals, input: { matches, windows: [window('11', '14:00'), window('12'), window('13')],
    reservations: [], autoContinue: true, matchOrders: [], earliestStarts: [], pinnedStarts: [] } };
}
const counts = (result) => Object.fromEntries(['11', '12', '13'].map((day) => [day,
  result.assignments.filter((item) => item.localDate === `2026-10-${day}`).length]));
const small = fixture([32, 18, 8]);
small.input.windows = [window('11')];
const smallBefore = structuredClone(small.input);
const s = planSchedule(small.input);
assert.equal(s.canApply, true);
assert.equal(s.assignments.length, 55);
assert.deepEqual(['R32', 'R16', 'QF', 'SF', 'F'].map((stage) => s.assignments.filter((item) => item.stageKey === stage).length), [18, 16, 12, 6, 3]);
assert.equal(s.assignments.at(-1).end, instant('11', '13:35'));
assert.deepEqual(small.input, smallBefore, 'planner must not mutate its snapshot');
const a = fixture();
a.input.windows[0] = window('11');
a.input.earliestStarts.push({ target: { blockId: 'gi', stageKey: 'R16' }, notBefore: instant('12') });
assert.deepEqual(counts(planSchedule(a.input)), { 11: 96, 12: 90, 13: 0 });
const b = fixture();
const baseline = planSchedule(b.input);
assert.equal(baseline.canApply, true);
assert.deepEqual(counts(baseline), { 11: 60, 12: 108, 13: 18 });
const c = structuredClone(b.input);
c.earliestStarts.push({ target: { matchId: baseline.assignments[55].matchId }, notBefore: instant('12') });
const continued = planSchedule(c);
assert.equal(counts(continued)['11'], 55);
assert.deepEqual(continued.assignments.map((item) => item.matchId), baseline.assignments.map((item) => item.matchId));
const d = fixture();
d.matches.forEach((match) => { match.durationSeconds = 600; });
const full = planSchedule(d.input);
assert.equal(full.assignments.length, 138);
assert.equal(full.unscheduled.length, 48);
assert.equal(full.canApply, false);
assert.equal(full.violations.at(-1).code, 'EVENT_CAPACITY_EXCEEDED');
const stopped = structuredClone(b.input);
stopped.autoContinue = false;
assert.equal(planSchedule(stopped).assignments.length, 60);
stopped.earliestStarts.push({ target: { matchId: baseline.assignments[60].matchId }, notBefore: instant('12') });
assert.equal(planSchedule(stopped).assignments.length, 168);
const skip = structuredClone(b.input);
skip.windows[1].enabled = false;
assert.equal(planSchedule(skip).assignments.some((item) => item.localDate === '2026-10-12'), false);
skip.earliestStarts.push({ target: { blockId: 'gi', stageKey: 'R16' }, notBefore: instant('12') });
assert.equal(planSchedule(skip).violations[0].code, 'INVALID_WINDOW');

const reorder = structuredClone(small.input);
const group = s.assignments.filter((item) => item.categoryId === 'category-0' && item.stageKey === 'R32');
const ids = group.map((item) => item.matchId);
const moved = [ids[4], ...ids.slice(0, 4), ...ids.slice(5)];
reorder.matchOrders = [{ categoryId: 'category-0', drawId: 'draw-0', stageKey: 'R32', orderedMatchIds: moved }];
assert.equal(planSchedule(reorder).assignments[0].matchId, ids[4]);
assert.deepEqual(reorder.matches, small.input.matches);
reorder.matchOrders[0].orderedMatchIds[0] = s.assignments.at(-1).matchId;
assert.equal(planSchedule(reorder).violations[0].code, 'INVALID_MATCH_ORDER');
const cycle = fixture([8]);
cycle.matches[0].predecessorIds.push(cycle.matches.at(-1).id);
assert.ok(planSchedule(cycle.input).violations.some((item) => item.code === 'DEPENDENCY_CYCLE'));
const pin = fixture([8]);
pin.input.pinnedStarts.push({ matchId: pin.matches.at(-1).id, startTime: instant('11') });
assert.ok(planSchedule(pin.input).violations.some((item) => item.code === 'PIN_CONFLICT'));

const gap = fixture([8]);
gap.matches.forEach((match) => { match.turnaroundSeconds = 300; });
const gapResult = planSchedule(gap.input);
assert.equal(gapResult.assignments[1].start, instant('11', '09:10'));
const manualGap = structuredClone(gap.input);
manualGap.pinnedStarts = [{ matchId: gapResult.assignments[1].matchId, startTime: instant('11', '09:09') }];
const originalManual = structuredClone(manualGap);
const compressed = planSchedule(manualGap);
assert.equal(compressed.canApply, true);
assert.equal(compressed.assignments[1].start, instant('11', '09:09'), 'explicit valid time overrides default transition');
assert.equal(compressed.assignments[0].turnaroundSeconds, 240, 'record effective transition for apply/database reservations');
assert.equal(compressed.assignments[2].start, instant('11', '09:19'), 'other transitions keep their defaults');
assert.deepEqual(manualGap, originalManual, 'compressing a gap does not mutate input');
const markerGap = structuredClone(gap.input);
markerGap.earliestStarts = [{ target: { matchId: gapResult.assignments[1].matchId }, notBefore: instant('11', '09:09') }];
assert.equal(planSchedule(markerGap).assignments[1].start, instant('11', '09:09'));
const pastMarker = structuredClone(markerGap); pastMarker.earliestStarts[0].notBefore = instant('11');
assert.equal(planSchedule(pastMarker).assignments[1].start, instant('11', '09:10'), 'a past earliest marker does not remove every default buffer');
const overlappingPin = structuredClone(manualGap); overlappingPin.pinnedStarts[0].startTime = instant('11', '09:04');
const overlapResult = planSchedule(overlappingPin);
assert.equal(overlapResult.canApply, false, 'manual time cannot overlap the preceding match');
assert.equal(overlapResult.violations.find((item) => item.code === 'PIN_CONFLICT').suggestedStart, instant('11', '09:05'));
const athleteRest = structuredClone(manualGap);
athleteRest.matches[1].participantIds = [...athleteRest.matches[0].participantIds];
athleteRest.matches[1].minRestSeconds = 3600;
assert.equal(planSchedule(athleteRest).canApply, false, 'compressing default transition cannot override athlete rest');
const pause = fixture([8]);
pause.input.windows[0].breaks = [{ start: instant('11', '09:03'), end: instant('11', '10:00') }];
assert.equal(planSchedule(pause.input).assignments[0].start, instant('11', '10:00'));
const rest = fixture([4]);
rest.matches.forEach((match) => { match.minRestSeconds = 3600; });
assert.equal(planSchedule(rest.input).assignments.at(-1).start, instant('11', '10:10'));
const reservation = fixture([2]);
reservation.input.reservations.push({ id: 'other', matchId: 'other', planId: 'other-plan', fopId: 'fop-1',
  start: instant('11'), end: instant('11', '09:10'), turnaroundSeconds: 300, minRestSeconds: 0,
  participantIds: [], candidateParticipantIds: [] });
assert.equal(planSchedule(reservation.input).assignments[0].start, instant('11', '09:15'));
reservation.input.reservations[0].fopId = 'fop-2';
assert.equal(planSchedule(reservation.input).assignments[0].start, instant('11'));
reservation.input.reservations[0].participantIds = reservation.matches[0].participantIds;
reservation.input.reservations[0].minRestSeconds = 3600;
assert.equal(planSchedule(reservation.input).assignments[0].start, instant('11', '10:10'));
reservation.input.reservations[0].candidateParticipantIds = reservation.input.reservations[0].participantIds;
reservation.input.reservations[0].participantIds = [];
assert.ok(!planSchedule(reservation.input).violations.some((item) => item.code === 'POTENTIAL_PARTICIPANT_CONFLICT'));

assert.throws(() => categoryWeight({ minWeight: null, maxWeight: null }), /xác nhận/);
assert.deepEqual([100, 9, 56].map((maxWeight) => categoryWeight({ maxWeight }).value).sort((x, y) => x - y), [9, 56, 100]);
assert.deepEqual(scheduleParticipantIds({ team1Id: 'team' }, new Map([['team', ['a', 'b']]])), ['athlete:a', 'athlete:b', 'team:team']);
assert.throws(() => scheduleParticipantIds({ team1Id: 'team' }, new Map()), /thành viên/);
const bye = small.originals.find((match) => isAutomaticScheduleBye(match));
assert.ok(bye);
assert.equal(isAutomaticScheduleBye({ ...bye, resultEnteredAt: new Date() }), false);
assert.equal(isAutomaticScheduleBye({ ...bye, notes: 'Real walkover' }), false);
assert.equal(isAutomaticScheduleBye({ ...bye, resultVersion: 4 }), true, 'automatic progression can increment resultVersion');
const tree = small.originals.filter((match) => match.drawId === 'draw-0');
assert.throws(() => normalizeMainTree({ id: 'draw-0', bracketSize: 32 }, tree.slice(1)), /topology/);
assert.equal(normalizeMainTree({ id: 'draw-0' }, tree).get(tree.at(-1).id).stageKey, 'F');
console.log('PASS: MAIN_TREE 55 matches; A/B/C/D continuation; strict ordering, immutability of input, overflow, markers, pins, cycles, rest, reservations, TBD and team roster.');
