import type {
  NewInteractionAttempt,
  NewRunCheckpoint
} from "../../application/ports/audit-repository.js";
import type { RunItemUpdate } from "../../application/ports/run-repository.js";
import type { CleaningRun, RunBatch } from "../../domain/run.js";
import type { SqliteDatabase } from "./database.js";
import { SqliteRepositoryTransaction } from "./repository-transaction.js";
import type { SqliteAuditRepository } from "./repositories/sqlite-audit-repository.js";
import type { SqliteRunRepository } from "./repositories/sqlite-run-repository.js";

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

/**
 * The sole persistence boundary for a normalized engine result. No next item
 * may begin until this unit commits, preserving the one-in-flight loss bound.
 */
export class UnitOfWork {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly runs: SqliteRunRepository,
    private readonly audit: SqliteAuditRepository
  ) {}

  commitAttempt(work: CommitAttemptWork): void {
    this.database.transaction((connection) => {
      const transaction = new SqliteRepositoryTransaction(connection);
      this.audit.appendAttempt(work.attempt, transaction);
      this.runs.updateRunItem(work.runItemId, work.runItemUpdate, transaction);
      this.audit.appendCheckpoint(work.checkpoint, transaction);
      if (work.batch !== undefined) {
        this.runs.updateBatchStatus(
          work.batch.id,
          work.batch.status,
          work.batch.finishedAt,
          transaction
        );
      }
      if (work.run !== undefined) {
        this.runs.updateRunStatus(work.run.id, work.run.status, work.run.state, transaction);
      }
    });
  }
}
