import type { CleaningRun, RunBatch } from "../../domain/run.js";
import type { NewInteractionAttempt, NewRunCheckpoint } from "./audit-repository.js";
import type { RunItemUpdate } from "./run-repository.js";

export interface CommitAttemptWork {
  readonly attempt: NewInteractionAttempt;
  readonly runItemId: number;
  readonly runItemUpdate: RunItemUpdate;
  readonly checkpoint: NewRunCheckpoint;
  readonly batch?: {
    readonly id: string;
    readonly status: RunBatch["status"];
    readonly finishedAt: string | null;
  };
  readonly run?: {
    readonly id: string;
    readonly status: CleaningRun["status"];
    readonly state: Pick<CleaningRun, "pauseReason" | "startedAt" | "pausedAt" | "finishedAt">;
  };
}

export interface CommitBatchBoundaryWork {
  readonly batch: {
    readonly id: string;
    readonly status: RunBatch["status"];
    readonly finishedAt: string | null;
  };
  readonly run: {
    readonly id: string;
    readonly status: CleaningRun["status"];
    readonly state: Pick<CleaningRun, "pauseReason" | "startedAt" | "pausedAt" | "finishedAt">;
  };
  readonly checkpoint: NewRunCheckpoint;
}

export interface CommitRecoveryWork {
  readonly runId: string;
  readonly recoveredAt: string;
  readonly checkpoint: NewRunCheckpoint;
}

export interface ExecutionUnitOfWork {
  commitAttempt(work: CommitAttemptWork): void;
  commitBatchBoundary(work: CommitBatchBoundaryWork): void;
  /** Recovers stale in-flight rows and records that recovery atomically. */
  commitRecovery?(work: CommitRecoveryWork): number;
}
