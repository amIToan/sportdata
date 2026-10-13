export const STALLING_TIME_MS = 10_000;
export const MEDICAL_TIME_MS = 120_000;
export const AUXILIARY_TIMER_AWARDS = ['STALL_START', 'STALL_CANCEL', 'MEDICAL_START', 'MEDICAL_STOP', 'MEDICAL_EXHAUSTED', 'MEDICAL_FIT', 'MEDICAL_UNFIT'];

export type AuxiliaryTimer = { remainingMs: number; runningSince: string | null; active: boolean; actor?: string; exhausted?: boolean };
export type AuxiliaryTimers = { 1: { stall: AuxiliaryTimer; medical: AuxiliaryTimer }; 2: { stall: AuxiliaryTimer; medical: AuxiliaryTimer } };

export function auxiliaryTimers(saved?: AuxiliaryTimers): AuxiliaryTimers {
  const fresh = () => ({ stall: { remainingMs: STALLING_TIME_MS, runningSince: null, active: false }, medical: { remainingMs: MEDICAL_TIME_MS, runningSince: null, active: false } });
  return saved ? structuredClone(saved) : { 1: fresh(), 2: fresh() };
}

export function auxiliaryRemaining(timer: AuxiliaryTimer, now: number) {
  return Math.max(0, timer.remainingMs - (timer.runningSince ? Math.max(0, now - Date.parse(timer.runningSince)) : 0));
}

export function activeMedicalSide(timers?: AuxiliaryTimers): 1 | 2 | null {
  return timers?.[1].medical.active ? 1 : timers?.[2].medical.active ? 2 : null;
}

export function pauseStallingTimers(timers: AuxiliaryTimers, now: number) {
  for (const side of [1, 2] as const) {
    const timer = timers[side].stall;
    timer.remainingMs = auxiliaryRemaining(timer, now);
    timer.runningSince = null;
  }
}
