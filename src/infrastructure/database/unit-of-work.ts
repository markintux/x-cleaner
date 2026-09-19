import type {
  CommitAttemptWork,
  CommitBatchBoundaryWork,
  CommitRecoveryWork
} from "../../application/ports/execution-unit-of-work.js";
import type { SqliteDatabase } from "./database.js";
import { SqliteRepositoryTransaction } from "./repository-transaction.js";
import type { SqliteAuditRepository } from "./repositories/sqlite-audit-repository.js";
import type { SqliteRunRepository } from "./repositories/sqlite-run-repository.js";

export type {
  CommitAttemptWork,
  CommitBatchBoundaryWork,
  CommitRecoveryWork
} from "../../application/ports/execution-unit-of-work.js";

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

  commitBatchBoundary(work: CommitBatchBoundaryWork): void {
    this.database.transaction((connection) => {
      const transaction = new SqliteRepositoryTransaction(connection);
      this.audit.appendCheckpoint(work.checkpoint, transaction);
      this.runs.updateBatchStatus(
        work.batch.id,
        work.batch.status,
        work.batch.finishedAt,
        transaction
      );
      this.runs.updateRunStatus(work.run.id, work.run.status, work.run.state, transaction);
    });
  }

  commitRecovery(work: CommitRecoveryWork): number {
    let recovered = 0;
    this.database.transaction((connection) => {
      const transaction = new SqliteRepositoryTransaction(connection);
      recovered = this.runs.recoverStaleProcessing(work.runId, work.recoveredAt, transaction);
      this.audit.appendCheckpoint(work.checkpoint, transaction);
    });
    return recovered;
  }
}
