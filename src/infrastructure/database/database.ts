import { DatabaseSync } from "node:sqlite";

type DefensiveDatabaseSync = DatabaseSync & {
  enableDefensive(active: boolean): void;
};

export interface SqliteDatabaseOptions {
  readonly busyTimeoutMs?: number;
}

/**
 * Owns one synchronous SQLite connection for a local application-data directory.
 * Callers must use transaction() for writes spanning more than one statement.
 */
export class SqliteDatabase {
  readonly connection: DatabaseSync;
  #transactionActive = false;

  constructor(filename: string, options: SqliteDatabaseOptions = {}) {
    const connectionOptions: ConstructorParameters<typeof DatabaseSync>[1] = {
      allowExtension: false,
      enableForeignKeyConstraints: true,
      timeout: options.busyTimeoutMs ?? 5_000
    };

    this.connection = new DatabaseSync(filename, connectionOptions);
    (this.connection as DefensiveDatabaseSync).enableDefensive(true);

    // Keep this explicit for connections opened against older SQLite defaults too.
    this.connection.exec("PRAGMA foreign_keys = ON");
  }

  transaction<Result>(operation: (connection: DatabaseSync) => Result): Result {
    if (this.#transactionActive) {
      throw new Error("NESTED_TRANSACTION_NOT_SUPPORTED");
    }

    this.#transactionActive = true;
    this.connection.exec("BEGIN IMMEDIATE");

    try {
      const result = operation(this.connection);
      assertCommittedPlanCounts(this.connection);
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    } finally {
      this.#transactionActive = false;
    }
  }

  close(): void {
    this.connection.close();
  }
}

/**
 * SQLite CHECK expressions cannot aggregate child rows. All snapshot writes go
 * through this transaction boundary, which makes the header count and its
 * immutable item rows one committed invariant.
 */
function assertCommittedPlanCounts(connection: DatabaseSync): void {
  const plansTableExists = connection
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cleaning_plans'")
    .get();
  if (plansTableExists === undefined) {
    return;
  }

  const mismatch = connection
    .prepare(
      `SELECT cleaning_plans.id
       FROM cleaning_plans
       LEFT JOIN cleaning_plan_items ON cleaning_plan_items.plan_id = cleaning_plans.id
       GROUP BY cleaning_plans.id
       HAVING cleaning_plans.selected_count != count(cleaning_plan_items.interaction_id)
       LIMIT 1`
    )
    .get();

  if (mismatch !== undefined) {
    throw new Error("CLEANING_PLAN_SELECTED_COUNT_MISMATCH");
  }
}
