import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SqliteDatabase } from "../../../src/infrastructure/database/database.js";
import { migrations } from "../../../src/infrastructure/database/migrations/index.js";
import { Migrator, type Migration } from "../../../src/infrastructure/database/migrator.js";

const timestamp = "2026-01-02T03:04:05.000Z";
const digest = "a".repeat(64);

describe("schema SQLite", () => {
  let temporaryDirectory: string;
  const databases: SqliteDatabase[] = [];

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-schema-"));
  });

  afterEach(async () => {
    for (const database of databases.splice(0)) {
      database.close();
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  function openDatabase(): SqliteDatabase {
    const database = new SqliteDatabase(path.join(temporaryDirectory, "state.sqlite"));
    databases.push(database);
    return database;
  }

  function migrateDatabase(): SqliteDatabase {
    const database = openDatabase();
    new Migrator(database, { now: () => timestamp }).migrate(migrations);
    return database;
  }

  function insertCatalogPrerequisites(database: SqliteDatabase): void {
    database.connection
      .prepare(
        `INSERT INTO managed_accounts (id, x_user_id, archive_handle, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run("account-1", "90071992547409931234", "conta-sintetica", timestamp, timestamp);
    database.connection
      .prepare(
        `INSERT INTO archive_imports (
          id, account_id, source_kind, source_label, source_sha256, adapter_key, status,
          started_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "import-1",
        "account-1",
        "DIRECTORY",
        "arquivo-sintetico",
        digest,
        "synthetic-ytd",
        "COMPLETED",
        timestamp,
        timestamp,
        timestamp
      );
  }

  function insertInteraction(database: SqliteDatabase): void {
    database.connection
      .prepare(
        `INSERT INTO interactions (
          account_id, x_interaction_id, type, source_relative_path,
          first_seen_import_id, last_seen_import_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "account-1",
        "90071992547409931234",
        "POST",
        "data/tweets.js",
        "import-1",
        "import-1",
        timestamp,
        timestamp
      );
  }

  it("cria as 13 tabelas e todos os índices de contrato em uma base nova", () => {
    const database = migrateDatabase();
    const tableNames = database.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    const indexNames = database.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all()
      .map((row) => row.name);

    expect(tableNames).toEqual([
      "archive_imports",
      "cleaning_plan_items",
      "cleaning_plan_types",
      "cleaning_plans",
      "cleaning_run_items",
      "cleaning_runs",
      "generated_reports",
      "interaction_attempts",
      "interactions",
      "managed_accounts",
      "run_batches",
      "run_checkpoints",
      "schema_migrations"
    ]);
    expect(indexNames).toEqual(
      expect.arrayContaining([
        "archive_imports_account_created_idx",
        "archive_imports_account_id_idx",
        "archive_imports_source_sha256_idx",
        "archive_imports_status_idx",
        "cleaning_plan_items_interaction_idx",
        "cleaning_plan_items_pk",
        "cleaning_plan_items_sequence_uq",
        "cleaning_plan_types_pk",
        "cleaning_plans_account_created_idx",
        "cleaning_run_items_interaction_idx",
        "cleaning_run_items_run_interaction_uq",
        "cleaning_run_items_run_sequence_uq",
        "cleaning_run_items_scheduler_idx",
        "cleaning_runs_account_created_idx",
        "cleaning_runs_account_id_idx",
        "cleaning_runs_status_idx",
        "generated_reports_generated_at_idx",
        "interaction_attempts_batch_id_idx",
        "interaction_attempts_item_number_uq",
        "interaction_attempts_outcome_idx",
        "interactions_account_type_xid_uq",
        "interactions_first_import_idx",
        "interactions_last_import_idx",
        "interactions_selection_idx",
        "managed_accounts_archive_handle_idx",
        "managed_accounts_confirmed_handle_idx",
        "run_batches_run_created_idx",
        "run_batches_status_idx",
        "run_checkpoints_run_created_idx",
        "run_checkpoints_run_sequence_uq"
      ])
    );
    expect(database.connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });

  it("registra cada migração uma vez e torna a repetição um no-op", () => {
    const database = migrateDatabase();
    const migrator = new Migrator(database, { now: () => "2026-01-02T04:05:06.000Z" });

    migrator.migrate(migrations);

    expect(
      database.connection.prepare("SELECT version, name, applied_at FROM schema_migrations").all()
    ).toEqual([
      { version: 1, name: "001_catalog", applied_at: timestamp },
      { version: 2, name: "002_plans", applied_at: timestamp },
      { version: 3, name: "003_runs", applied_at: timestamp },
      { version: 4, name: "004_audit", applied_at: timestamp }
    ]);
  });

  it("ativa o modo defensivo contra alterações diretas no catálogo SQLite", () => {
    const database = openDatabase();
    database.connection.exec("CREATE TABLE regular_table (value TEXT)");

    expect(() =>
      database.connection.exec(
        "PRAGMA writable_schema = ON; DELETE FROM sqlite_master WHERE name = 'regular_table'"
      )
    ).toThrow();
    expect(
      database.connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("regular_table")
    ).toEqual({ name: "regular_table" });
  });

  it("preserva IDs X como texto e impõe unicidade, chaves estrangeiras e singleton", () => {
    const database = migrateDatabase();
    insertCatalogPrerequisites(database);
    insertInteraction(database);

    expect(database.connection.prepare("SELECT x_interaction_id FROM interactions").get()).toEqual({
      x_interaction_id: "90071992547409931234"
    });
    expect(() =>
      database.connection
        .prepare(
          `INSERT INTO interactions (
            account_id, x_interaction_id, type, source_relative_path,
            first_seen_import_id, last_seen_import_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "account-1",
          "90071992547409931234",
          "POST",
          "data/tweets.js",
          "import-1",
          "import-1",
          timestamp,
          timestamp
        )
    ).toThrow();
    expect(() =>
      database.connection
        .prepare("INSERT INTO managed_accounts (id, created_at, updated_at) VALUES (?, ?, ?)")
        .run("account-2", timestamp, timestamp)
    ).toThrow();
    expect(() =>
      database.connection
        .prepare(
          `INSERT INTO interactions (
            account_id, x_interaction_id, type, source_relative_path,
            first_seen_import_id, last_seen_import_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "missing-account",
          "123",
          "LIKE",
          "data/like.js",
          "import-1",
          "import-1",
          timestamp,
          timestamp
        )
    ).toThrow();
  });

  it("declara todas as chaves estrangeiras restritivas do contrato", () => {
    const database = migrateDatabase();
    const foreignKeysFor = (table: string): string[] =>
      database.connection
        .prepare(`PRAGMA foreign_key_list(${table})`)
        .all()
        .map((row) => `${row.from}->${row.table}.${row.to}:${row.on_delete}`)
        .sort();

    expect(foreignKeysFor("archive_imports")).toEqual([
      "account_id->managed_accounts.id:NO ACTION"
    ]);
    expect(foreignKeysFor("interactions")).toEqual([
      "account_id->managed_accounts.id:NO ACTION",
      "first_seen_import_id->archive_imports.id:NO ACTION",
      "last_seen_import_id->archive_imports.id:NO ACTION"
    ]);
    expect(foreignKeysFor("cleaning_plans")).toEqual([
      "account_id->managed_accounts.id:NO ACTION",
      "catalog_cutoff_id->interactions.id:NO ACTION"
    ]);
    expect(foreignKeysFor("cleaning_plan_types")).toEqual(["plan_id->cleaning_plans.id:NO ACTION"]);
    expect(foreignKeysFor("cleaning_plan_items")).toEqual([
      "interaction_id->interactions.id:NO ACTION",
      "plan_id->cleaning_plans.id:NO ACTION"
    ]);
    expect(foreignKeysFor("cleaning_runs")).toEqual([
      "account_id->managed_accounts.id:NO ACTION",
      "plan_id->cleaning_plans.id:NO ACTION"
    ]);
    expect(foreignKeysFor("run_batches")).toEqual(["run_id->cleaning_runs.id:NO ACTION"]);
    expect(foreignKeysFor("cleaning_run_items")).toEqual([
      "interaction_id->interactions.id:NO ACTION",
      "run_id->cleaning_runs.id:NO ACTION"
    ]);
    expect(foreignKeysFor("interaction_attempts")).toEqual([
      "batch_id->run_batches.id:NO ACTION",
      "run_item_id->cleaning_run_items.id:NO ACTION"
    ]);
    expect(foreignKeysFor("run_checkpoints")).toEqual(["run_id->cleaning_runs.id:NO ACTION"]);
    expect(foreignKeysFor("generated_reports")).toEqual(["run_id->cleaning_runs.id:NO ACTION"]);
  });

  it("declara CHECKs e chaves únicas para todos os contratos persistidos", () => {
    const database = migrateDatabase();
    const tableSql = (table: string): string => {
      const row = database.connection
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table);
      expect(row).toEqual(expect.objectContaining({ sql: expect.any(String) }));
      return (row as { sql: string }).sql.replace(/\s+/g, " ");
    };
    const uniqueKeys = (table: string): string[] => {
      const indexes = database.connection
        .prepare(`PRAGMA index_list(${table})`)
        .all()
        .filter((row) => row.unique === 1 && row.origin !== "pk");
      return [
        ...new Set(
          indexes.map((index) =>
            database.connection
              .prepare(`PRAGMA index_info(${String(index.name)})`)
              .all()
              .map((column) => column.name)
              .join(",")
          )
        )
      ].sort();
    };

    const expectedChecks: Readonly<Record<string, readonly string[]>> = {
      managed_accounts: [
        "CHECK (singleton_key = 1)",
        "x_user_id IS NULL OR (length(x_user_id) > 0 AND x_user_id NOT GLOB '*[^0-9]*')",
        "archive_handle IS NULL OR (length(archive_handle) > 0 AND archive_handle NOT LIKE '@%')",
        "confirmed_handle IS NULL OR (length(confirmed_handle) > 0 AND confirmed_handle NOT LIKE '@%')"
      ],
      archive_imports: [
        "source_kind IN ('ZIP', 'DIRECTORY')",
        "length(source_label) > 0",
        "source_label NOT IN ('.', '..')",
        "instr(source_label, '/') = 0",
        "instr(source_label, char(92)) = 0",
        "source_label NOT GLOB '[A-Za-z]:*'",
        "length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'",
        "status IN ('PROCESSING', 'COMPLETED', 'FAILED')",
        "posts_count >= 0",
        "replies_count >= 0",
        "reposts_count >= 0",
        "likes_count >= 0",
        "inserted_count >= 0",
        "reused_count >= 0",
        "updated_count >= 0"
      ],
      interactions: [
        "length(x_interaction_id) > 0 AND x_interaction_id NOT GLOB '*[^0-9]*'",
        "type IN ('POST', 'REPLY', 'REPOST', 'LIKE')",
        "content_preview IS NULL OR length(content_preview) <= 280",
        "length(source_relative_path) > 0",
        "instr(source_relative_path, char(92)) = 0",
        "source_relative_path NOT LIKE '/%'",
        "source_relative_path NOT GLOB '[A-Za-z]:*'",
        "source_relative_path NOT IN ('.', '..')",
        "source_relative_path NOT LIKE '../%'",
        "source_relative_path NOT LIKE '%/../%'",
        "source_relative_path NOT LIKE '%/..'"
      ],
      cleaning_plans: ["selected_count > 0"],
      cleaning_plan_types: ["interaction_type IN ('POST', 'REPLY', 'REPOST', 'LIKE')"],
      cleaning_plan_items: ["sequence > 0"],
      cleaning_runs: [
        "length(bound_handle) > 0 AND bound_handle NOT LIKE '@%'",
        "status IN ('PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'INTERRUPTED')",
        "pause_reason IS NULL OR pause_reason IN ( 'RATE_LIMIT', 'SECURITY_CHALLENGE', 'SESSION_EXPIRED', 'UNKNOWN_UI' )"
      ],
      run_batches: [
        "requested_limit IS NULL OR requested_limit > 0",
        "status IN ('RUNNING', 'COMPLETED', 'PAUSED', 'FAILED', 'INTERRUPTED')"
      ],
      cleaning_run_items: [
        "sequence > 0",
        "status IN ( 'PENDING', 'PROCESSING', 'COMPLETED', 'SKIPPED', 'FAILED', 'NOT_FOUND', 'ALREADY_REMOVED', 'UNAVAILABLE' )",
        "attempt_count >= 0"
      ],
      interaction_attempts: [
        "attempt_number > 0",
        "outcome IN ( 'COMPLETED', 'RETRYABLE_FAILURE', 'FAILED', 'NOT_FOUND', 'ALREADY_REMOVED', 'UNAVAILABLE', 'PAUSED' )",
        "retryable IN (0, 1)",
        "duration_ms >= 0",
        "error_context_json IS NULL OR ( json_valid(error_context_json) AND json_type(error_context_json) = 'object' )"
      ],
      run_checkpoints: [
        "sequence > 0",
        "reason IN ( 'ITEM_COMMITTED', 'MANUAL_INTERRUPT', 'RATE_LIMIT', 'SECURITY_CHALLENGE', 'SESSION_EXPIRED', 'UNKNOWN_UI', 'FAILURE', 'COMPLETED' )",
        "json_valid(aggregate_counts_json) AND json_type(aggregate_counts_json) = 'object'"
      ],
      generated_reports: [
        "length(relative_path) > 0",
        "instr(relative_path, char(92)) = 0",
        "relative_path NOT LIKE '/%'",
        "relative_path NOT GLOB '[A-Za-z]:*'",
        "relative_path NOT IN ('.', '..')",
        "relative_path NOT LIKE '../%'",
        "relative_path NOT LIKE '%/../%'",
        "relative_path NOT LIKE '%/..'",
        "length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'",
        "json_valid(summary_json) AND json_type(summary_json) = 'object'"
      ]
    };

    for (const [table, checks] of Object.entries(expectedChecks)) {
      const sql = tableSql(table);
      for (const check of checks) {
        expect(sql, `${table}: ${check}`).toContain(check);
      }
    }

    expect(uniqueKeys("managed_accounts")).toEqual(["singleton_key", "x_user_id"]);
    expect(uniqueKeys("interactions")).toEqual(["account_id,type,x_interaction_id"]);
    expect(uniqueKeys("cleaning_plan_types")).toEqual(["plan_id,interaction_type"]);
    expect(uniqueKeys("cleaning_plan_items")).toEqual([
      "plan_id,interaction_id",
      "plan_id,sequence"
    ]);
    expect(uniqueKeys("cleaning_runs")).toEqual(["plan_id"]);
    expect(uniqueKeys("cleaning_run_items")).toEqual(["run_id,interaction_id", "run_id,sequence"]);
    expect(uniqueKeys("interaction_attempts")).toEqual(["run_item_id,attempt_number"]);
    expect(uniqueKeys("run_checkpoints")).toEqual(["run_id,sequence"]);
    expect(uniqueKeys("generated_reports")).toEqual(["run_id"]);
  });

  it("rejeita caminhos absolutos, caminhos Windows e traversal no catálogo", () => {
    const database = migrateDatabase();
    const insertImport = (sourceLabel: string): void => {
      database.connection
        .prepare(
          `INSERT INTO archive_imports (
            id, source_kind, source_label, source_sha256, adapter_key, status,
            started_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `import-${sourceLabel}`,
          "DIRECTORY",
          sourceLabel,
          digest,
          "synthetic-ytd",
          "COMPLETED",
          timestamp,
          timestamp,
          timestamp
        );
    };

    for (const unsafeLabel of [
      "/private/archive.zip",
      "C:\\\\archive.zip",
      "..",
      "data/../archive.zip"
    ]) {
      expect(() => insertImport(unsafeLabel)).toThrow();
    }
    insertImport("archive-sintetico.zip");
    database.connection
      .prepare("INSERT INTO managed_accounts (id, created_at, updated_at) VALUES (?, ?, ?)")
      .run("account-1", timestamp, timestamp);

    for (const unsafePath of [
      "/data/tweets.js",
      "C:/data/tweets.js",
      "C:\\\\data\\\\tweets.js",
      "../data/tweets.js",
      "data/../tweets.js",
      "data/.."
    ]) {
      expect(() =>
        database.connection
          .prepare(
            `INSERT INTO interactions (
              account_id, x_interaction_id, type, source_relative_path,
              first_seen_import_id, last_seen_import_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            "account-1",
            `${unsafePath.length}001`,
            "POST",
            unsafePath,
            "import-archive-sintetico.zip",
            "import-archive-sintetico.zip",
            timestamp,
            timestamp
          )
      ).toThrow();
    }
  });

  it("rejeita valores inválidos, snapshots mutáveis e registros de auditoria mutáveis", () => {
    const database = migrateDatabase();
    insertCatalogPrerequisites(database);
    insertInteraction(database);

    expect(() =>
      database.connection
        .prepare(
          `INSERT INTO interactions (
            account_id, x_interaction_id, type, source_relative_path,
            first_seen_import_id, last_seen_import_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "account-1",
          "not-a-decimal-id",
          "INVALID",
          "data/invalid.js",
          "import-1",
          "import-1",
          timestamp,
          timestamp
        )
    ).toThrow();
    expect(() =>
      database.connection
        .prepare(
          `INSERT INTO cleaning_plans (
            id, account_id, catalog_cutoff_id, selected_count, reviewed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run("empty-plan", "account-1", 1, 1, timestamp, timestamp)
    ).toThrow("INCOMPLETE_CLEANING_PLAN");
    expect(() =>
      database.transaction((connection) => {
        connection
          .prepare("INSERT INTO cleaning_plan_types (plan_id, interaction_type) VALUES (?, ?)")
          .run("plan-with-missing-item", "POST");
        connection
          .prepare(
            "INSERT INTO cleaning_plan_items (plan_id, interaction_id, sequence, created_at) VALUES (?, ?, ?, ?)"
          )
          .run("plan-with-missing-item", 1, 1, timestamp);
        connection
          .prepare(
            `INSERT INTO cleaning_plans (
              id, account_id, catalog_cutoff_id, selected_count, reviewed_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run("plan-with-missing-item", "account-1", 1, 2, timestamp, timestamp);
      })
    ).toThrow("INCOMPLETE_CLEANING_PLAN");
    expect(
      database.connection
        .prepare("SELECT id FROM cleaning_plans WHERE id = ?")
        .get("plan-with-missing-item")
    ).toBeUndefined();
    database.transaction((connection) => {
      connection
        .prepare("INSERT INTO cleaning_plan_types (plan_id, interaction_type) VALUES (?, ?)")
        .run("plan-1", "POST");
      connection
        .prepare(
          "INSERT INTO cleaning_plan_items (plan_id, interaction_id, sequence, created_at) VALUES (?, ?, ?, ?)"
        )
        .run("plan-1", 1, 1, timestamp);
      connection
        .prepare(
          `INSERT INTO cleaning_plans (
            id, account_id, catalog_cutoff_id, selected_count, reviewed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run("plan-1", "account-1", 1, 1, timestamp, timestamp);
    });
    expect(() =>
      database.connection
        .prepare("INSERT INTO cleaning_plan_types (plan_id, interaction_type) VALUES (?, ?)")
        .run("plan-1", "POST")
    ).toThrow("IMMUTABLE_CLEANING_PLAN");
    expect(() =>
      database.connection
        .prepare(
          "INSERT INTO cleaning_plan_items (plan_id, interaction_id, sequence, created_at) VALUES (?, ?, ?, ?)"
        )
        .run("plan-1", 2, 2, timestamp)
    ).toThrow("IMMUTABLE_CLEANING_PLAN");
    expect(() =>
      database.connection
        .prepare("UPDATE cleaning_plan_items SET sequence = 2 WHERE plan_id = ?")
        .run("plan-1")
    ).toThrow("IMMUTABLE_CLEANING_PLAN");

    database.connection
      .prepare(
        `INSERT INTO cleaning_runs (
          id, plan_id, account_id, bound_handle, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run("run-1", "plan-1", "account-1", "conta-sintetica", "PENDING", timestamp, timestamp);
    database.connection
      .prepare(
        `INSERT INTO run_batches (
          id, run_id, confirmed_at, status, started_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run("batch-1", "run-1", timestamp, "RUNNING", timestamp, timestamp, timestamp);
    database.connection
      .prepare(
        `INSERT INTO cleaning_run_items (
          run_id, interaction_id, sequence, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)`
      )
      .run("run-1", 1, 1, timestamp, timestamp);
    database.connection
      .prepare(
        `INSERT INTO interaction_attempts (
          run_item_id, batch_id, attempt_number, outcome, duration_ms, started_at, finished_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(1, "batch-1", 1, "COMPLETED", 0, timestamp, timestamp, timestamp);
    expect(() =>
      database.connection.prepare("DELETE FROM interaction_attempts WHERE id = 1").run()
    ).toThrow("APPEND_ONLY_INTERACTION_ATTEMPT");
    expect(() =>
      database.connection
        .prepare(
          `INSERT INTO run_checkpoints (run_id, sequence, reason, aggregate_counts_json, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run("run-1", 1, "NOT_A_REASON", "{}", timestamp)
    ).toThrow();
  });

  it("faz rollback integral de uma migração que falha", () => {
    const database = openDatabase();
    const failingMigration: Migration = {
      version: 1,
      name: "001_failing",
      up(connection) {
        connection.exec("CREATE TABLE should_not_exist (id INTEGER PRIMARY KEY)");
        throw new Error("MIGRATION_FAILURE");
      }
    };

    expect(() => new Migrator(database).migrate([failingMigration])).toThrow("MIGRATION_FAILURE");
    expect(
      database.connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .all("should_not_exist")
    ).toEqual([]);
    expect(database.connection.prepare("SELECT * FROM schema_migrations").all()).toEqual([]);
  });
});
