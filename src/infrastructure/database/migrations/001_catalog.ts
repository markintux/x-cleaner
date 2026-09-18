import type { DatabaseSync } from "node:sqlite";

import type { Migration } from "../migrator.js";

export const catalogMigration: Migration = {
  version: 1,
  name: "001_catalog",
  up(connection: DatabaseSync): void {
    connection.exec(`
      CREATE TABLE managed_accounts (
        id TEXT PRIMARY KEY NOT NULL,
        singleton_key INTEGER NOT NULL UNIQUE DEFAULT 1 CHECK (singleton_key = 1),
        x_user_id TEXT UNIQUE CHECK (
          x_user_id IS NULL OR (length(x_user_id) > 0 AND x_user_id NOT GLOB '*[^0-9]*')
        ),
        archive_handle TEXT CHECK (
          archive_handle IS NULL OR (length(archive_handle) > 0 AND archive_handle NOT LIKE '@%')
        ),
        confirmed_handle TEXT CHECK (
          confirmed_handle IS NULL OR (length(confirmed_handle) > 0 AND confirmed_handle NOT LIKE '@%')
        ),
        confirmed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX managed_accounts_archive_handle_idx ON managed_accounts (archive_handle);
      CREATE INDEX managed_accounts_confirmed_handle_idx ON managed_accounts (confirmed_handle);

      CREATE TABLE archive_imports (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT REFERENCES managed_accounts (id),
        source_kind TEXT NOT NULL CHECK (source_kind IN ('ZIP', 'DIRECTORY')),
        source_label TEXT NOT NULL CHECK (
          length(source_label) > 0
          AND source_label NOT IN ('.', '..')
          AND instr(source_label, '/') = 0
          AND instr(source_label, char(92)) = 0
          AND source_label NOT GLOB '[A-Za-z]:*'
        ),
        source_sha256 TEXT NOT NULL CHECK (
          length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        adapter_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
        posts_count INTEGER NOT NULL DEFAULT 0 CHECK (posts_count >= 0),
        replies_count INTEGER NOT NULL DEFAULT 0 CHECK (replies_count >= 0),
        reposts_count INTEGER NOT NULL DEFAULT 0 CHECK (reposts_count >= 0),
        likes_count INTEGER NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
        inserted_count INTEGER NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
        reused_count INTEGER NOT NULL DEFAULT 0 CHECK (reused_count >= 0),
        updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
        error_code TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX archive_imports_account_id_idx ON archive_imports (account_id);
      CREATE INDEX archive_imports_source_sha256_idx ON archive_imports (source_sha256);
      CREATE INDEX archive_imports_status_idx ON archive_imports (status);
      CREATE INDEX archive_imports_account_created_idx ON archive_imports (account_id, created_at);

      CREATE TABLE interactions (
        id INTEGER PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES managed_accounts (id),
        x_interaction_id TEXT NOT NULL CHECK (
          length(x_interaction_id) > 0 AND x_interaction_id NOT GLOB '*[^0-9]*'
        ),
        type TEXT NOT NULL CHECK (type IN ('POST', 'REPLY', 'REPOST', 'LIKE')),
        interaction_created_at TEXT,
        content_preview TEXT CHECK (content_preview IS NULL OR length(content_preview) <= 280),
        source_relative_path TEXT NOT NULL CHECK (
          length(source_relative_path) > 0
          AND instr(source_relative_path, char(92)) = 0
          AND source_relative_path NOT LIKE '/%'
          AND source_relative_path NOT GLOB '[A-Za-z]:*'
          AND source_relative_path NOT IN ('.', '..')
          AND source_relative_path NOT LIKE '../%'
          AND source_relative_path NOT LIKE '%/../%'
          AND source_relative_path NOT LIKE '%/..'
        ),
        source_record_key TEXT,
        first_seen_import_id TEXT NOT NULL REFERENCES archive_imports (id),
        last_seen_import_id TEXT NOT NULL REFERENCES archive_imports (id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX interactions_account_type_xid_uq
        ON interactions (account_id, type, x_interaction_id);
      CREATE INDEX interactions_selection_idx
        ON interactions (account_id, type, interaction_created_at, id);
      CREATE INDEX interactions_first_import_idx ON interactions (first_seen_import_id);
      CREATE INDEX interactions_last_import_idx ON interactions (last_seen_import_id);
    `);
  }
};
