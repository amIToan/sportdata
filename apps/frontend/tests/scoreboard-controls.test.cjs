const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const source = readFileSync(resolve(__dirname, '../src/lib/scoreboard-controls.ts'), 'utf8');
const moduleExports = {};
new Function('exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(moduleExports);
const { getScoreboardShortcut, resolveScoreboardShortcut } = moduleExports;
const keyboard = (code, extra = {}) => getScoreboardShortcut({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });
const state = { status: 'RUNNING', editable: true, modalOpen: false, blocked: false, runningSince: true, hasTime: true, terminal: false, canConfirmResult: false, hasActions: true, penalties: [0, 2] };
const action = (code, extra = {}, keyExtra = {}) => resolveScoreboardShortcut(keyboard(code, keyExtra), { ...state, ...extra });

test('Space starts, pauses and resumes according to match and clock state', () => {
  assert.equal(action('Space', { status: 'SCHEDULED' }).command.action, 'START');
  assert.equal(action('Space').command.action, 'PAUSE');
  assert.equal(action('Space', { runningSince: false }).command.action, 'RESUME');
  assert.equal(action('Space', { status: 'SCHEDULED', blocked: true }), null);
  assert.equal(action('Space', { runningSince: false, hasTime: false }), null);
  assert.equal(action('Space', { runningSince: false, terminal: true }), null);
  assert.equal(action('Space', { hasTime: false }).command.action, 'PAUSE');
});

test('scoring keys award the correct athlete and point value', () => {
  for (const [code, side, points] of [['KeyQ', 1, 2], ['KeyW', 1, 3], ['KeyE', 1, 4], ['KeyI', 2, 2], ['KeyO', 2, 3], ['KeyP', 2, 4]]) {
    assert.deepEqual(action(code).command, { action: 'AWARD', side, award: 'POINTS', points });
  }
  assert.deepEqual(action('KeyA').command, { action: 'AWARD', side: 1, award: 'ADVANTAGE' });
  assert.deepEqual(action('KeyL').command, { action: 'AWARD', side: 2, award: 'ADVANTAGE' });
});

test('penalty keys enter only the next level and stop at 4P', () => {
  assert.equal(action('KeyS').command.penaltyLevel, 1);
  assert.equal(action('KeyK').command.penaltyLevel, 3);
  assert.equal(action('KeyK', { penalties: [0, 3] }).command.penaltyLevel, 4);
  assert.equal(action('KeyK', { penalties: [0, 4] }), null);
});

test('submission requires Shift and attack activity remains removed', () => {
  assert.deepEqual(action('KeyD', {}, { shiftKey: true }).command, { action: 'AWARD', side: 1, award: 'SUBMISSION' });
  assert.deepEqual(action('KeyJ', {}, { shiftKey: true }).command, { action: 'AWARD', side: 2, award: 'SUBMISSION' });
  for (const code of ['KeyD', 'KeyJ']) {
    assert.equal(keyboard(code), null);
  }
  assert.equal(keyboard('Space', { ctrlKey: true }), null);
  assert.equal(keyboard('Space', { altKey: true }), null);
  assert.equal(keyboard('KeyZ', { metaKey: true, shiftKey: true }), null);
});

test('undo works after a terminal outcome, but only with an active award', () => {
  assert.equal(action('KeyU', { terminal: true }).command.action, 'UNDO');
  assert.equal(action('KeyZ', {}, { ctrlKey: true }).command.action, 'UNDO');
  assert.equal(action('KeyZ', {}, { metaKey: true }).command.action, 'UNDO');
  assert.equal(action('KeyU', { hasActions: false }), null);
  assert.equal(action('KeyQ', { terminal: true }), null);
  assert.equal(action('KeyS', { terminal: true }), null);
  assert.equal(action('KeyJ', { terminal: true }, { shiftKey: true }), null);
});

test('confirm opens only once the clock has ended or a terminal outcome is ready', () => {
  assert.equal(action('KeyR'), null);
  assert.equal(action('KeyR', { hasTime: false, canConfirmResult: true }).type, 'confirm');
  assert.equal(action('KeyR', { terminal: true, runningSince: false, canConfirmResult: true }).type, 'confirm');
  assert.equal(action('KeyR', { canConfirmResult: true }), null);
});

test('read-only, busy and modal states block mutation shortcuts', () => {
  for (const code of ['Space', 'KeyU', 'KeyR', 'KeyQ', 'KeyS', 'KeyL', 'KeyV', 'KeyB', 'KeyC', 'KeyX']) {
    assert.equal(action(code, { editable: false }), null);
    assert.equal(action(code, { modalOpen: true }), null);
    assert.equal(action(code, { status: 'FINISHED', editable: false }), null);
  }
  assert.equal(action('KeyF', { status: 'FINISHED', editable: false }).type, 'fullscreen');
  assert.equal(action('KeyH', { status: 'FINISHED', editable: false }).type, 'history');
  assert.equal(action('KeyF', { modalOpen: true }), null);
});

test('VR keys request the correct side, resolve only a pending review, and prevent forfeited/repeated requests', () => {
  const review = { cards: { 1: true, 2: false }, pendingSide: null };
  assert.deepEqual(action('KeyV', { review }).command, { action: 'REVIEW_REQUEST', side: 1 });
  assert.equal(action('KeyB', { review }), null);
  assert.equal(action('KeyC', { review }), null);
  assert.equal(action('KeyX', { review }), null);
  review.pendingSide = 1;
  assert.equal(action('KeyV', { review }), null);
  assert.equal(action('KeyB', { review }), null);
  assert.deepEqual(action('KeyC', { review }).command, { action: 'REVIEW_RESOLVE', side: 1, reviewResult: 'ACCEPTED' });
  assert.deepEqual(action('KeyX', { review }).command, { action: 'REVIEW_RESOLVE', side: 1, reviewResult: 'REJECTED' });
  assert.equal(action('Space', { review, runningSince: false }), null);
  assert.equal(action('KeyR', { review, canConfirmResult: true, hasTime: false }), null);
  assert.equal(action('KeyQ', { review }).command.award, 'POINTS');
  assert.equal(action('KeyU', { review }).command.action, 'UNDO');
  assert.equal(action('KeyU', { hasReviewActions: true }, { shiftKey: true }).command.action, 'REVIEW_UNDO');
  assert.equal(action('KeyU', { hasReviewActions: false }, { shiftKey: true }), null);
  assert.equal(action('KeyV', { review: { cards: { 1: true, 2: true }, pendingSide: null }, terminal: true }).command.action, 'REVIEW_REQUEST');
});

test('stalling keys toggle the correct side and require a running, non-terminal match to start', () => {
  assert.deepEqual(action('KeyZ').command, { action: 'STALL_START', side: 1 });
  assert.deepEqual(action('KeyT').command, { action: 'STALL_START', side: 2 });
  assert.equal(action('KeyZ', { runningSince: false }), null);
  assert.equal(action('KeyZ', { terminal: true }), null);
  assert.equal(action('KeyZ', { medicalSide: 1 }), null);
  assert.equal(action('KeyZ', { review: { cards: { 1: true, 2: true }, pendingSide: 1 } }), null);
  assert.deepEqual(action('KeyZ', { stallActive: [true, false], runningSince: false }).command, { action: 'STALL_CANCEL', side: 1 });
  assert.equal(action('KeyZ', {}, { ctrlKey: true }).command.action, 'UNDO');
});

test('medical keys pause/resume medical time, require a doctor decision, and do not reopen an exhausted timer', () => {
  assert.deepEqual(action('KeyM').command, { action: 'MEDICAL_START', side: 1 });
  assert.deepEqual(action('KeyN').command, { action: 'MEDICAL_START', side: 2 });
  assert.deepEqual(action('KeyM', { medicalSide: 1, medicalRunning: true }).command, { action: 'MEDICAL_STOP', side: 1 });
  assert.equal(action('KeyN', { medicalSide: 1 }), null);
  assert.equal(action('KeyM', { medicalSide: 1, medicalRunning: false, medicalRemaining: [0, 120000] }), null);
  assert.equal(action('Space', { medicalSide: 1, runningSince: false }), null);
  assert.equal(action('KeyR', { medicalSide: 1, runningSince: false, canConfirmResult: true }), null);
  assert.equal(action('KeyQ', { medicalSide: 1 }), null);
  assert.equal(action('KeyG'), null);
  assert.deepEqual(action('KeyG', { medicalSide: 2 }).command, { action: 'MEDICAL_DECISION', side: 2, medicalResult: 'FIT' });
  assert.deepEqual(action('KeyG', { medicalSide: 2 }, { shiftKey: true }).command, { action: 'MEDICAL_DECISION', side: 2, medicalResult: 'UNFIT' });
  assert.equal(action('KeyM', { hasMedicalDecision: true }, { shiftKey: true }).command.action, 'MEDICAL_UNDO');
});
