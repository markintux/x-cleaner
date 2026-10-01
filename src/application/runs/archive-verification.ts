import type { CatalogRepository } from "../ports/catalog-repository.js";
import type { ExecutorLockPort } from "../ports/executor-lock.js";
import type { RepositoryTransactionRunner } from "../ports/repository-transaction.js";
import type { RunOverview, RunRepository } from "../ports/run-repository.js";

export interface VerificationReview {
  readonly overview: RunOverview;
  readonly updatedAt: string;
}

/** Stops an optional verification locally, preserving every outcome and pending item. */
export class ArchiveVerification {
  constructor(
    private readonly dependencies: {
      readonly runs: RunRepository;
      readonly catalog: CatalogRepository;
      readonly transactions: RepositoryTransactionRunner;
      readonly lock: ExecutorLockPort;
    },
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  review(runId: string): VerificationReview {
    const { runs, catalog } = this.dependencies;
    const run = runs.getRun(runId);
    const overview = runs.listRunOverviews?.().find((candidate) => candidate.runId === runId);
    if (
      run === null ||
      overview === undefined ||
      overview.archivedAt !== null ||
      overview.repeatedItems === 0 ||
      overview.pending === 0 ||
      (run.status !== "PAUSED" && run.status !== "INTERRUPTED")
    ) {
      throw new Error("VERIFICATION_NOT_ARCHIVABLE");
    }
    const account = catalog.getManagedAccount();
    if (
      account?.id !== run.accountId ||
      account.confirmedHandle !== run.boundHandle ||
      account.confirmedAt === null
    ) {
      throw new Error("ACCOUNT_MISMATCH");
    }
    if (
      runs.listRunItems(runId).some((item) => item.status === "PROCESSING") ||
      runs.listBatches?.(runId).some((batch) => batch.status === "RUNNING")
    ) {
      throw new Error("RUN_STILL_ACTIVE");
    }
    return { overview, updatedAt: run.updatedAt };
  }

  async execute(reviewed: VerificationReview, confirmation: string): Promise<void> {
    if (confirmation !== "ENCERRAR") throw new Error("ARCHIVE_CONFIRMATION_REQUIRED");
    const { lock, transactions, runs } = this.dependencies;
    const lease = await lock.acquire();
    try {
      transactions.run((transaction) => {
        const current = this.review(reviewed.overview.runId);
        if (
          current.updatedAt !== reviewed.updatedAt ||
          JSON.stringify(current.overview) !== JSON.stringify(reviewed.overview)
        ) {
          throw new Error("VERIFICATION_REVIEW_CHANGED");
        }
        if (runs.archiveRun === undefined) throw new Error("ARCHIVING_NOT_CONFIGURED");
        runs.archiveRun(current.overview.runId, this.now(), transaction);
      });
    } finally {
      await lease.release();
    }
  }
}
