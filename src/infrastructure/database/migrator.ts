import type { DatabaseSync } from "node:sqlite";

import type { SqliteDatabase } from "./database.js";

export interface Migration {
  readonly version: number;
  readonly name: string;
  up(connection: DatabaseSync): void;
}

export interface MigrationRecord {
  readonly version: number;
  readonly name: string;
}

export interface MigratorOptions {
  readonly now?: () => string;
}

export class Migrator {
  readonly #now: () => string;

  constructor(
    private readonly database: SqliteDatabase,
    options: MigratorOptions = {}
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  migrate(migrations: readonly Migration[]): void {
    validateMigrations(migrations);
    this.ensureMigrationTable();

    const applied = this.appliedMigrations();
    validateAppliedMigrations(applied, migrations);
    const appliedVersions = new Set(applied.map((migration) => migration.version));

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }

      this.database.transaction((connection) => {
        migration.up(connection);
        connection
          .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
          .run(migration.version, migration.name, this.#now());
      });
    }
  }

  private ensureMigrationTable(): void {
    this.database.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
  }

  private appliedMigrations(): readonly MigrationRecord[] {
    const rows = this.database.connection
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all();

    return rows.map((row) => {
      const version = row.version;
      const name = row.name;
      if (typeof version !== "number" || typeof name !== "string") {
        throw new Error("INVALID_MIGRATION_RECORD");
      }

      return { version, name };
    });
  }
}

function validateMigrations(migrations: readonly Migration[]): void {
  let previousVersion = 0;

  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= previousVersion) {
      throw new Error("INVALID_MIGRATION_ORDER");
    }

    previousVersion = migration.version;
  }
}

function validateAppliedMigrations(
  appliedMigrations: readonly MigrationRecord[],
  knownMigrations: readonly Migration[]
): void {
  const knownByVersion = new Map(
    knownMigrations.map((migration) => [migration.version, migration])
  );
  let previousVersion = 0;

  for (const appliedMigration of appliedMigrations) {
    const knownMigration = knownByVersion.get(appliedMigration.version);
    if (
      appliedMigration.version <= previousVersion ||
      knownMigration === undefined ||
      knownMigration.name !== appliedMigration.name
    ) {
      throw new Error("MIGRATION_HISTORY_MISMATCH");
    }

    previousVersion = appliedMigration.version;
  }
}
