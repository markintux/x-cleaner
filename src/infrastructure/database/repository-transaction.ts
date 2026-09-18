import type { DatabaseSync } from "node:sqlite";

import type { RepositoryTransaction } from "../../application/ports/repository-transaction.js";

export class SqliteRepositoryTransaction implements RepositoryTransaction {
  readonly kind = "REPOSITORY_TRANSACTION" as const;

  constructor(readonly connection: DatabaseSync) {}
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
