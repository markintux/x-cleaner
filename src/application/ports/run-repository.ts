import type { CleaningRun, CleaningRunItem, RunBatch } from "../../domain/run.js";
import type { RunProgressRow } from "../progress/get-run-progress.js";
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

export interface RunOverview {
  readonly runId: string;
  readonly types: readonly string[];
  readonly status: CleaningRun["status"];
  readonly pauseReason: CleaningRun["pauseReason"];
  readonly total: number;
  readonly processed: number;
  readonly completed: number;
  readonly pending: number;
  readonly failed: number;
  readonly overlappingPending: number;
}

export interface RunRepository {
  /** Aggregate-only menu projection; never selects interaction text or X IDs. */
  listRunOverviews?(): readonly RunOverview[];
  createRun(run: CleaningRun, transaction?: RepositoryTransaction): void;
  getRun(runId: string): CleaningRun | null;
  getRunForPlan(planId: string): CleaningRun | null;
  getRunItem(runItemId: number): CleaningRunItem | null;
  listRunItems(runId: string): readonly CleaningRunItem[];
  /** Lightweight projection for progress/reporting; it must not select content. */
  getRunProgressRows?(runId: string): readonly RunProgressRow[];
  createBatch(batch: RunBatch, transaction?: RepositoryTransaction): void;
  getBatch(batchId: string): RunBatch | null;
  /** Ordered batch projection; recovery uses it to find unclosed boundaries. */
  listBatches?(runId: string): readonly RunBatch[];
  pageEligibleItems(
    runId: string,
    now: string,
    limit: number,
    afterSequence?: number
  ): EligibleRunItemPage;
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
