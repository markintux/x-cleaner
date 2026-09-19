import type { DatabaseSync } from "node:sqlite";

import type {
  RepositoryTransaction,
  RepositoryTransactionRunner
} from "../../application/ports/repository-transaction.js";
import type { SqliteDatabase } from "./database.js";

export class SqliteRepositoryTransaction implements RepositoryTransaction {
  readonly kind = "REPOSITORY_TRANSACTION" as const;

  constructor(readonly connection: DatabaseSync) {}
}

export class SqliteRepositoryTransactionRunner implements RepositoryTransactionRunner {
  constructor(private readonly database: SqliteDatabase) {}

  run<Result>(operation: (transaction: RepositoryTransaction) => Result): Result {
    return this.database.transaction((connection) =>
      operation(new SqliteRepositoryTransaction(connection))
    );
  }
}

export function connectionFor(
  fallback: DatabaseSync,
  transaction?: RepositoryTransaction
): DatabaseSync {
  if (transaction === undefined) {
    return fallback;
  }
  if (!(transaction instanceof SqliteRepositoryTransaction)) {
    throw new Error("UNSUPPORTED_REPOSITORY_TRANSACTION");
  }
  return transaction.connection;
}
