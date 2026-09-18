import type { InteractionType } from "./interaction.js";
import type { AttemptOutcome } from "./result.js";

export const cleaningRunStatuses = [
  "PENDING",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "FAILED",
  "INTERRUPTED"
] as const;

export type CleaningRunStatus = (typeof cleaningRunStatuses)[number];

export const runBatchStatuses = [
  "RUNNING",
  "COMPLETED",
  "PAUSED",
  "FAILED",
  "INTERRUPTED"
] as const;

export type RunBatchStatus = (typeof runBatchStatuses)[number];

export const cleaningRunItemStatuses = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "SKIPPED",
  "FAILED",
  "NOT_FOUND",
  "ALREADY_REMOVED",
  "UNAVAILABLE"
] as const;

export type CleaningRunItemStatus = (typeof cleaningRunItemStatuses)[number];

export const pauseReasons = [
  "RATE_LIMIT",
  "SECURITY_CHALLENGE",
  "SESSION_EXPIRED",
  "UNKNOWN_UI"
] as const;

export type PauseReason = (typeof pauseReasons)[number];

export const checkpointReasons = [
  "ITEM_COMMITTED",
  "MANUAL_INTERRUPT",
  "RATE_LIMIT",
  "SECURITY_CHALLENGE",
  "SESSION_EXPIRED",
  "UNKNOWN_UI",
  "FAILURE",
  "COMPLETED"
] as const;

export type CheckpointReason = (typeof checkpointReasons)[number];

export interface CleaningRun {
  readonly id: string;
  readonly planId: string;
  readonly accountId: string;
  readonly boundHandle: string;
  readonly status: CleaningRunStatus;
  readonly pauseReason: PauseReason | null;
  readonly startedAt: string | null;
  readonly pausedAt: string | null;
  readonly finishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RunBatch {
  readonly id: string;
  readonly runId: string;
  readonly requestedLimit: number | null;
  readonly confirmedAt: string;
  readonly status: RunBatchStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CleaningRunItem {
  readonly id: number;
  readonly runId: string;
  readonly interactionId: number;
  readonly sequence: number;
  readonly status: CleaningRunItemStatus;
  readonly attemptCount: number;
  readonly processingStartedAt: string | null;
  readonly nextRetryAt: string | null;
  readonly completedAt: string | null;
  readonly lastErrorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One immutable record of an action attempted under a confirmed batch. */
export interface InteractionAttempt {
  readonly id: number;
  readonly runItemId: number;
  readonly batchId: string;
  readonly attemptNumber: number;
  readonly outcome: AttemptOutcome;
  readonly retryable: boolean;
  readonly durationMs: number;
  readonly errorCode: string | null;
  readonly errorContextJson: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly createdAt: string;
}

/** One immutable recovery boundary for a resumable cleaning run. */
export interface RunCheckpoint {
  readonly id: number;
  readonly runId: string;
  readonly sequence: number;
  readonly reason: CheckpointReason;
  readonly lastRunItemSequence: number | null;
  readonly aggregateCountsJson: string;
  readonly createdAt: string;
}

export interface RunInteraction {
  readonly runItemId: number;
  readonly interactionType: InteractionType;
}

const terminalRunStatuses = new Set<CleaningRunStatus>(["COMPLETED", "FAILED", "INTERRUPTED"]);
const terminalRunBatchStatuses = new Set<RunBatchStatus>([
  "COMPLETED",
  "PAUSED",
  "FAILED",
  "INTERRUPTED"
]);
const terminalRunItemStatuses = new Set<CleaningRunItemStatus>([
  "COMPLETED",
  "SKIPPED",
  "FAILED",
  "NOT_FOUND",
  "ALREADY_REMOVED",
  "UNAVAILABLE"
]);

const runTransitions: Readonly<Record<CleaningRunStatus, readonly CleaningRunStatus[]>> = {
  PENDING: ["RUNNING", "INTERRUPTED"],
  RUNNING: ["PAUSED", "COMPLETED", "FAILED", "INTERRUPTED"],
  PAUSED: ["RUNNING", "FAILED", "INTERRUPTED"],
  COMPLETED: [],
  FAILED: [],
  INTERRUPTED: []
};

const batchTransitions: Readonly<Record<RunBatchStatus, readonly RunBatchStatus[]>> = {
  RUNNING: ["COMPLETED", "PAUSED", "FAILED", "INTERRUPTED"],
  COMPLETED: [],
  PAUSED: [],
  FAILED: [],
  INTERRUPTED: []
};

const runItemTransitions: Readonly<
  Record<CleaningRunItemStatus, readonly CleaningRunItemStatus[]>
> = {
  PENDING: ["PROCESSING"],
  PROCESSING: [
    "PENDING",
    "COMPLETED",
    "SKIPPED",
    "FAILED",
    "NOT_FOUND",
    "ALREADY_REMOVED",
    "UNAVAILABLE"
  ],
  COMPLETED: [],
  SKIPPED: [],
  FAILED: [],
  NOT_FOUND: [],
  ALREADY_REMOVED: [],
  UNAVAILABLE: []
};

export function isCleaningRunStatus(value: string): value is CleaningRunStatus {
  return (cleaningRunStatuses as readonly string[]).includes(value);
}

export function isRunBatchStatus(value: string): value is RunBatchStatus {
  return (runBatchStatuses as readonly string[]).includes(value);
}

export function isCleaningRunItemStatus(value: string): value is CleaningRunItemStatus {
  return (cleaningRunItemStatuses as readonly string[]).includes(value);
}

export function isPauseReason(value: string): value is PauseReason {
  return (pauseReasons as readonly string[]).includes(value);
}

export function isCheckpointReason(value: string): value is CheckpointReason {
  return (checkpointReasons as readonly string[]).includes(value);
}

export function isTerminalRunStatus(status: CleaningRunStatus): boolean {
  return terminalRunStatuses.has(status);
}

export function isTerminalRunBatchStatus(status: RunBatchStatus): boolean {
  return terminalRunBatchStatuses.has(status);
}

export function isTerminalRunItemStatus(status: CleaningRunItemStatus): boolean {
  return terminalRunItemStatuses.has(status);
}

export function canTransitionCleaningRun(from: CleaningRunStatus, to: CleaningRunStatus): boolean {
  return runTransitions[from].includes(to);
}

export function canTransitionRunBatch(from: RunBatchStatus, to: RunBatchStatus): boolean {
  return batchTransitions[from].includes(to);
}

export function canTransitionCleaningRunItem(
  from: CleaningRunItemStatus,
  to: CleaningRunItemStatus
): boolean {
  return runItemTransitions[from].includes(to);
}

export function canRecoverStaleProcessing(
  from: CleaningRunItemStatus,
  to: CleaningRunItemStatus
): boolean {
  return from === "PROCESSING" && to === "PENDING";
}
