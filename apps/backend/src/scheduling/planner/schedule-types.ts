// Planner inputs are complete snapshots, never paginated UI rows. Time values
// are UTC milliseconds; the API adapter owns local-time parsing and access checks.
export type Interval = { start: number; end: number };

export type PlannerMatch = {
  id: string;
  categoryId: string;
  contentKey?: string;
  drawId: string;
  blockId: string;
  blockOrder: number;
  stageKey: string;
  stageOrder: number;
  weightOrder: number;
  bracketPosition: number;
  matchNumber?: number;
  predecessorIds: string[];
  participantIds: string[];
  candidateParticipantIds: string[];
  durationSeconds: number;
  turnaroundSeconds: number;
  minRestSeconds: number;
  windowBounds?: Record<string, Interval>;
  actualEnd?: number;
  immutable: boolean;
  current?: Interval & { fopId: string; chainSequence?: number };
};

export type PlannerWindow = Interval & {
  id: string;
  localDate: string;
  fopId: string;
  enabled: boolean;
  breaks: Interval[];
};

export type PlannerReservation = Interval & {
  contentKey?: string;
  id: string;
  matchId?: string;
  planId?: string;
  fopId: string;
  turnaroundSeconds: number;
  minRestSeconds: number;
  participantIds: string[];
  candidateParticipantIds: string[];
};

export type PlannerInput = {
  matches: PlannerMatch[];
  windows: PlannerWindow[];
  reservations: PlannerReservation[];
  autoContinue: boolean;
  matchOrders: Array<{ categoryId: string; drawId: string; stageKey: string; orderedMatchIds: string[] }>;
  earliestStarts: Array<{
    target: { matchId: string } | { blockId: string; stageKey: string };
    notBefore: number;
  }>;
  pinnedStarts: Array<{ matchId: string; startTime: number }>;
};

export type PlannerViolation = {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  description?: string;
  targetMatchId?: string;
  requestedStart?: number;
  earliestStart?: number;
  suggestedStart?: number;
  participantIds?: string[];
  message: string;
  matchIds: string[];
  relatedPlanIds?: string[];
  windowId?: string;
};

export type PlannerAssignment = Interval & {
  matchId: string;
  categoryId: string;
  drawId: string;
  blockId: string;
  stageKey: string;
  chainSequence: number;
  windowId: string;
  localDate: string;
  fopId: string;
  durationSeconds: number;
  turnaroundSeconds: number;
};

export type PlannerResult = {
  assignments: PlannerAssignment[];
  unscheduled: Array<{ matchId: string; code: string }>;
  violations: PlannerViolation[];
  idleSegments: Array<Interval & { beforeMatchId: string; windowId: string; reasons: string[] }>;
  canApply: boolean;
};
