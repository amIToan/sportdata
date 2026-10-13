const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const exportsUnderTest = {};
const source = readFileSync(resolve(__dirname, '../src/lib/scoreboard-timers.ts'), 'utf8');
new Function('exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exportsUnderTest);
const { auxiliaryTimerDisplay, recentAuxiliaryTimerMode } = exportsUnderTest;
const now = Date.parse('2026-10-12T00:00:00Z');
const timers = () => ({ stall: { remainingMs: 10000, runningSince: null, active: false }, medical: { remainingMs: 120000, runningSince: null, active: false } });

test('one standby clock switches to LUTE and counts down from ten seconds', () => {
  assert.equal(auxiliaryTimerDisplay(undefined, null, now).remainingMs, 0);
  const state = timers();
  state.stall = { remainingMs: 10000, runningSince: new Date(now).toISOString(), active: true };
  assert.equal(auxiliaryTimerDisplay(state, 'stall', now).remainingMs, 10000);
  assert.equal(auxiliaryTimerDisplay(state, 'stall', now + 3000).remainingMs, 7000);
  assert.equal(auxiliaryTimerDisplay(state, 'stall', now + 11000).remainingMs, 0);
});

test('medical examination uses the same display while retaining the paused LUTE clock', () => {
  const state = timers();
  state.stall = { remainingMs: 7000, runningSince: null, active: true };
  state.medical = { remainingMs: 120000, runningSince: new Date(now).toISOString(), active: true };
  const medical = auxiliaryTimerDisplay(state, 'stall', now + 30000);
  assert.equal(medical.mode, 'medical');
  assert.equal(medical.remainingMs, 90000);
  assert.equal(state.stall.remainingMs, 7000);
  state.medical = { remainingMs: 90000, runningSince: null, active: false };
  assert.equal(auxiliaryTimerDisplay(state, 'medical', now).remainingMs, 90000);
  state.stall.runningSince = new Date(now).toISOString();
  assert.equal(auxiliaryTimerDisplay(state, 'medical', now + 2000).remainingMs, 5000);
});

test('exhausted medical time is displayed until a new LUTE countdown takes over', () => {
  const state = timers();
  state.medical = { remainingMs: 0, runningSince: null, active: true, exhausted: true };
  assert.equal(auxiliaryTimerDisplay(state, 'medical', now).exhausted, true);
  state.medical.active = false;
  state.stall = { remainingMs: 10000, runningSince: new Date(now).toISOString(), active: true };
  const lute = auxiliaryTimerDisplay(state, 'medical', now);
  assert.equal(lute.mode, 'stall');
  assert.equal(lute.remainingMs, 10000);
  assert.equal(lute.exhausted, false);
});

test('reload chooses the latest effective timer mode for the correct athlete', () => {
  const actions = [
    { side: 1, award: 'MEDICAL_START' },
    { side: 2, award: 'STALL_START' },
    { side: 1, award: 'MEDICAL_FIT' },
    { side: 1, award: 'PENALTY', source: 'STALLING_TIMER' },
    { side: 1, award: 'MEDICAL_UNFIT', undone: true },
    { side: 1, award: 'POINTS' },
  ];
  assert.equal(recentAuxiliaryTimerMode(actions, 1), 'stall');
  assert.equal(recentAuxiliaryTimerMode(actions, 2), 'stall');
  assert.equal(recentAuxiliaryTimerMode(actions.slice(0, 3), 1), 'medical');
  assert.equal(recentAuxiliaryTimerMode([], 1), null);
});
