import type {
  AuditRepository,
  NewInteractionAttempt,
  NewRunCheckpoint
} from "../../../application/ports/audit-repository.js";
import type { RepositoryTransaction } from "../../../application/ports/repository-transaction.js";
import type { InteractionAttempt, RunCheckpoint } from "../../../domain/run.js";
import type { SqliteDatabase } from "../database.js";
import { connectionFor } from "../repository-transaction.js";

type Row = Record<string, unknown>;

/** The underlying tables are append-only; this adapter deliberately exposes no mutation API. */
export class SqliteAuditRepository implements AuditRepository {
  constructor(private readonly database: SqliteDatabase) {}

  appendAttempt(
    attempt: NewInteractionAttempt,
    transaction?: RepositoryTransaction
  ): InteractionAttempt {
    const connection = connectionFor(this.database.connection, transaction);
    const result = connection
      .prepare(
        `INSERT INTO interaction_attempts (
          run_item_id, batch_id, attempt_number, outcome, retryable, duration_ms, error_code,
          error_context_json, started_at, finished_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        attempt.runItemId,
        attempt.batchId,
        attempt.attemptNumber,
        attempt.outcome,
        attempt.retryable ? 1 : 0,
        attempt.durationMs,
        attempt.errorCode,
        attempt.errorContextJson,
        attempt.startedAt,
        attempt.finishedAt,
        attempt.createdAt
      );
    const row = connection
      .prepare("SELECT * FROM interaction_attempts WHERE id = ?")
      .get(Number(result.lastInsertRowid));
    if (row === undefined) {
      throw new Error("INTERACTION_ATTEMPT_NOT_FOUND");
    }
    return mapAttempt(row as Row);
  }

  appendCheckpoint(
    checkpoint: NewRunCheckpoint,
    transaction?: RepositoryTransaction
  ): RunCheckpoint {
    const connection = connectionFor(this.database.connection, transaction);
    const result = connection
      .prepare(
        `INSERT INTO run_checkpoints (
          run_id, sequence, reason, last_run_item_sequence, aggregate_counts_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        checkpoint.runId,
        checkpoint.sequence,
        checkpoint.reason,
        checkpoint.lastRunItemSequence,
        checkpoint.aggregateCountsJson,
        checkpoint.createdAt
      );
    const row = connection
      .prepare("SELECT * FROM run_checkpoints WHERE id = ?")
      .get(Number(result.lastInsertRowid));
    if (row === undefined) {
      throw new Error("RUN_CHECKPOINT_NOT_FOUND");
    }
    return mapCheckpoint(row as Row);
  }

  listAttempts(runItemId: number): readonly InteractionAttempt[] {
    return this.database.connection
      .prepare("SELECT * FROM interaction_attempts WHERE run_item_id = ? ORDER BY attempt_number")
      .all(runItemId)
      .map((row) => mapAttempt(row as Row));
  }

  listCheckpoints(runId: string): readonly RunCheckpoint[] {
    return this.database.connection
      .prepare("SELECT * FROM run_checkpoints WHERE run_id = ? ORDER BY sequence")
      .all(runId)
      .map((row) => mapCheckpoint(row as Row));
  }
}

function mapAttempt(row: Row): InteractionAttempt {
  return {
    id: requiredNumber(row.id),
    runItemId: requiredNumber(row.run_item_id),
    batchId: requiredString(row.batch_id),
    attemptNumber: requiredNumber(row.attempt_number),
    outcome: requiredString(row.outcome) as InteractionAttempt["outcome"],
    retryable: requiredNumber(row.retryable) === 1,
    durationMs: requiredNumber(row.duration_ms),
    errorCode: nullableString(row.error_code),
    errorContextJson: nullableString(row.error_context_json),
    startedAt: requiredString(row.started_at),
    finishedAt: requiredString(row.finished_at),
    createdAt: requiredString(row.created_at)
  };
}

function mapCheckpoint(row: Row): RunCheckpoint {
  return {
    id: requiredNumber(row.id),
    runId: requiredString(row.run_id),
    sequence: requiredNumber(row.sequence),
    reason: requiredString(row.reason) as RunCheckpoint["reason"],
    lastRunItemSequence: nullableNumber(row.last_run_item_sequence),
    aggregateCountsJson: requiredString(row.aggregate_counts_json),
    createdAt: requiredString(row.created_at)
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
