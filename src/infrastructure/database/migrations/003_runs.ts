import type { DatabaseSync } from "node:sqlite";

import type { Migration } from "../migrator.js";

export const runsMigration: Migration = {
  version: 3,
  name: "003_runs",
  up(connection: DatabaseSync): void {
    connection.exec(`
      CREATE TABLE cleaning_runs (
        id TEXT PRIMARY KEY NOT NULL,
        plan_id TEXT NOT NULL UNIQUE REFERENCES cleaning_plans (id),
        account_id TEXT NOT NULL REFERENCES managed_accounts (id),
        bound_handle TEXT NOT NULL CHECK (length(bound_handle) > 0 AND bound_handle NOT LIKE '@%'),
        status TEXT NOT NULL CHECK (
          status IN ('PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'INTERRUPTED')
        ),
        pause_reason TEXT CHECK (
          pause_reason IS NULL OR pause_reason IN (
            'RATE_LIMIT', 'SECURITY_CHALLENGE', 'SESSION_EXPIRED', 'UNKNOWN_UI'
          )
        ),
        started_at TEXT,
        paused_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX cleaning_runs_account_id_idx ON cleaning_runs (account_id);
      CREATE INDEX cleaning_runs_status_idx ON cleaning_runs (status);
      CREATE INDEX cleaning_runs_account_created_idx ON cleaning_runs (account_id, created_at);

      CREATE TABLE run_batches (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES cleaning_runs (id),
        requested_limit INTEGER CHECK (requested_limit IS NULL OR requested_limit > 0),
        confirmed_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('RUNNING', 'COMPLETED', 'PAUSED', 'FAILED', 'INTERRUPTED')
        ),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX run_batches_run_created_idx ON run_batches (run_id, created_at);
      CREATE INDEX run_batches_status_idx ON run_batches (status);

      CREATE TABLE cleaning_run_items (
        id INTEGER PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES cleaning_runs (id),
        interaction_id INTEGER NOT NULL REFERENCES interactions (id),
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
          status IN (
            'PENDING', 'PROCESSING', 'COMPLETED', 'SKIPPED', 'FAILED', 'NOT_FOUND',
            'ALREADY_REMOVED', 'UNAVAILABLE'
          )
        ),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        processing_started_at TEXT,
        next_retry_at TEXT,
        completed_at TEXT,
        last_error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (run_id, interaction_id),
        UNIQUE (run_id, sequence)
      );

      CREATE UNIQUE INDEX cleaning_run_items_run_interaction_uq
        ON cleaning_run_items (run_id, interaction_id);
      CREATE UNIQUE INDEX cleaning_run_items_run_sequence_uq
        ON cleaning_run_items (run_id, sequence);
      CREATE INDEX cleaning_run_items_scheduler_idx
        ON cleaning_run_items (run_id, status, next_retry_at, sequence);
      CREATE INDEX cleaning_run_items_interaction_idx ON cleaning_run_items (interaction_id);
    `);
  }
};
