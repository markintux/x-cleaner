import type { DatabaseSync } from "node:sqlite";

import type { Migration } from "../migrator.js";

export const auditMigration: Migration = {
  version: 4,
  name: "004_audit",
  up(connection: DatabaseSync): void {
    connection.exec(`
      CREATE TABLE interaction_attempts (
        id INTEGER PRIMARY KEY NOT NULL,
        run_item_id INTEGER NOT NULL REFERENCES cleaning_run_items (id),
        batch_id TEXT NOT NULL REFERENCES run_batches (id),
        attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
        outcome TEXT NOT NULL CHECK (
          outcome IN (
            'COMPLETED', 'RETRYABLE_FAILURE', 'FAILED', 'NOT_FOUND', 'ALREADY_REMOVED',
            'UNAVAILABLE', 'PAUSED'
          )
        ),
        retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
        duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
        error_code TEXT,
        error_context_json TEXT CHECK (
          error_context_json IS NULL OR (
            json_valid(error_context_json) AND json_type(error_context_json) = 'object'
          )
        ),
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (run_item_id, attempt_number)
      );

      CREATE INDEX interaction_attempts_batch_id_idx ON interaction_attempts (batch_id);
      CREATE INDEX interaction_attempts_outcome_idx ON interaction_attempts (outcome);

      CREATE TABLE run_checkpoints (
        id INTEGER PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES cleaning_runs (id),
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        reason TEXT NOT NULL CHECK (
          reason IN (
            'ITEM_COMMITTED', 'MANUAL_INTERRUPT', 'RATE_LIMIT', 'SECURITY_CHALLENGE',
            'SESSION_EXPIRED', 'UNKNOWN_UI', 'FAILURE', 'COMPLETED'
          )
        ),
        last_run_item_sequence INTEGER,
        aggregate_counts_json TEXT NOT NULL CHECK (
          json_valid(aggregate_counts_json) AND json_type(aggregate_counts_json) = 'object'
        ),
        created_at TEXT NOT NULL,
        UNIQUE (run_id, sequence)
      );

      CREATE UNIQUE INDEX interaction_attempts_item_number_uq
        ON interaction_attempts (run_item_id, attempt_number);
      CREATE UNIQUE INDEX run_checkpoints_run_sequence_uq
        ON run_checkpoints (run_id, sequence);
      CREATE INDEX run_checkpoints_run_created_idx ON run_checkpoints (run_id, created_at);

      CREATE TABLE generated_reports (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL UNIQUE REFERENCES cleaning_runs (id),
        relative_path TEXT NOT NULL CHECK (
          length(relative_path) > 0
          AND instr(relative_path, char(92)) = 0
          AND relative_path NOT LIKE '/%'
          AND relative_path NOT GLOB '[A-Za-z]:*'
          AND relative_path NOT IN ('.', '..')
          AND relative_path NOT LIKE '../%'
          AND relative_path NOT LIKE '%/../%'
          AND relative_path NOT LIKE '%/..'
        ),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
        summary_json TEXT NOT NULL CHECK (
          json_valid(summary_json) AND json_type(summary_json) = 'object'
        ),
        generated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX generated_reports_generated_at_idx ON generated_reports (generated_at);

      CREATE TRIGGER interaction_attempts_append_only_update
      BEFORE UPDATE ON interaction_attempts
      BEGIN
        SELECT RAISE(ABORT, 'APPEND_ONLY_INTERACTION_ATTEMPT');
      END;

      CREATE TRIGGER interaction_attempts_append_only_delete
      BEFORE DELETE ON interaction_attempts
      BEGIN
        SELECT RAISE(ABORT, 'APPEND_ONLY_INTERACTION_ATTEMPT');
      END;

      CREATE TRIGGER run_checkpoints_append_only_update
      BEFORE UPDATE ON run_checkpoints
      BEGIN
        SELECT RAISE(ABORT, 'APPEND_ONLY_RUN_CHECKPOINT');
      END;

      CREATE TRIGGER run_checkpoints_append_only_delete
      BEFORE DELETE ON run_checkpoints
      BEGIN
        SELECT RAISE(ABORT, 'APPEND_ONLY_RUN_CHECKPOINT');
      END;
    `);
  }
};
