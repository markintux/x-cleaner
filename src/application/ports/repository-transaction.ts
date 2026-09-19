/**
 * Opaque transaction token shared by repositories during one application write.
 * Infrastructure owns the concrete SQLite connection behind this marker.
 */
export interface RepositoryTransaction {
  readonly kind: "REPOSITORY_TRANSACTION";
}

/** Runs an application write inside an infrastructure-owned transaction. */
export interface RepositoryTransactionRunner {
  run<Result>(operation: (transaction: RepositoryTransaction) => Result): Result;
}
