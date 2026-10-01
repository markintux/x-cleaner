import type { Migration } from "../migrator.js";

export const runArchivingMigration: Migration = {
  version: 5,
  name: "005_run_archiving",
  up(connection): void {
    connection.exec("ALTER TABLE cleaning_runs ADD COLUMN archived_at TEXT");
  }
};
