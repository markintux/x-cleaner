import type {
  EligibleRunItemPage,
  RunOverview,
  RunItemUpdate,
  RunRepository
} from "../../../application/ports/run-repository.js";
import type { RepositoryTransaction } from "../../../application/ports/repository-transaction.js";
import type {
  CleaningRun,
  CleaningRunItem,
  CleaningRunItemStatus,
  CleaningRunStatus,
  PauseReason,
  RunBatch,
  RunBatchStatus
} from "../../../domain/run.js";
import type { InteractionType } from "../../../domain/interaction.js";
import type { RunProgressRow } from "../../../application/progress/get-run-progress.js";
import type { SqliteDatabase } from "../database.js";
import { connectionFor } from "../repository-transaction.js";

type Row = Record<string, unknown>;

export interface SqliteRunRepositoryOptions {
  readonly now?: () => string;
}

export class SqliteRunRepository implements RunRepository {
  readonly #now: () => string;

  constructor(
    private readonly database: SqliteDatabase,
    options: SqliteRunRepositoryOptions = {}
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  createRun(run: CleaningRun, transaction?: RepositoryTransaction): void {
    const connection = connectionFor(this.database.connection, transaction);
    const write = (): void => {
      connection
        .prepare(
          `INSERT INTO cleaning_runs (
            id, plan_id, account_id, bound_handle, status, pause_reason, started_at,
            paused_at, finished_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          run.id,
          run.planId,
          run.accountId,
          run.boundHandle,
          run.status,
          run.pauseReason,
          run.startedAt,
          run.pausedAt,
          run.finishedAt,
          run.createdAt,
          run.updatedAt
        );
      connection
        .prepare(
          `INSERT INTO cleaning_run_items (
             run_id, interaction_id, sequence, status, created_at, updated_at
           )
           SELECT ?, interaction_id, sequence, 'PENDING', ?, ?
           FROM cleaning_plan_items WHERE plan_id = ? ORDER BY sequence`
        )
        .run(run.id, run.createdAt, run.updatedAt, run.planId);
    };
    if (transaction === undefined) {
      this.database.transaction(write);
      return;
    }
    write();
  }

  getRun(runId: string): CleaningRun | null {
    const row = this.database.connection
      .prepare("SELECT * FROM cleaning_runs WHERE id = ?")
      .get(runId);
    return row === undefined ? null : mapRun(row as Row);
  }

  getRunForPlan(planId: string): CleaningRun | null {
    const row = this.database.connection
      .prepare("SELECT * FROM cleaning_runs WHERE plan_id = ?")
      .get(planId);
    return row === undefined ? null : mapRun(row as Row);
  }

  listRunOverviews(): readonly RunOverview[] {
    return this.database.connection
      .prepare(
        `SELECT r.id, r.status, r.pause_reason, r.created_at, r.archived_at,
                p.selected_count AS total,
                (SELECT count(*) FROM cleaning_run_items i
                 WHERE i.run_id = r.id AND EXISTS (
                   SELECT 1 FROM cleaning_run_items other
                   JOIN cleaning_runs older ON older.id = other.run_id
                   WHERE other.interaction_id = i.interaction_id
                     AND older.account_id = r.account_id
                     AND (older.created_at < r.created_at
                       OR (older.created_at = r.created_at AND older.id < r.id))
                 )) AS repeated_items,
                (SELECT json_group_array(json_object(
                   'type', type, 'total', total, 'processed', processed,
                   'completed', completed, 'pending', pending, 'failed', failed, 'skipped', skipped
                 )) FROM (
                   SELECT interaction.type AS type, count(*) AS total,
                     sum(i.status NOT IN ('PENDING', 'PROCESSING')) AS processed,
                     sum(i.status = 'COMPLETED') AS completed,
                     sum(i.status = 'PENDING') AS pending,
                     sum(i.status = 'FAILED') AS failed,
                     sum(i.status = 'SKIPPED') AS skipped
                   FROM cleaning_run_items i JOIN interactions interaction ON interaction.id = i.interaction_id
                   WHERE i.run_id = r.id GROUP BY interaction.type
                 )) AS type_counts,
                (SELECT group_concat(interaction_type, ',')
                 FROM cleaning_plan_types WHERE plan_id = r.plan_id) AS types,
                (SELECT count(*) FROM cleaning_run_items i
                 WHERE i.run_id = r.id
                   AND i.status NOT IN ('PENDING', 'PROCESSING')) AS processed,
                (SELECT count(*) FROM cleaning_run_items i
                 WHERE i.run_id = r.id AND i.status = 'COMPLETED') AS completed,
                (SELECT count(*) FROM cleaning_run_items i
                 WHERE i.run_id = r.id AND i.status = 'PENDING') AS pending,
                (SELECT count(*) FROM cleaning_run_items i
                 WHERE i.run_id = r.id AND i.status = 'FAILED') AS failed,
                (SELECT count(*) FROM cleaning_run_items i
                 WHERE i.run_id = r.id AND i.status = 'SKIPPED') AS skipped,
                (SELECT count(*) FROM cleaning_run_items i
                 WHERE i.run_id = r.id AND i.status = 'PENDING'
                   AND EXISTS (
                     SELECT 1 FROM cleaning_run_items other
                     INNER JOIN cleaning_runs other_run ON other_run.id = other.run_id
                     WHERE other.interaction_id = i.interaction_id
                       AND other.run_id != r.id
                       AND other_run.account_id = r.account_id
                       AND (
                         other.status = 'COMPLETED'
                         OR other_run.created_at < r.created_at
                         OR (other_run.created_at = r.created_at AND other_run.id < r.id)
                       )
                   )) AS overlapping_pending
         FROM cleaning_runs r
         INNER JOIN cleaning_plans p ON p.id = r.plan_id
         ORDER BY r.created_at, r.id`
      )
      .all()
      .map((raw) => {
        const row = raw as Row;
        return {
          runId: requiredString(row.id),
          createdAt: requiredString(row.created_at),
          archivedAt: nullableString(row.archived_at),
          repeatedItems: requiredNumber(row.repeated_items),
          typeCounts: JSON.parse(requiredString(row.type_counts)) as RunOverview["typeCounts"],
          types: requiredString(row.types).split(","),
          status: requiredString(row.status) as CleaningRunStatus,
          pauseReason: nullableString(row.pause_reason) as PauseReason | null,
          total: requiredNumber(row.total),
          processed: requiredNumber(row.processed),
          completed: requiredNumber(row.completed),
          pending: requiredNumber(row.pending),
          failed: requiredNumber(row.failed),
          skipped: requiredNumber(row.skipped),
          overlappingPending: requiredNumber(row.overlapping_pending)
        };
      });
  }

  isRunArchived(runId: string): boolean {
    const row = this.database.connection
      .prepare("SELECT archived_at FROM cleaning_runs WHERE id = ?")
      .get(runId);
    return row !== undefined && row.archived_at !== null;
  }

  archiveRun(runId: string, archivedAt: string, transaction: RepositoryTransaction): void {
    connectionFor(this.database.connection, transaction)
      .prepare("UPDATE cleaning_runs SET archived_at = ? WHERE id = ? AND archived_at IS NULL")
      .run(archivedAt, runId);
  }

  getRunItem(runItemId: number): CleaningRunItem | null {
    const row = this.database.connection
      .prepare("SELECT * FROM cleaning_run_items WHERE id = ?")
      .get(runItemId);
    return row === undefined ? null : mapRunItem(row as Row);
  }

  listRunItems(runId: string): readonly CleaningRunItem[] {
    return this.database.connection
      .prepare("SELECT * FROM cleaning_run_items WHERE run_id = ? ORDER BY sequence")
      .all(runId)
      .map((row) => mapRunItem(row as Row));
  }

  /**
   * Progress projection deliberately excludes interaction content and source
   * paths. The scheduler index supplies lifecycle ordering while the join only
   * reads the normalized interaction type.
   */
  getRunProgressRows(runId: string): readonly RunProgressRow[] {
    return this.database.connection
      .prepare(
        `SELECT interactions.type AS interaction_type, cleaning_run_items.status,
                cleaning_run_items.attempt_count, cleaning_run_items.next_retry_at
         FROM cleaning_run_items
         INNER JOIN interactions ON interactions.id = cleaning_run_items.interaction_id
         WHERE cleaning_run_items.run_id = ?
         ORDER BY cleaning_run_items.sequence`
      )
      .all(runId)
      .map((row) => {
        const value = row as Row;
        return {
          type: requiredString(value.interaction_type) as InteractionType,
          status: requiredString(value.status) as RunProgressRow["status"],
          attemptCount: requiredNumber(value.attempt_count),
          nextRetryAt: nullableString(value.next_retry_at)
        };
      });
  }

  getRunProgress(runId: string): readonly RunProgressRow[] {
    return this.getRunProgressRows(runId);
  }

  createBatch(batch: RunBatch, transaction?: RepositoryTransaction): void {
    const connection = connectionFor(this.database.connection, transaction);
    connection
      .prepare(
        `INSERT INTO run_batches (
          id, run_id, requested_limit, confirmed_at, status, started_at, finished_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        batch.id,
        batch.runId,
        batch.requestedLimit,
        batch.confirmedAt,
        batch.status,
        batch.startedAt,
        batch.finishedAt,
        batch.createdAt,
        batch.updatedAt
      );
  }

  getBatch(batchId: string): RunBatch | null {
    const row = this.database.connection
      .prepare("SELECT * FROM run_batches WHERE id = ?")
      .get(batchId);
    return row === undefined ? null : mapBatch(row as Row);
  }

  listBatches(runId: string): readonly RunBatch[] {
    return this.database.connection
      .prepare("SELECT * FROM run_batches WHERE run_id = ? ORDER BY created_at, id")
      .all(runId)
      .map((row) => mapBatch(row as Row));
  }

  pageEligibleItems(
    runId: string,
    now: string,
    limit: number,
    afterSequence = 0
  ): EligibleRunItemPage {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error("INVALID_PAGE_LIMIT");
    }
    const rows = this.database.connection
      .prepare(
        `SELECT * FROM cleaning_run_items
         WHERE run_id = ? AND status = 'PENDING' AND (next_retry_at IS NULL OR next_retry_at <= ?)
           AND sequence > ?
         ORDER BY sequence LIMIT ?`
      )
      .all(runId, now, afterSequence, limit + 1);
    return {
      items: rows.slice(0, limit).map((row) => mapRunItem(row as Row)),
      hasMore: rows.length > limit
    };
  }

  updateRunItem(
    runItemId: number,
    update: RunItemUpdate,
    transaction?: RepositoryTransaction
  ): void {
    const connection = connectionFor(this.database.connection, transaction);
    const current = this.getRunItemFrom(connection, runItemId);
    connection
      .prepare(
        `UPDATE cleaning_run_items SET
          status = ?, attempt_count = ?, processing_started_at = ?, next_retry_at = ?,
          completed_at = ?, last_error_code = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        update.status,
        update.attemptCount ?? current.attemptCount,
        update.processingStartedAt === undefined
          ? current.processingStartedAt
          : update.processingStartedAt,
        update.nextRetryAt === undefined ? current.nextRetryAt : update.nextRetryAt,
        update.completedAt === undefined ? current.completedAt : update.completedAt,
        update.lastErrorCode === undefined ? current.lastErrorCode : update.lastErrorCode,
        this.#now(),
        runItemId
      );
  }

  updateRunStatus(
    runId: string,
    status: CleaningRunStatus,
    update: Pick<CleaningRun, "pauseReason" | "startedAt" | "pausedAt" | "finishedAt">,
    transaction?: RepositoryTransaction
  ): void {
    const connection = connectionFor(this.database.connection, transaction);
    const current = this.getRunFrom(connection, runId);
    connection
      .prepare(
        `UPDATE cleaning_runs SET status = ?, pause_reason = ?, started_at = ?, paused_at = ?,
          finished_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        status,
        update.pauseReason,
        update.startedAt,
        update.pausedAt,
        update.finishedAt,
        this.#now(),
        current.id
      );
  }

  updateBatchStatus(
    batchId: string,
    status: RunBatchStatus,
    finishedAt: string | null,
    transaction?: RepositoryTransaction
  ): void {
    const connection = connectionFor(this.database.connection, transaction);
    connection
      .prepare("UPDATE run_batches SET status = ?, finished_at = ?, updated_at = ? WHERE id = ?")
      .run(status, finishedAt, this.#now(), batchId);
  }

  recoverStaleProcessing(runId: string, now: string, transaction?: RepositoryTransaction): number {
    const connection = connectionFor(this.database.connection, transaction);
    const result = connection
      .prepare(
        `UPDATE cleaning_run_items
         SET status = 'PENDING', processing_started_at = NULL, next_retry_at = ?, updated_at = ?
         WHERE run_id = ? AND status = 'PROCESSING'
           AND (
             attempt_count = 0 OR NOT EXISTS (
               SELECT 1 FROM interaction_attempts
               WHERE interaction_attempts.run_item_id = cleaning_run_items.id
                 AND interaction_attempts.attempt_number = cleaning_run_items.attempt_count
             )
           )`
      )
      .run(now, now, runId);
    return Number(result.changes);
  }

  private getRunFrom(connection: typeof this.database.connection, runId: string): CleaningRun {
    const row = connection.prepare("SELECT * FROM cleaning_runs WHERE id = ?").get(runId);
    if (row === undefined) {
      throw new Error("CLEANING_RUN_NOT_FOUND");
    }
    return mapRun(row as Row);
  }

  private getRunItemFrom(
    connection: typeof this.database.connection,
    runItemId: number
  ): CleaningRunItem {
    const row = connection.prepare("SELECT * FROM cleaning_run_items WHERE id = ?").get(runItemId);
    if (row === undefined) {
      throw new Error("CLEANING_RUN_ITEM_NOT_FOUND");
    }
    return mapRunItem(row as Row);
  }
}

function mapRun(row: Row): CleaningRun {
  return {
    id: requiredString(row.id),
    planId: requiredString(row.plan_id),
    accountId: requiredString(row.account_id),
    boundHandle: requiredString(row.bound_handle),
    status: requiredString(row.status) as CleaningRunStatus,
    pauseReason: nullableString(row.pause_reason) as PauseReason | null,
    startedAt: nullableString(row.started_at),
    pausedAt: nullableString(row.paused_at),
    finishedAt: nullableString(row.finished_at),
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at)
  };
}

function mapBatch(row: Row): RunBatch {
  return {
    id: requiredString(row.id),
    runId: requiredString(row.run_id),
    requestedLimit: nullableNumber(row.requested_limit),
    confirmedAt: requiredString(row.confirmed_at),
    status: requiredString(row.status) as RunBatchStatus,
    startedAt: requiredString(row.started_at),
    finishedAt: nullableString(row.finished_at),
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at)
  };
}

function mapRunItem(row: Row): CleaningRunItem {
  return {
    id: requiredNumber(row.id),
    runId: requiredString(row.run_id),
    interactionId: requiredNumber(row.interaction_id),
    sequence: requiredNumber(row.sequence),
    status: requiredString(row.status) as CleaningRunItemStatus,
    attemptCount: requiredNumber(row.attempt_count),
    processingStartedAt: nullableString(row.processing_started_at),
    nextRetryAt: nullableString(row.next_retry_at),
    completedAt: nullableString(row.completed_at),
    lastErrorCode: nullableString(row.last_error_code),
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at)
  };
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("INVALID_DATABASE_VALUE");
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : requiredString(value);
}

function requiredNumber(value: unknown): number {
  if (typeof value !== "number") {
    throw new Error("INVALID_DATABASE_VALUE");
  }
  return value;
}

function nullableNumber(value: unknown): number | null {
  return value === null ? null : requiredNumber(value);
}
