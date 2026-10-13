// Build first: npm run build:backend
// Run: node --test apps/backend/scripts/scoreboard-penalties.test.cjs
// Exercises the real service with an in-memory transaction fixture; no database is used.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { ScoreboardService } = require('../dist/src/results/scoreboard.service.js');
const { ScoreboardCommandDto } = require('../dist/src/results/dto/scoreboard.dto.js');
const { validateSync } = require('class-validator');
const { eventReviewCardAvailable, isScoreboardMedalMatch } = require('../dist/src/results/scoreboard-review.js');

function fixture(overrides = {}) {
  const userId = 'penalty-operator';
  const clientId = 'penalty-client-000000000000';
  const revisions = [];
  const progressions = [];
  let match = {
    id: 'penalty-match', eventId: 'event', status: 'RUNNING', resultStatus: 'DRAFT', resultVersion: 0,
    athlete1Id: 'a', athlete2Id: 'b', athlete1Score: 7, athlete2Score: 9,
    athlete1Advantages: 2, athlete2Advantages: 3, athlete1Penalties: 0, athlete2Penalties: 0,
    category: { name: 'Penalty fixture', matchDurationSeconds: 300 }, event: { name: 'Fixture' },
    ...overrides,
    resultData: {
      scoreboard: { remainingMs: 300000, runningSince: new Date().toISOString(), actions: [], ...overrides.clock },
      scoreboardLease: { key: createHash('sha256').update(`${userId}:${clientId}`).digest('hex'), expiresAt: new Date(Date.now() + (overrides.leaseDurationMs || 60000)).toISOString() },
    },
  };
  const db = {
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    match: {
      findUnique: async () => structuredClone(match),
      findMany: async ({ where }) => where.eventId ? structuredClone(overrides.previousMatches || []) : match.status === 'RUNNING' && match.resultStatus === 'DRAFT' ? [{ id: match.id, resultVersion: match.resultVersion, resultData: structuredClone(match.resultData) }] : [],
      updateMany: async ({ where, data }) => {
        if (!Object.entries(where).every(([key, value]) => match[key] === value)) return { count: 0 };
        const { resultVersion, ...rest } = data;
        match = { ...match, ...structuredClone(rest), resultVersion: match.resultVersion + resultVersion.increment };
        return { count: 1 };
      },
    },
    resultRevision: { create: async ({ data }) => revisions.push(structuredClone(data)) },
  };
  db.$transaction = async (callback) => {
    const before = structuredClone(match);
    const revisionCount = revisions.length;
    try { return await callback(db); }
    catch (error) { match = before; revisions.length = revisionCount; throw error; }
  };
  const service = new ScoreboardService(db, {
    assertScoreboardReady: async () => {},
    syncProgression: async (_, before, after) => progressions.push({ before, after }),
  });
  return {
    service, revisions, progressions,
    state: () => structuredClone(match),
    command: (action, extra = {}) => service.command(match.id, userId, { action, clientId, expectedVersion: match.resultVersion, ...extra }),
  };
}

for (const side of [1, 2]) {
  test(`side ${side}: penalties award the opponent, undo and replay without duplication`, async () => {
    const f = fixture();
    const opponent = side === 1 ? 2 : 1;
    const initial = f.state();
    const check = (board, level) => {
      assert.equal(board[`athlete${side}Penalties`], level);
      assert.equal(board[`athlete${side}Score`], initial[`athlete${side}Score`]);
      assert.equal(board[`athlete${side}Advantages`], initial[`athlete${side}Advantages`]);
      assert.equal(board[`athlete${opponent}Score`], initial[`athlete${opponent}Score`] + (level >= 3 ? 2 : 0));
      assert.equal(board[`athlete${opponent}Advantages`], initial[`athlete${opponent}Advantages`] + (level >= 2 ? 1 : 0));
    };
    for (let level = 1; level <= 4; level++) {
      const board = await f.command('AWARD', { side, award: 'PENALTY', penaltyLevel: level });
      check(board, level);
      assert.equal(board.resultData.scoreboard.actions.at(-1).penaltyLevel, level);
    }
    const terminal = await f.service.get('penalty-match');
    assert.equal(terminal.proposedWinMethod, 'DISQUALIFICATION');
    assert.equal(terminal.proposedWinnerId, initial[`athlete${opponent}Id`]);
    assert.equal(terminal.resultData.scoreboard.runningSince, null);
    await assert.rejects(f.command('AWARD', { side: opponent, award: 'POINTS', points: 2 }));
    await assert.rejects(f.command('RESUME'));
    for (let level = 3; level >= 0; level--) check(await f.command('UNDO'), level);
    await assert.rejects(f.command('UNDO'));
    assert.ok(f.state().resultData.scoreboard.actions.every((action) => action.undone));
    for (let level = 1; level <= 4; level++) check(await f.command('AWARD', { side, award: 'PENALTY', penaltyLevel: level }), level);
    assert.equal(f.revisions.length, f.state().resultVersion);
  });
}

test('penalties without an explicit level use the same sequence and stop at 4P', async () => {
  const f = fixture();
  for (let level = 1; level <= 4; level++) {
    const board = await f.command('AWARD', { side: 1, award: 'PENALTY' });
    assert.equal(board.resultData.scoreboard.actions.at(-1).penaltyLevel, level);
  }
  assert.equal(f.state().athlete2Advantages, 4);
  assert.equal(f.state().athlete2Score, 11);
  assert.equal(f.state().resultData.scoreboard.runningSince, null);
});

test('skipped levels and stale commands do not award benefits', async () => {
  const f = fixture();
  await assert.rejects(f.command('AWARD', { side: 1, award: 'PENALTY', penaltyLevel: 2 }));
  await f.command('AWARD', { side: 1, award: 'PENALTY', penaltyLevel: 1 });
  const before = f.state();
  await assert.rejects(f.command('AWARD', { side: 1, award: 'PENALTY', penaltyLevel: 3 }));
  await assert.rejects(f.command('AWARD', { side: 1, award: 'PENALTY', penaltyLevel: 2, expectedVersion: 0 }));
  assert.deepEqual(f.state(), before);
});

test('undo of legacy penalties preserves opponent benefits that were not automatically awarded', async () => {
  const f = fixture({ athlete1Penalties: 2, clock: { runningSince: null, actions: [
    { id: 1, side: 1, award: 'PENALTY', points: 1, penaltyLevel: 1, remainingMs: 300000, at: new Date().toISOString(), actor: 'legacy' },
    { id: 2, side: 1, award: 'PENALTY', points: 1, penaltyLevel: 2, remainingMs: 300000, at: new Date().toISOString(), actor: 'legacy' },
  ] } });
  const board = await f.command('UNDO');
  assert.equal(board.athlete1Penalties, 1);
  assert.equal(board.athlete2Advantages, 3);
  assert.equal(board.athlete2Score, 9);
});

test('disqualification confirms the opponent as winner while preserving earned points', async () => {
  const f = fixture();
  for (let level = 1; level <= 4; level++) await f.command('AWARD', { side: 1, award: 'PENALTY', penaltyLevel: level });
  await assert.rejects(f.command('FINISH', { winnerId: 'a', winMethod: 'DISQUALIFICATION' }));
  const board = await f.command('FINISH', { winnerId: 'b', winMethod: 'DISQUALIFICATION' });
  assert.equal(board.status, 'FINISHED');
  assert.equal(board.resultStatus, 'REFEREE_CONFIRMED');
  assert.equal(board.winnerId, 'b');
  assert.equal(board.winMethod, 'DISQUALIFICATION');
  assert.equal(board.athlete2Score, 11);
  assert.equal(f.state().resultData.scoreboardLease, undefined);
  assert.equal(f.progressions.length, 1);
});

const winnerCases = [
  { name: 'points favor A', match: { athlete1Score: 12 }, winner: 'a', method: 'POINTS' },
  { name: 'points favor B', match: {}, winner: 'b', method: 'POINTS' },
  { name: 'equal points, advantages favor A', match: { athlete1Score: 9, athlete1Advantages: 4 }, winner: 'a', method: 'DECISION' },
  { name: 'equal points, advantages favor B', match: { athlete1Score: 9 }, winner: 'b', method: 'DECISION' },
  { name: 'equal points and advantages, fewer penalties for A', match: { athlete1Score: 9, athlete1Advantages: 3, athlete2Penalties: 1 }, winner: 'a', method: 'DECISION' },
  { name: 'equal points and advantages, fewer penalties for B', match: { athlete1Score: 9, athlete1Advantages: 3, athlete1Penalties: 1 }, winner: 'b', method: 'DECISION' },
  { name: 'submission by A overrides points', match: {}, action: { side: 1, award: 'SUBMISSION' }, winner: 'a', method: 'SUBMISSION' },
  { name: 'submission by B overrides points', match: { athlete1Score: 20 }, action: { side: 2, award: 'SUBMISSION' }, winner: 'b', method: 'SUBMISSION' },
  { name: '4P for A awards B the win despite lower points', match: { athlete1Score: 20, athlete1Penalties: 4 }, winner: 'b', method: 'DISQUALIFICATION' },
  { name: '4P for B awards A the win despite lower points', match: { athlete2Penalties: 4 }, winner: 'a', method: 'DISQUALIFICATION' },
];

for (const scenario of winnerCases) {
  test(`proposed winner: ${scenario.name}`, async () => {
    const f = fixture({ ...scenario.match, clock: { remainingMs: 0, runningSince: null, actions: scenario.action ? [{ id: 1, points: 1, at: new Date().toISOString(), remainingMs: 0, actor: 'fixture', ...scenario.action }] : [] } });
    const board = await f.service.get('penalty-match');
    assert.equal(board.proposedWinnerId, scenario.winner);
    assert.equal(board.proposedWinMethod, scenario.method);
    await assert.rejects(f.command('FINISH', { winnerId: scenario.winner === 'a' ? 'b' : 'a', winMethod: scenario.method }));
    const confirmed = await f.command('FINISH', { winnerId: scenario.winner, winMethod: scenario.method });
    assert.equal(confirmed.winnerId, scenario.winner);
  });
}

for (const winnerId of ['a', 'b']) {
  test(`legacy attack activity does not break a tie; referee can choose ${winnerId}`, async () => {
    const action = (side, undone = false) => ({ id: side, side, award: 'ATTACK', points: 1, remainingMs: 0, at: new Date().toISOString(), actor: 'fixture', undone });
    for (const actions of [[], [action(1)], [action(2)], [action(1), action(2), action(1, true)]]) {
      const f = fixture({ athlete1Score: 9, athlete1Advantages: 3, clock: { remainingMs: 0, runningSince: null, actions } });
      const board = await f.service.get('penalty-match');
      assert.equal(board.proposedWinnerId, null);
      assert.equal(board.proposedWinMethod, null);
      assert.equal(board.outcomeReason, null);
      assert.deepEqual(board.resultData.scoreboard.actions, actions);
      await assert.rejects(f.command('FINISH', { winnerId, winMethod: 'POINTS' }));
      const confirmed = await f.command('FINISH', { winnerId, winMethod: 'DECISION' });
      assert.equal(confirmed.winnerId, winnerId);
      assert.equal(confirmed.winMethod, 'DECISION');
    }
  });
}

test('unsupported awards are rejected without changing the board or history', async () => {
  const f = fixture();
  const before = f.state();
  for (const side of [1, 2]) {
    for (const award of ['ATTACK', 'UNKNOWN']) {
      await assert.rejects(f.command('AWARD', { side, award }), /Loại điểm không được hỗ trợ/);
      assert.deepEqual(f.state(), before);
      assert.equal(f.revisions.length, 0);
    }
  }
});

test('API validation accepts supported awards and rejects attack activity', () => {
  for (const award of ['POINTS', 'ADVANTAGE', 'PENALTY', 'SUBMISSION', 'ATTACK']) {
    const dto = Object.assign(new ScoreboardCommandDto(), { clientId: 'validation-client-000000', expectedVersion: 0, action: 'AWARD', side: 1, award, points: 2 });
    const errors = validateSync(dto);
    if (award === 'ATTACK') assert.ok(errors.some((error) => error.property === 'award' && error.constraints.isIn));
    else assert.deepEqual(errors, []);
  }
});

for (const side of [1, 2]) {
  const opponent = side === 1 ? 2 : 1;
  const winnerId = side === 1 ? 'a' : 'b';
  const opponentId = side === 1 ? 'b' : 'a';

  test(`side ${side}: submission saves 50 points, undo restores the prior score, and confirmation keeps submission`, async () => {
    const f = fixture();
    const initial = f.state();
    const field = `athlete${side}Score`;
    const awarded = await f.command('AWARD', { side, award: 'SUBMISSION' });
    assert.equal(awarded[field], 50);
    assert.equal(awarded[`athlete${opponent}Score`], initial[`athlete${opponent}Score`]);
    assert.equal(f.state()[field], 50);
    assert.equal((await f.service.get('penalty-match'))[field], 50);
    assert.equal(awarded.proposedWinnerId, winnerId);
    assert.equal(awarded.proposedWinMethod, 'SUBMISSION');
    assert.equal(awarded.resultData.scoreboard.runningSince, null);
    assert.deepEqual(awarded.resultData.scoreboard.actions.at(-1).scoreChanges, [{ side, before: initial[field], after: 50 }]);
    await assert.rejects(f.command('RESUME'));
    await assert.rejects(f.command('AWARD', { side: opponent, award: 'POINTS', points: 4 }));
    await assert.rejects(f.command('FINISH', { winnerId, winMethod: 'POINTS' }));
    await assert.rejects(f.command('FINISH', { winnerId: opponentId, winMethod: 'SUBMISSION' }));
    const undone = await f.command('UNDO');
    assert.equal(undone[field], initial[field]);
    assert.equal(undone.resultData.scoreboard.actions.at(-1).undone, true);
    assert.equal((await f.command('RESUME')).status, 'RUNNING');
    await f.command('AWARD', { side, award: 'SUBMISSION' });
    const confirmed = await f.command('FINISH', { winnerId, winMethod: 'SUBMISSION' });
    assert.equal(confirmed[field], 50);
    assert.equal(confirmed.winnerId, winnerId);
    assert.equal(confirmed.winMethod, 'SUBMISSION');
  });

  test(`side ${side}: reaching or crossing 50 stops the match, preserves the first winner, and undoes the exact increment`, async () => {
    for (const [before, points] of [[46, 4], [47, 3], [47, 4], [48, 2], [48, 3], [48, 4], [49, 2], [49, 3], [49, 4]]) {
      const field = `athlete${side}Score`;
      const f = fixture({ [field]: before, [`athlete${opponent}Score`]: 49 });
      const board = await f.command('AWARD', { side, award: 'POINTS', points });
      assert.equal(board[field], 50);
      assert.equal(f.state()[field], 50);
      assert.equal(board.proposedWinnerId, winnerId);
      assert.equal(board.proposedWinMethod, 'POINTS');
      assert.equal(board.outcomeReason, 'Đạt 50 điểm trước');
      assert.equal(board.resultData.scoreboard.runningSince, null);
      const latest = board.resultData.scoreboard.actions.at(-1);
      assert.equal(latest.points, points, 'History retains the requested point button');
      assert.deepEqual(latest.scoreChanges, [{ side, before, after: 50 }]);
      const terminal = f.state();
      await assert.rejects(f.command('AWARD', { side: opponent, award: 'POINTS', points: 2 }));
      await assert.rejects(f.command('AWARD', { side, award: 'SUBMISSION' }));
      await assert.rejects(f.command('AWARD', { side: opponent, award: 'POINTS', points: 2, expectedVersion: 0 }));
      await assert.rejects(f.command('RESUME'));
      assert.deepEqual(f.state(), terminal);
      assert.equal((await f.service.get('penalty-match')).proposedWinnerId, winnerId);
      const undone = await f.command('UNDO');
      assert.equal(undone[field], before);
      assert.equal(undone.resultData.scoreboard.runningSince, null);
      await f.command('RESUME');
      await f.command('AWARD', { side, award: 'POINTS', points });
      await assert.rejects(f.command('FINISH', { winnerId: opponentId, winMethod: 'POINTS' }));
      const confirmed = await f.command('FINISH', { winnerId, winMethod: 'POINTS' });
      assert.equal(confirmed[field], 50);
      assert.equal(confirmed.winnerId, winnerId);
      await assert.rejects(f.command('UNDO'));
    }
  });

  test(`side ${side}: the opponent's 3P bonus can reach 50 and undo restores both scores and penalties`, async () => {
    const opponentField = `athlete${opponent}Score`;
    const penaltyField = `athlete${side}Penalties`;
    const f = fixture({ [opponentField]: 49, [penaltyField]: 2 });
    const awarded = await f.command('AWARD', { side, award: 'PENALTY', penaltyLevel: 3 });
    assert.equal(awarded[opponentField], 50);
    assert.equal(awarded[penaltyField], 3);
    assert.equal(awarded.proposedWinnerId, opponentId);
    assert.equal(awarded.proposedWinMethod, 'POINTS');
    assert.equal(awarded.resultData.scoreboard.runningSince, null);
    assert.deepEqual(awarded.resultData.scoreboard.actions.at(-1).scoreChanges, [{ side: opponent, before: 49, after: 50 }]);
    const undone = await f.command('UNDO');
    assert.equal(undone[opponentField], 49);
    assert.equal(undone[penaltyField], 2);
    await f.command('AWARD', { side, award: 'PENALTY', penaltyLevel: 3 });
    const confirmed = await f.command('FINISH', { winnerId: opponentId, winMethod: 'POINTS' });
    assert.equal(confirmed[opponentField], 50);
    assert.equal(confirmed.winnerId, opponentId);
  });
}

test('undo of a legacy submission preserves the earned score that it never changed', async () => {
  const f = fixture({ clock: { runningSince: null, actions: [{ id: 1, side: 1, award: 'SUBMISSION', points: 1, remainingMs: 300000, at: new Date().toISOString(), actor: 'legacy' }] } });
  const board = await f.command('UNDO');
  assert.equal(board.athlete1Score, 7);
  assert.equal(board.athlete2Score, 9);
  assert.equal(board.resultData.scoreboard.actions[0].undone, true);
});

test('a completed correction uses the saved winner and method while preserving historical scoring actions', async () => {
  const f = fixture({ status: 'FINISHED', resultStatus: 'ENTERED', winnerId: 'b', winMethod: 'POINTS', clock: {
    remainingMs: 0, runningSince: null, resultCorrection: { reason: 'Correct referee input' },
    actions: [{ id: 1, side: 1, award: 'SUBMISSION', points: 1, remainingMs: 0, at: new Date().toISOString(), actor: 'fixture' }],
  } });
  const board = await f.service.get('penalty-match');
  assert.equal(board.proposedWinnerId, 'b');
  assert.equal(board.proposedWinMethod, 'POINTS');
  assert.equal(board.resultData.scoreboard.actions[0].award, 'SUBMISSION');
});

for (const side of [1, 2]) {
  test(`VR side ${side}: accepted challenges retain the card; a rejected challenge ends eligibility`, async () => {
    const f = fixture();
    const other = side === 1 ? 2 : 1;
    const initial = f.state();
    assert.deepEqual((await f.service.get('penalty-match')).videoReview, { cards: { 1: true, 2: true }, pendingSide: null });
    for (let attempt = 0; attempt < 3; attempt++) {
      const requested = await f.command('REVIEW_REQUEST', { side });
      assert.equal(requested.videoReview.pendingSide, side);
      assert.equal(requested.resultData.scoreboard.runningSince, null);
      assert.equal(requested.resultData.scoreboard.actions.at(-1).actor, 'penalty-operator');
      await assert.rejects(f.command('REVIEW_REQUEST', { side: other }));
      await assert.rejects(f.command('RESUME'));
      await assert.rejects(f.command('FINISH', { winnerId: 'b', winMethod: 'POINTS' }));
      await assert.rejects(f.command('REVIEW_RESOLVE', { side: other, reviewResult: 'ACCEPTED' }));
      const resolved = await f.command('REVIEW_RESOLVE', { side, reviewResult: 'ACCEPTED' });
      assert.equal(resolved.videoReview.cards[side], true);
      assert.equal(resolved.videoReview.pendingSide, null);
      assert.equal(resolved.athlete1Score, initial.athlete1Score);
      assert.equal(resolved.athlete2Score, initial.athlete2Score);
      assert.equal(resolved.resultData.scoreboard.runningSince, null);
      await f.command('RESUME');
    }
    await f.command('REVIEW_REQUEST', { side });
    const denied = await f.command('REVIEW_RESOLVE', { side, reviewResult: 'REJECTED' });
    assert.equal(denied.videoReview.cards[side], false);
    assert.equal(denied.videoReview.cards[other], true);
    assert.deepEqual((await f.service.get('penalty-match')).videoReview, denied.videoReview);
    await assert.rejects(f.command('REVIEW_REQUEST', { side }));
    await assert.rejects(f.command('REVIEW_RESOLVE', { side, reviewResult: 'ACCEPTED' }));
    assert.equal((await f.command('REVIEW_REQUEST', { side: other })).videoReview.pendingSide, other);
  });
}

test('VR and scoring have independent undo histories, including correction of a terminal score', async () => {
  const f = fixture({ athlete1Score: 48 });
  await f.command('AWARD', { side: 1, award: 'POINTS', points: 4 });
  await f.command('REVIEW_REQUEST', { side: 2 });
  const corrected = await f.command('UNDO');
  assert.equal(corrected.athlete1Score, 48);
  assert.equal(corrected.videoReview.pendingSide, 2);
  await f.command('REVIEW_RESOLVE', { side: 2, reviewResult: 'REJECTED' });
  const restored = await f.command('REVIEW_UNDO');
  assert.equal(restored.videoReview.cards[2], true);
  assert.equal(restored.videoReview.pendingSide, 2);
  assert.equal(restored.athlete1Score, 48);
  const cancelled = await f.command('REVIEW_UNDO');
  assert.equal(cancelled.videoReview.pendingSide, null);
  assert.equal(cancelled.athlete1Score, 48);
  await assert.rejects(f.command('REVIEW_UNDO'));
  await assert.rejects(f.command('UNDO'));
});

test('VR rejects missing/invalid data, stale revisions, missing leases and finished matches atomically', async () => {
  const f = fixture();
  const initial = f.state();
  await assert.rejects(f.command('REVIEW_REQUEST'));
  await assert.rejects(f.command('REVIEW_REQUEST', { side: 3 }));
  await assert.rejects(f.command('REVIEW_RESOLVE', { side: 1, reviewResult: 'ACCEPTED' }));
  assert.deepEqual(f.state(), initial);
  await f.command('REVIEW_REQUEST', { side: 1 });
  const pending = f.state();
  await assert.rejects(f.command('REVIEW_RESOLVE', { side: 1 }));
  await assert.rejects(f.command('REVIEW_RESOLVE', { side: 1, reviewResult: 'UNKNOWN' }));
  await assert.rejects(f.command('REVIEW_RESOLVE', { side: 1, reviewResult: 'REJECTED', expectedVersion: 0 }));
  await assert.rejects(f.command('REVIEW_RESOLVE', { side: 1, reviewResult: 'REJECTED', clientId: 'other-client' }));
  assert.deepEqual(f.state(), pending);
  await f.command('REVIEW_RESOLVE', { side: 1, reviewResult: 'ACCEPTED' });
  await f.command('FINISH', { winnerId: 'b', winMethod: 'POINTS' });
  const finished = f.state();
  for (const action of ['REVIEW_REQUEST', 'REVIEW_RESOLVE', 'REVIEW_UNDO']) await assert.rejects(f.command(action, { side: 1, reviewResult: 'REJECTED' }));
  assert.deepEqual(f.state(), finished);
});

const pastRejection = (extra = {}) => ({ athlete1Id: 'a', athlete2Id: 'old-opponent', matchType: 'ELIMINATION',
  resultData: { scoreboard: { startedAt: '2026-01-01T00:00:00Z', actions: [
    { id: 1, side: 1, award: 'REVIEW_REQUEST', at: '2026-01-01T00:01:00Z' },
    { id: 2, side: 1, award: 'REVIEW_REJECTED', at: '2026-01-01T00:02:00Z' },
  ] } }, ...extra });

test('a rejected challenge carries across the event, while gold and generated bronze matches restore eligibility', async () => {
  const prior = pastRejection();
  for (const medal of [
    { matchType: 'FINAL', winnerToMatchId: null },
    { matchType: 'ELIMINATION', draw: { type: 'REPECHAGE' }, notes: 'Generated repechage bronze medal A', winnerToMatchId: null },
    { matchType: 'ELIMINATION', draw: { type: 'REPECHAGE' }, notes: 'Generated repechage bronze medal B', winnerToMatchId: null },
  ]) {
    const f = fixture({ ...medal, previousMatches: [prior] });
    assert.equal((await f.command('REVIEW_REQUEST', { side: 1 })).videoReview.pendingSide, 1);
    assert.equal((await f.command('REVIEW_RESOLVE', { side: 1, reviewResult: 'REJECTED' })).videoReview.cards[1], false);
    await assert.rejects(f.command('REVIEW_REQUEST', { side: 1 }));
  }
  for (const nonMedal of [
    { matchType: 'ELIMINATION' },
    { matchType: 'SEMIFINAL' },
    { matchType: 'FINAL', winnerToMatchId: 'grand-final' },
    { matchType: 'ELIMINATION', draw: { type: 'REPECHAGE' }, notes: 'Generated repechage · round 1', winnerToMatchId: 'bronze-match' },
    { matchType: 'ELIMINATION', draw: { type: 'MAIN_TREE' }, notes: 'Generated repechage bronze medal A' },
  ]) {
    const f = fixture({ ...nonMedal, previousMatches: [prior] });
    assert.equal((await f.service.get('penalty-match')).videoReview.cards[1], false);
    assert.equal((await f.service.get('penalty-match')).videoReview.cards[2], true);
    await assert.rejects(f.command('REVIEW_REQUEST', { side: 1 }));
    assert.equal((await f.command('REVIEW_REQUEST', { side: 2 })).videoReview.pendingSide, 2);
  }
});

test('event eligibility uses chronology and athlete identity, ignores undone rejections, and honors medal reset then forfeiture', () => {
  const before = Date.parse('2026-03-01');
  const rejected = pastRejection();
  assert.equal(eventReviewCardAvailable('a', [rejected], before), false);
  assert.equal(eventReviewCardAvailable('b', [rejected], before), true);
  assert.equal(eventReviewCardAvailable('a', [rejected], Date.parse('2025-12-01')), true);
  const undone = structuredClone(rejected);
  undone.resultData.scoreboard.actions[1].undone = true;
  assert.equal(eventReviewCardAvailable('a', [undone], before), true);
  const medal = { athlete2Id: 'a', matchType: 'FINAL', resultData: { scoreboard: { startedAt: '2026-02-01', actions: [] } } };
  assert.equal(eventReviewCardAvailable('a', [medal, rejected], before), true);
  medal.resultData.scoreboard.actions.push({ side: 2, award: 'REVIEW_REJECTED', at: '2026-02-01T00:10:00Z' });
  assert.equal(eventReviewCardAvailable('a', [medal, rejected], before), false);
  assert.equal(isScoreboardMedalMatch({ matchType: 'FINAL', winnerToMatchId: 'later-match' }), false);
});

async function withFakeClock(work) {
  const OriginalDate = global.Date;
  let now = OriginalDate.parse('2026-10-12T00:00:00Z');
  class FakeDate extends OriginalDate {
    constructor(...args) { if (args.length) super(...args); else super(now); }
    static now() { return now; }
  }
  global.Date = FakeDate;
  try { await work((ms) => { now += ms; }); } finally { global.Date = OriginalDate; }
}

for (const side of [1, 2]) {
  test(`side ${side}: stalling expires once at 10 seconds, follows sequential penalties and survives an expired lease`, async () => withFakeClock(async (advance) => {
    const f = fixture({ leaseDurationMs: 3600000 });
    const opponent = side === 1 ? 2 : 1;
    const initial = f.state();
    for (let level = 1; level <= 4; level++) {
      const started = await f.command('STALL_START', { side });
      assert.ok(started.resultData.scoreboard.runningSince);
      advance(9999);
      await f.service.settleAuxiliaryTimers();
      assert.equal(f.state()[`athlete${side}Penalties`], level - 1);
      advance(1);
      await f.service.settleAuxiliaryTimers();
      const after = f.state();
      assert.equal(after[`athlete${side}Penalties`], level);
      assert.equal(after.resultData.scoreboard.auxiliaryTimers[side].stall.active, false);
      assert.equal(after.resultData.scoreboard.actions.at(-1).source, 'STALLING_TIMER');
      assert.equal(after.resultData.scoreboard.actions.at(-1).actor, 'penalty-operator');
      const version = after.resultVersion;
      await f.service.settleAuxiliaryTimers();
      assert.equal(f.state().resultVersion, version);
    }
    assert.equal(f.state()[`athlete${opponent}Score`], initial[`athlete${opponent}Score`] + 2);
    assert.equal(f.state()[`athlete${opponent}Advantages`], initial[`athlete${opponent}Advantages`] + 1);
    assert.equal(f.state().resultData.scoreboard.runningSince, null);
    await f.command('UNDO');
    assert.equal(f.state()[`athlete${side}Penalties`], 3);
    await f.command('RESUME');
    await f.command('STALL_START', { side });
    // Automatic expiry is independent of a browser/controlling lease remaining alive.
    advance(3600000);
    await f.service.settleAuxiliaryTimers();
    assert.equal(f.state()[`athlete${side}Penalties`], 4);
  }));
}

test('stalling cancellation, pause/resume and manual penalties prevent duplicate automatic penalties', async () => withFakeClock(async (advance) => {
  const f = fixture();
  await f.command('STALL_START', { side: 1 });
  advance(4000);
  await f.command('STALL_CANCEL', { side: 1 });
  assert.equal(f.state().resultData.scoreboard.auxiliaryTimers[1].stall.remainingMs, 0);
  assert.equal(f.state().resultData.scoreboard.auxiliaryTimers[1].stall.runningSince, null);
  advance(10000);
  await f.service.settleAuxiliaryTimers();
  assert.equal(f.state().athlete1Penalties, 0);
  await f.command('STALL_START', { side: 1 });
  assert.equal(f.state().resultData.scoreboard.auxiliaryTimers[1].stall.remainingMs, 10000);
  advance(4000);
  await f.command('PAUSE');
  assert.equal(f.state().resultData.scoreboard.auxiliaryTimers[1].stall.remainingMs, 6000);
  advance(10000);
  await f.service.settleAuxiliaryTimers();
  assert.equal(f.state().athlete1Penalties, 0);
  await f.command('RESUME');
  advance(6000);
  await f.service.settleAuxiliaryTimers();
  assert.equal(f.state().athlete1Penalties, 1);
  await f.command('STALL_START', { side: 1 });
  await f.command('AWARD', { side: 1, award: 'PENALTY' });
  advance(10000);
  await f.service.settleAuxiliaryTimers();
  assert.equal(f.state().athlete1Penalties, 2);
}));

test('stalling does not award a penalty after the match clock ends before its deadline', async () => withFakeClock(async (advance) => {
  const f = fixture({ clock: { remainingMs: 5000 } });
  await f.command('STALL_START', { side: 1 });
  advance(10000);
  await f.service.settleAuxiliaryTimers();
  assert.equal(f.state().athlete1Penalties, 0);
  assert.equal(f.state().resultData.scoreboard.auxiliaryTimers[1].stall.active, false);
}));

test('a stalling countdown that already expired is settled once even if medical assessment starts before the worker ticks', async () => withFakeClock(async (advance) => {
  const f = fixture();
  await f.command('STALL_START', { side: 1 });
  advance(10000);
  await f.command('MEDICAL_START', { side: 2 });
  await f.service.settleAuxiliaryTimers();
  assert.equal(f.state().athlete1Penalties, 1);
  assert.equal(f.state().resultData.scoreboard.auxiliaryTimers[2].medical.active, true);
  assert.equal(f.state().resultData.scoreboard.runningSince, null);
  const version = f.state().resultVersion;
  await f.service.settleAuxiliaryTimers();
  assert.equal(f.state().resultVersion, version);
}));

for (const side of [1, 2]) {
  test(`side ${side}: medical time accumulates over sessions, freezes the match/stalling, and is unavailable once exhausted`, async () => withFakeClock(async (advance) => {
    const f = fixture({ leaseDurationMs: 3600000 });
    const other = side === 1 ? 2 : 1;
    await f.command('STALL_START', { side: other });
    advance(3000);
    await f.command('MEDICAL_START', { side });
    const mainRemaining = f.state().resultData.scoreboard.remainingMs;
    assert.equal(f.state().resultData.scoreboard.runningSince, null);
    assert.equal(f.state().resultData.scoreboard.auxiliaryTimers[other].stall.remainingMs, 7000);
    advance(30000);
    await f.command('MEDICAL_STOP', { side });
    assert.equal(f.state().resultData.scoreboard.auxiliaryTimers[side].medical.remainingMs, 90000);
    await assert.rejects(f.command('RESUME'));
    await assert.rejects(f.command('MEDICAL_START', { side: other }));
    await assert.rejects(f.command('AWARD', { side, award: 'POINTS', points: 2 }));
    advance(10000);
    await f.command('MEDICAL_START', { side });
    advance(20000);
    await f.command('MEDICAL_DECISION', { side, medicalResult: 'FIT' });
    assert.equal(f.state().resultData.scoreboard.remainingMs, mainRemaining);
    assert.equal(f.state().resultData.scoreboard.auxiliaryTimers[side].medical.remainingMs, 70000);
    await f.command('RESUME');
    await f.command('MEDICAL_START', { side });
    advance(70000);
    await f.service.settleAuxiliaryTimers();
    const exhausted = f.state().resultData.scoreboard.auxiliaryTimers[side].medical;
    assert.equal(exhausted.remainingMs, 0);
    assert.equal(exhausted.exhausted, true);
    assert.equal(exhausted.active, true);
    assert.equal((await f.service.get('penalty-match')).proposedWinMethod, 'POINTS', 'No automatic medical loss is proposed');
    const version = f.state().resultVersion;
    await f.service.settleAuxiliaryTimers();
    assert.equal(f.state().resultVersion, version);
    await assert.rejects(f.command('MEDICAL_START', { side }));
    await assert.rejects(f.command('RESUME'));
    await assert.rejects(f.command('FINISH', { winnerId: 'b', winMethod: 'POINTS' }));
    await f.command('MEDICAL_DECISION', { side, medicalResult: 'FIT' });
    await assert.rejects(f.command('MEDICAL_START', { side }));
    await f.command('RESUME');
    assert.equal(f.state().resultData.scoreboard.auxiliaryTimers[side].medical.remainingMs, 0);
  }));

  test(`side ${side}: only the doctor's unfit decision proposes a medical loss, and correction does not restore consumed time`, async () => withFakeClock(async (advance) => {
    const f = fixture();
    const winnerId = side === 1 ? 'b' : 'a';
    await f.command('MEDICAL_START', { side });
    advance(15000);
    const result = await f.command('MEDICAL_DECISION', { side, medicalResult: 'UNFIT' });
    assert.equal(result.proposedWinnerId, winnerId);
    assert.equal(result.proposedWinMethod, 'WALKOVVER');
    assert.ok(result.outcomeReason.includes('y tế'));
    await assert.rejects(f.command('RESUME'));
    await f.command('MEDICAL_UNDO');
    assert.equal(f.state().resultData.scoreboard.auxiliaryTimers[side].medical.remainingMs, 105000);
    assert.equal(f.state().resultData.scoreboard.auxiliaryTimers[side].medical.active, true);
    assert.equal(f.revisions.at(-1).before.resultData.scoreboard.actions.at(-1).undone, undefined, 'Before revision is not mutated by undo');
    await f.command('MEDICAL_DECISION', { side, medicalResult: 'UNFIT' });
    const saved = await f.command('FINISH', { winnerId, winMethod: 'WALKOVVER' });
    assert.equal(saved.status, 'FINISHED');
    assert.equal(saved.winnerId, winnerId);
  }));
}
