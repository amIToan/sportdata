// Build backend first. No database required.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
const { planSchedule } = require('./dist/src/scheduling/planner/schedule-engine.js');
const { activeContentBlockers, participantResolver } = require('./dist/src/scheduling/planner/participant-content.js');
const time = (hour) => Date.parse(`2026-10-11T${hour}:00+07:00`);
const match = { id: 'gi', categoryId: 'gi-category', contentKey: 'GI', drawId: 'gi-draw', blockId: 'gi', blockOrder: 0,
  stageKey: 'F', stageOrder: 0, weightOrder: 0, bracketPosition: 0, predecessorIds: [], participantIds: ['athlete:a'],
  candidateParticipantIds: [], durationSeconds: 300, turnaroundSeconds: 0, minRestSeconds: 0, immutable: false };
const reservation = (id, start, end, candidate = false) => ({ id, matchId: id, planId: 'no-gi-plan', contentKey: 'NO_GI', fopId: 'other-mat',
  start: time(start), end: time(end), minRestSeconds: 0, turnaroundSeconds: 0,
  participantIds: candidate ? [] : ['athlete:a'], candidateParticipantIds: candidate ? ['athlete:a'] : [] });
const input = { matches: [match], windows: [{ id: 'day', localDate: '2026-10-11', fopId: 'mat', enabled: true,
  start: time('11:00'), end: time('18:00'), breaks: [] }], autoContinue: true, earliestStarts: [], matchOrders: [], pinnedStarts: [],
  reservations: [reservation('no-gi-first', '09:00', '09:05'), reservation('no-gi-final', '14:00', '14:05', true)] };
const original = structuredClone(input);
const scheduled = planSchedule(input);
assert.equal(scheduled.canApply, true);
assert.equal(scheduled.assignments[0].start, time('14:05'), 'cannot insert GI in the gap between No-GI rounds');
assert.ok(scheduled.violations.some((item) => item.code === 'PARTICIPANT_CONTENT_IN_PROGRESS' && item.severity === 'INFO'));
assert.ok(!scheduled.violations.some((item) => item.code === 'POTENTIAL_PARTICIPANT_CONFLICT'));
assert.deepEqual(input, original);
const rest = structuredClone(input); rest.matches[0].minRestSeconds = 3600;
assert.equal(planSchedule(rest).assignments[0].start, time('15:05'));
const pinned = structuredClone(input); pinned.pinnedStarts = [{ matchId: 'gi', startTime: time('11:00') }];
assert.equal(planSchedule(pinned).canApply, false, 'a fixed pin cannot waive content completion');
const locked = structuredClone(input); locked.matches[0].immutable = true;
locked.matches[0].current = { start: time('11:00'), end: time('11:05'), fopId: 'mat' };
assert.equal(planSchedule(locked).canApply, false);
const shortage = structuredClone(input); shortage.windows[0].end = time('13:00');
assert.equal(planSchedule(shortage).canApply, false);
const otherAthlete = structuredClone(input); otherAthlete.matches[0].participantIds = ['athlete:z'];
assert.equal(planSchedule(otherAthlete).assignments[0].start, time('11:00'), 'unrelated athletes still run independently');
const before = structuredClone(input); before.windows[0].start = time('08:00');
assert.equal(planSchedule(before).assignments[0].start, time('08:00'), 'an entire content can finish before the other begins');
const spanning = structuredClone(before); spanning.matches.push({ ...match, id: 'gi-final', bracketPosition: 1, participantIds: [], candidateParticipantIds: ['athlete:a'] });
spanning.earliestStarts = [{ target: { matchId: 'gi-final' }, notBefore: time('12:00') }];
assert.equal(planSchedule(spanning).assignments[0].start, time('14:05'), 'the whole participant path moves, including an earlier first round');

const category = (id, uniform) => ({ id, sportId: 'jj', discipline: 'NEWAZA', uniform, gender: 'MALE' });
const noGi = category('no-gi', 'NO_GI'); const gi = category('gi', 'GI');
const opening = { id: 'opening', categoryId: noGi.id, category: noGi, status: 'FINISHED', athlete1Id: 'a', athlete2Id: 'b',
  winnerId: 'a', winnerToMatchId: 'final', winnerToSide: 'ATHLETE1', participants: [] };
const final = { id: 'final', categoryId: noGi.id, category: noGi, status: 'SCHEDULED', athlete2Id: 'c', participants: [] };
const current = { id: 'current', categoryId: gi.id, category: gi, status: 'SCHEDULED', athlete1Id: 'a', athlete2Id: 'd', participants: [] };
assert.equal(activeContentBlockers([opening, final, current], new Map(), current).length, 1, 'winning a round is not finishing a content');
const lost = { ...opening, winnerId: 'b' };
assert.equal(activeContentBlockers([lost, final, current], new Map(), current).length, 0, 'an eliminated athlete may leave before the final');
assert.ok(!participantResolver([lost, final], new Map())('final').includes('athlete:a'));
const repechage = { id: 'repechage', categoryId: noGi.id, category: noGi, status: 'SCHEDULED', participants: [] };
assert.equal(activeContentBlockers([{ ...lost, loserToMatchId: 'repechage' }, final, repechage, current], new Map(), current).length, 1,
  'losing into repechage is not elimination');
assert.equal(activeContentBlockers([opening, { ...final, status: 'FINISHED', athlete1Id: 'a', winnerId: 'a' }, current], new Map(), current).length, 0);
const pool = { ...final, id: 'pool-next', roundRobinGroupId: 'pool', athlete1Id: 'a' };
assert.equal(activeContentBlockers([lost, pool, current], new Map(), current).length, 1, 'round robin losses do not end participation');
const bye = { ...opening, athlete2Id: null, drawId: 'draw', notes: 'Generated bye', resultStatus: 'DRAFT', winMethod: 'WALKOVVER' };
assert.equal(activeContentBlockers([bye, final, current], new Map(), current).length, 0, 'an automatic bye is not an actual content start');
const teamMatch = { ...opening, athlete1Id: null, athlete2Id: null, winnerId: null, team1Id: 'team-a', team2Id: 'team-b', winnerTeamId: 'team-a' };
assert.equal(activeContentBlockers([teamMatch, final, current], new Map([['team-a', ['a', 'x']], ['team-b', ['b', 'y']]]), current).length, 1,
  'a member still competing in a team content cannot start GI');
console.log('PASS: content continuity across gaps; conservative TBD, rest, pins, locks, full-path reflow, actual elimination, repechage, pools, byes and team members.');
