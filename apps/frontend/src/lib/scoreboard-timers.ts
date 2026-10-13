export type ScoreboardAuxiliaryTimer = { remainingMs: number; runningSince: string | null; active: boolean; exhausted?: boolean };
export type ScoreboardAuxiliaryTimers = { 1: { stall: ScoreboardAuxiliaryTimer; medical: ScoreboardAuxiliaryTimer }; 2: { stall: ScoreboardAuxiliaryTimer; medical: ScoreboardAuxiliaryTimer } };
export const AUXILIARY_TIMER_AWARDS = ['STALL_START', 'STALL_CANCEL', 'MEDICAL_START', 'MEDICAL_STOP', 'MEDICAL_EXHAUSTED', 'MEDICAL_FIT', 'MEDICAL_UNFIT'];

export function auxiliaryTimerRemaining(timer: ScoreboardAuxiliaryTimer | undefined, now: number, defaultMs: number) {
  return Math.max(0, (timer?.remainingMs ?? defaultMs) - (timer?.runningSince ? Math.max(0, now - Date.parse(timer.runningSince)) : 0));
}

export function medicalTimerSide(timers: ScoreboardAuxiliaryTimers | undefined): 1 | 2 | null {
  return timers?.[1].medical.active ? 1 : timers?.[2].medical.active ? 2 : null;
}

export type AuxiliaryTimerMode = 'stall' | 'medical' | null;

export function recentAuxiliaryTimerMode(actions: { side: number; award: string; source?: string; undone?: boolean }[], side: 1 | 2): AuxiliaryTimerMode {
  for (let index = actions.length - 1; index >= 0; index--) {
    const action = actions[index];
    if (action.undone || action.side !== side) continue;
    if (action.award.startsWith('MEDICAL_')) return 'medical';
    if (action.award.startsWith('STALL_') || action.source === 'STALLING_TIMER') return 'stall';
  }
  return null;
}

export function auxiliaryTimerDisplay(timers: ScoreboardAuxiliaryTimers[1] | undefined, recentMode: AuxiliaryTimerMode, now: number) {
  const mode = timers?.medical.active ? 'medical' : timers?.stall.runningSince ? 'stall' : recentMode || (timers?.stall.active ? 'stall' : null);
  const timer = mode ? timers?.[mode] : undefined;
  const remainingMs = mode ? auxiliaryTimerRemaining(timer, now, mode === 'medical' ? 120000 : 10000) : 0;
  return { mode, remainingMs, active: Boolean(timer?.active), exhausted: mode === 'medical' && (timer?.exhausted || timer?.active && remainingMs === 0) };
}
