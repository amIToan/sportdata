// Run: node --test apps/frontend/tests/scoreboard-result.test.cjs
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const source = readFileSync(resolve(__dirname, '../src/lib/scoreboard-result.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleExports = {};
new Function('exports', code)(moduleExports);
const { getScoreboardResultSelection, isScoreboardTerminal } = moduleExports;
const board = { id: 'match', resultVersion: 1, athlete1Id: 'a', athlete2Id: 'b', proposedWinnerId: null, proposedWinMethod: null };
const manual = (athleteId, overrides = {}) => ({ boardId: board.id, resultVersion: board.resultVersion, athleteId, ...overrides });

test('automatic winner follows the server ID, including the second athlete', () => {
  for (const winnerId of ['a', 'b']) {
    for (const winMethod of ['POINTS', 'DECISION', 'SUBMISSION', 'DISQUALIFICATION', 'WALKOVVER']) {
      assert.deepEqual(getScoreboardResultSelection({ ...board, proposedWinnerId: winnerId, proposedWinMethod: winMethod }, manual(winnerId === 'a' ? 'b' : 'a')), { winnerId, winMethod, automatic: true });
    }
  }
});

test('polling a different winner updates the selection immediately', () => {
  const previous = { ...board, proposedWinnerId: 'a', proposedWinMethod: 'POINTS' };
  const updated = { ...previous, resultVersion: 2, proposedWinnerId: 'b', proposedWinMethod: 'DISQUALIFICATION' };
  assert.equal(getScoreboardResultSelection(previous, null).winnerId, 'a');
  assert.deepEqual(getScoreboardResultSelection(updated, manual('a')), { winnerId: 'b', winMethod: 'DISQUALIFICATION', automatic: true });
});

test('a complete tie starts blank and permits either referee choice', () => {
  assert.deepEqual(getScoreboardResultSelection(board, null), { winnerId: '', winMethod: 'DECISION', automatic: false });
  for (const winnerId of ['a', 'b']) {
    assert.deepEqual(getScoreboardResultSelection(board, manual(winnerId)), { winnerId, winMethod: 'DECISION', automatic: false });
  }
});

test('unchanged polling preserves a manual choice, while a changed result clears it', () => {
  assert.equal(getScoreboardResultSelection({ ...board }, manual('b')).winnerId, 'b');
  assert.equal(getScoreboardResultSelection({ ...board, resultVersion: 2 }, manual('b')).winnerId, '');
});

test('another match or athlete cannot populate the winner selector', () => {
  assert.equal(getScoreboardResultSelection(board, manual('a', { boardId: 'other-match' })).winnerId, '');
  assert.equal(getScoreboardResultSelection(board, manual('outsider')).winnerId, '');
  assert.equal(getScoreboardResultSelection({ ...board, proposedWinnerId: 'outsider' }, manual('a')).winnerId, '');
  assert.equal(getScoreboardResultSelection(undefined, manual('a')).winnerId, '');
});

test('50 points ends the match before the clock expires and preserves the server-selected winner', () => {
  assert.equal(isScoreboardTerminal(undefined), false);
  assert.equal(isScoreboardTerminal({ ...board, athlete1Score: 49, athlete2Score: 49, proposedWinMethod: 'POINTS' }), false);
  for (const winnerId of ['a', 'b']) {
    const updated = { ...board, athlete1Score: winnerId === 'a' ? 50 : 49, athlete2Score: winnerId === 'b' ? 50 : 49, proposedWinnerId: winnerId, proposedWinMethod: 'POINTS' };
    assert.equal(isScoreboardTerminal(updated), true);
    assert.deepEqual(getScoreboardResultSelection(updated, null), { winnerId, winMethod: 'POINTS', automatic: true });
  }
  for (const proposedWinMethod of ['SUBMISSION', 'DISQUALIFICATION']) {
    assert.equal(isScoreboardTerminal({ ...board, proposedWinMethod }), true);
  }
});
