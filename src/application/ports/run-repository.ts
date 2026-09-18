import type { CleaningRun, CleaningRunItem, RunBatch } from "../../domain/run.js";
import type { RepositoryTransaction } from "./repository-transaction.js";

export interface EligibleRunItemPage {
  readonly items: readonly CleaningRunItem[];
  readonly hasMore: boolean;
}

export interface RunItemUpdate {
  readonly status: CleaningRunItem["status"];
  readonly attemptCount?: number;
  readonly processingStartedAt?: string | null;
  readonly nextRetryAt?: string | null;
  readonly completedAt?: string | null;
  readonly lastErrorCode?: string | null;
}

export interface RunRepository {
  createRun(run: CleaningRun, transaction?: RepositoryTransaction): void;
  getRun(runId: string): CleaningRun | null;
  getRunForPlan(planId: string): CleaningRun | null;
  getRunItem(runItemId: number): CleaningRunItem | null;
  createBatch(batch: RunBatch, transaction?: RepositoryTransaction): void;
  getBatch(batchId: string): RunBatch | null;
  pageEligibleItems(runId: string, now: string, limit: number): EligibleRunItemPage;
  updateRunItem(
    runItemId: number,
    update: RunItemUpdate,
    transaction?: RepositoryTransaction
  ): void;
  updateRunStatus(
    runId: string,
    status: CleaningRun["status"],
    update: Pick<CleaningRun, "pauseReason" | "startedAt" | "pausedAt" | "finishedAt">,
    transaction?: RepositoryTransaction
  ): void;
  updateBatchStatus(
    batchId: string,
    status: RunBatch["status"],
    finishedAt: string | null,
    transaction?: RepositoryTransaction
  ): void;
  recoverStaleProcessing(runId: string, now: string, transaction?: RepositoryTransaction): number;
}
