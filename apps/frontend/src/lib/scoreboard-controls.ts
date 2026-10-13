export type ScoreboardControlCommand = {
  action: 'START' | 'PAUSE' | 'RESUME' | 'AWARD' | 'UNDO' | 'FINISH' | 'REVIEW_REQUEST' | 'REVIEW_RESOLVE' | 'REVIEW_UNDO' | 'STALL_START' | 'STALL_CANCEL' | 'MEDICAL_START' | 'MEDICAL_STOP' | 'MEDICAL_DECISION' | 'MEDICAL_UNDO';
  side?: 1 | 2;
  award?: 'POINTS' | 'ADVANTAGE' | 'PENALTY' | 'SUBMISSION';
  points?: number;
  penaltyLevel?: number;
  winnerId?: string;
  winMethod?: string;
  reviewResult?: 'ACCEPTED' | 'REJECTED';
  medicalResult?: 'FIT' | 'UNFIT';
};

export type ScoreboardShortcut =
  | { type: 'clock' | 'confirm' | 'fullscreen' | 'history' }
  | { type: 'command'; command: ScoreboardControlCommand };

type ResolvedScoreboardShortcut =
  | { type: 'confirm' | 'fullscreen' | 'history' }
  | { type: 'command'; command: ScoreboardControlCommand };

type KeyboardInput = { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };
type ControlState = {
  status: string;
  editable: boolean;
  modalOpen: boolean;
  blocked: boolean;
  runningSince: boolean;
  hasTime: boolean;
  terminal: boolean;
  canConfirmResult: boolean;
  hasActions: boolean;
  penalties: [number, number];
  review?: { cards: { 1: boolean; 2: boolean }; pendingSide: 1 | 2 | null };
  hasReviewActions?: boolean;
  medicalSide?: 1 | 2 | null;
  medicalRemaining?: [number, number];
  medicalRunning?: boolean;
  stallActive?: [boolean, boolean];
  hasMedicalDecision?: boolean;
};

export function getScoreboardShortcut(event: KeyboardInput): ScoreboardShortcut | null {
  if (event.altKey) return null;
  if (event.ctrlKey || event.metaKey) {
    return event.code === 'KeyZ' && !event.shiftKey ? { type: 'command', command: { action: 'UNDO' } } : null;
  }
  if (event.shiftKey) {
    if (event.code === 'KeyU') return { type: 'command', command: { action: 'REVIEW_UNDO' } };
    if (event.code === 'KeyM') return { type: 'command', command: { action: 'MEDICAL_UNDO' } };
    if (event.code === 'KeyG') return { type: 'command', command: { action: 'MEDICAL_DECISION', medicalResult: 'UNFIT' } };
    const side = event.code === 'KeyD' ? 1 : event.code === 'KeyJ' ? 2 : null;
    return side ? { type: 'command', command: { action: 'AWARD', side, award: 'SUBMISSION' } } : null;
  }
  if (event.code === 'Space') return { type: 'clock' };
  if (event.code === 'KeyR') return { type: 'confirm' };
  if (event.code === 'KeyF') return { type: 'fullscreen' };
  if (event.code === 'KeyH') return { type: 'history' };
  if (event.code === 'KeyU') return { type: 'command', command: { action: 'UNDO' } };
  if (event.code === 'KeyZ' || event.code === 'KeyT') return { type: 'command', command: { action: 'STALL_START', side: event.code === 'KeyZ' ? 1 : 2 } };
  if (event.code === 'KeyM' || event.code === 'KeyN') return { type: 'command', command: { action: 'MEDICAL_START', side: event.code === 'KeyM' ? 1 : 2 } };
  if (event.code === 'KeyG') return { type: 'command', command: { action: 'MEDICAL_DECISION', medicalResult: 'FIT' } };
  if (event.code === 'KeyV' || event.code === 'KeyB') return { type: 'command', command: { action: 'REVIEW_REQUEST', side: event.code === 'KeyV' ? 1 : 2 } };
  if (event.code === 'KeyC' || event.code === 'KeyX') return { type: 'command', command: { action: 'REVIEW_RESOLVE', reviewResult: event.code === 'KeyC' ? 'ACCEPTED' : 'REJECTED' } };

  const points: Record<string, [1 | 2, number]> = { KeyQ: [1, 2], KeyW: [1, 3], KeyE: [1, 4], KeyI: [2, 2], KeyO: [2, 3], KeyP: [2, 4] };
  if (points[event.code]) {
    const [side, value] = points[event.code];
    return { type: 'command', command: { action: 'AWARD', side, award: 'POINTS', points: value } };
  }
  const awards: Record<string, [1 | 2, 'ADVANTAGE' | 'PENALTY']> = { KeyA: [1, 'ADVANTAGE'], KeyL: [2, 'ADVANTAGE'], KeyS: [1, 'PENALTY'], KeyK: [2, 'PENALTY'] };
  if (!awards[event.code]) return null;
  const [side, award] = awards[event.code];
  return { type: 'command', command: { action: 'AWARD', side, award } };
}

export function resolveScoreboardShortcut(shortcut: ScoreboardShortcut, state: ControlState): ResolvedScoreboardShortcut | null {
  if (state.modalOpen) return null;
  if (shortcut.type === 'fullscreen' || shortcut.type === 'history') return { type: shortcut.type };
  if (!state.editable) return null;
  if (shortcut.type === 'clock') {
    if (state.status === 'SCHEDULED') return state.blocked ? null : { type: 'command', command: { action: 'START' } };
    if (state.status !== 'RUNNING') return null;
    if (state.runningSince) return { type: 'command', command: { action: 'PAUSE' } };
    return !state.terminal && !state.medicalSide && !state.review?.pendingSide && state.hasTime ? { type: 'command', command: { action: 'RESUME' } } : null;
  }
  if (shortcut.type === 'confirm') return state.status === 'RUNNING' && state.canConfirmResult && !state.medicalSide && !state.review?.pendingSide && !(state.runningSince && state.hasTime) ? { type: 'confirm' } : null;
  if (shortcut.type !== 'command' || state.status !== 'RUNNING') return null;
  if (shortcut.command.action === 'UNDO') return state.hasActions ? shortcut : null;
  if (shortcut.command.action === 'REVIEW_UNDO') return state.hasReviewActions && !state.medicalSide ? shortcut : null;
  if (shortcut.command.action === 'MEDICAL_UNDO') return state.hasMedicalDecision && !state.review?.pendingSide ? shortcut : null;
  if (shortcut.command.action === 'MEDICAL_DECISION') return state.medicalSide ? { type: 'command', command: { ...shortcut.command, side: state.medicalSide } } : null;
  if (shortcut.command.action === 'MEDICAL_START' && shortcut.command.side) {
    const side = shortcut.command.side;
    if (state.terminal || state.review?.pendingSide || (state.medicalSide && state.medicalSide !== side)) return null;
    if (state.medicalSide === side && state.medicalRunning) return { type: 'command', command: { action: 'MEDICAL_STOP', side } };
    return (state.medicalRemaining?.[side - 1] ?? 120000) > 0 ? shortcut : null;
  }
  if (shortcut.command.action === 'STALL_START' && shortcut.command.side) {
    const side = shortcut.command.side;
    if (state.stallActive?.[side - 1]) return { type: 'command', command: { action: 'STALL_CANCEL', side } };
    return !state.terminal && !state.medicalSide && !state.review?.pendingSide && state.runningSince && state.hasTime ? shortcut : null;
  }
  if (shortcut.command.action === 'REVIEW_REQUEST') return shortcut.command.side && !state.medicalSide && !state.review?.pendingSide && state.review?.cards[shortcut.command.side] !== false ? shortcut : null;
  if (shortcut.command.action === 'REVIEW_RESOLVE') return state.review?.pendingSide ? { type: 'command', command: { ...shortcut.command, side: state.review.pendingSide } } : null;
  if (state.terminal || state.medicalSide) return null;
  if (shortcut.command.award === 'PENALTY' && shortcut.command.side) {
    const penaltyLevel = state.penalties[shortcut.command.side - 1] + 1;
    return penaltyLevel <= 4 ? { type: 'command', command: { ...shortcut.command, penaltyLevel } } : null;
  }
  return shortcut;
}
