import type { CleanerEngine, CleanerEngineOutcome } from "../ports/cleaner-engine.js";
import type { Clock } from "../ports/clock.js";
import type { Delay } from "../ports/delay.js";
import type { ExecutionUnitOfWork } from "../ports/execution-unit-of-work.js";
import type { ExecutorLockPort } from "../ports/executor-lock.js";
import type { PlanRepository } from "../ports/plan-repository.js";
import type { RunRepository } from "../ports/run-repository.js";
import type { AuditRepository } from "../ports/audit-repository.js";
import type { CatalogRepository } from "../ports/catalog-repository.js";
import type { DetectedAccount } from "../../domain/account.js";
import { normalizeAccountHandle } from "../../domain/account.js";
import type {
  CleaningRun,
  CleaningRunItem,
  RunBatch,
  CleaningRunItemStatus,
  CheckpointReason
} from "../../domain/run.js";
import type { NewInteractionAttempt, NewRunCheckpoint } from "../ports/audit-repository.js";
import { selectNextItems } from "./select-next-item.js";
import { safetyError } from "./safety-error.js";

export interface ExecuteBatchInput {
  readonly runId: string;
  readonly batchId: string;
  readonly account?: DetectedAccount;
  readonly detectedAccount?: DetectedAccount;
  readonly currentAccount?: DetectedAccount;
}

export interface ExecuteBatchOptions {
  readonly clock?: Clock;
  readonly delay?: Delay;
  readonly delayMilliseconds?: number;
}

export interface ExecuteBatchDependencies {
  readonly plans: PlanRepository;
  readonly catalog: CatalogRepository;
  readonly runs: RunRepository;
  readonly audit: AuditRepository;
  readonly unitOfWork: ExecutionUnitOfWork;
  readonly lock?: ExecutorLockPort;
  readonly engine?: CleanerEngine;
}

export interface ExecuteBatchResult {
  readonly run: CleaningRun;
  readonly batch: RunBatch;
  readonly processedCount: number;
  readonly engineCalls: number;
}

/** Sequentially executes one independently confirmed batch under the lock. */
export class ExecuteBatch {
  readonly #now: () => string;
  readonly #delay: Delay | undefined;
  readonly #delayMilliseconds: number;

  constructor(
    private readonly dependencies: ExecuteBatchDependencies,
    options: ExecuteBatchOptions = {}
  ) {
    this.#now = options.clock?.now.bind(options.clock) ?? (() => new Date().toISOString());
    this.#delay = options.delay;
    this.#delayMilliseconds = options.delayMilliseconds ?? 0;
    if (!Number.isFinite(this.#delayMilliseconds) || this.#delayMilliseconds < 0) {
      throw new Error("INVALID_DELAY");
    }
  }

  async execute(input: ExecuteBatchInput): Promise<ExecuteBatchResult> {
    const { plans, catalog, runs, audit, unitOfWork, lock, engine } = this.dependencies;
    const run = runs.getRun(input.runId);
    if (run === null) {
      throw safetyError("RUN_NOT_FOUND");
    }
    const batch = runs.getBatch(input.batchId);
    if (batch === null || batch.runId !== run.id) {
      throw safetyError("BATCH_NOT_FOUND");
    }
    if (batch.status !== "RUNNING") {
      throw safetyError("BATCH_ALREADY_FINISHED");
    }
    if (run.status === "COMPLETED" || run.status === "FAILED" || run.status === "INTERRUPTED") {
      throw safetyError("RUN_NOT_RESUMABLE");
    }
    if (batch.confirmedAt.trim() === "") {
      throw safetyError("CONFIRMATION_REQUIRED");
    }
    assertCurrentAccount(run, catalog, input);
    assertReviewedPlan(plans, run);
    if (lock === undefined) {
      throw safetyError("EXECUTOR_LOCK_REQUIRED");
    }
    if (engine === undefined) {
      throw safetyError("ENGINE_NOT_CONFIGURED");
    }

    const lease = await lock.acquire();
    try {
      const startedAt = run.startedAt ?? this.#now();
      runs.recoverStaleProcessing(run.id, this.#now());
      runs.updateRunStatus(run.id, "RUNNING", {
        pauseReason: null,
        startedAt,
        pausedAt: null,
        finishedAt: null
      });

      const selected = selectNextItems(runs, { batch, runId: run.id, now: this.#now() });
      let processedCount = 0;
      let paused = false;
      let pauseReason: CleaningRun["pauseReason"] = null;

      for (const [index, item] of selected.entries()) {
        if (index > 0 && this.#delay !== undefined && this.#delayMilliseconds > 0) {
          await this.#delay.wait(this.#delayMilliseconds);
        }
        const processingStartedAt = this.#now();
        runs.updateRunItem(item.id, {
          status: "PROCESSING",
          attemptCount: item.attemptCount + 1,
          processingStartedAt,
          nextRetryAt: null,
          completedAt: null
        });
        const interaction = catalog.getInteraction(item.interactionId);
        const outcome =
          interaction === null
            ? ({
                kind: "PERMANENT_FAILURE",
                outcome: "FAILED",
                errorCode: "INTERACTION_NOT_FOUND"
              } satisfies CleanerEngineOutcome)
            : await executeSafely(engine, {
                runId: run.id,
                runItemId: item.id,
                interaction
              });
        const finishedAt = this.#now();
        const status = statusForOutcome(outcome);
        const updatedItem = updateForOutcome(item, status, outcome, finishedAt);
        const nextCheckpointSequence = audit.listCheckpoints(run.id).length + 1;
        const checkpoint: NewRunCheckpoint = {
          runId: run.id,
          sequence: nextCheckpointSequence,
          reason: checkpointReasonForOutcome(outcome),
          lastRunItemSequence: item.sequence,
          aggregateCountsJson: aggregateCounts(runs.listRunItems(run.id), item, updatedItem),
          createdAt: finishedAt
        };
        const attempt: NewInteractionAttempt = {
          runItemId: item.id,
          batchId: batch.id,
          attemptNumber: item.attemptCount + 1,
          outcome: outcome.outcome,
          retryable: outcome.kind === "RETRYABLE_FAILURE",
          durationMs: outcome.durationMs ?? 0,
          errorCode: errorCodeForOutcome(outcome),
          errorContextJson: null,
          startedAt: processingStartedAt,
          finishedAt,
          createdAt: finishedAt
        };
        if (
          outcome.kind === "SESSION_EXPIRED" ||
          outcome.kind === "CHALLENGE_OR_RATE_LIMIT" ||
          outcome.kind === "UNKNOWN_UI"
        ) {
          paused = true;
          pauseReason = outcome.pauseReason;
        }
        unitOfWork.commitAttempt({
          attempt,
          runItemId: item.id,
          runItemUpdate: updatedItem,
          checkpoint,
          ...(paused
            ? {
                batch: { id: batch.id, status: "PAUSED", finishedAt },
                run: {
                  id: run.id,
                  status: "PAUSED",
                  state: {
                    pauseReason,
                    startedAt,
                    pausedAt: finishedAt,
                    finishedAt: null
                  }
                }
              }
            : {})
        });
        processedCount += 1;
        if (paused) {
          break;
        }
      }

      if (!paused) {
        const currentItems = runs.listRunItems(run.id);
        const hasPending = currentItems.some((item) => item.status === "PENDING");
        const finishedAt = this.#now();
        const nextCheckpointSequence = audit.listCheckpoints(run.id).length + 1;
        const finalStatus: CleaningRun["status"] = hasPending ? "PAUSED" : "COMPLETED";
        const finalCheckpoint: NewRunCheckpoint = {
          runId: run.id,
          sequence: nextCheckpointSequence,
          reason: finalStatus === "COMPLETED" ? "COMPLETED" : "ITEM_COMMITTED",
          lastRunItemSequence: lastCommittedSequence(currentItems),
          aggregateCountsJson: aggregateCounts(currentItems),
          createdAt: finishedAt
        };
        unitOfWork.commitBatchBoundary({
          batch: { id: batch.id, status: "COMPLETED", finishedAt },
          run: {
            id: run.id,
            status: finalStatus,
            state: {
              pauseReason: null,
              startedAt,
              pausedAt: finalStatus === "PAUSED" ? finishedAt : null,
              finishedAt: finalStatus === "COMPLETED" ? finishedAt : null
            }
          },
          checkpoint: finalCheckpoint
        });
      }

      const finalRun = runs.getRun(run.id);
      const finalBatch = runs.getBatch(batch.id);
      if (finalRun === null || finalBatch === null) {
        throw new Error("EXECUTION_RESULT_MISSING");
      }
      return { run: finalRun, batch: finalBatch, processedCount, engineCalls: processedCount };
    } finally {
      await lease.release();
    }
  }
}

export async function executeBatch(
  dependencies: ExecuteBatchDependencies,
  input: ExecuteBatchInput,
  options: ExecuteBatchOptions = {}
): Promise<ExecuteBatchResult> {
  return new ExecuteBatch(dependencies, options).execute(input);
}

function assertReviewedPlan(plans: PlanRepository, run: CleaningRun): void {
  const snapshot = plans.getSnapshot(run.planId);
  if (snapshot === null || snapshot.plan.reviewedAt.trim() === "") {
    throw safetyError("REVIEWED_PLAN_REQUIRED");
  }
  if (
    snapshot.plan.selectedCount <= 0 ||
    snapshot.items.length === 0 ||
    snapshot.items.length !== snapshot.plan.selectedCount
  ) {
    throw safetyError("PLAN_EMPTY");
  }
  if (snapshot.plan.accountId !== run.accountId) {
    throw safetyError("ACCOUNT_MISMATCH");
  }
}

function assertCurrentAccount(
  run: CleaningRun,
  catalog: CatalogRepository,
  input: ExecuteBatchInput
): void {
  const account = input.account ?? input.detectedAccount ?? input.currentAccount;
  if (account === undefined) {
    throw safetyError("CURRENT_ACCOUNT_REQUIRED");
  }
  const managed = catalog.getManagedAccount();
  if (managed === null || managed.confirmedHandle === null || managed.confirmedAt === null) {
    throw safetyError("CONFIRMED_ACCOUNT_REQUIRED");
  }
  let handle: string;
  try {
    handle = normalizeAccountHandle(account.handle);
  } catch {
    throw safetyError("ACCOUNT_MISMATCH");
  }
  let confirmedHandle: string;
  try {
    confirmedHandle = normalizeAccountHandle(managed.confirmedHandle);
  } catch {
    throw safetyError("ACCOUNT_MISMATCH");
  }
  if (managed.id !== run.accountId || handle !== run.boundHandle || handle !== confirmedHandle) {
    throw safetyError("ACCOUNT_MISMATCH");
  }
  if (managed.xUserId !== null && account.xUserId !== null && managed.xUserId !== account.xUserId) {
    throw safetyError("ACCOUNT_MISMATCH");
  }
}

async function executeSafely(
  engine: CleanerEngine,
  input: Parameters<CleanerEngine["execute"]>[0]
): Promise<CleanerEngineOutcome> {
  try {
    return await engine.execute(input);
  } catch {
    return { kind: "PERMANENT_FAILURE", outcome: "FAILED", errorCode: "ENGINE_ERROR" };
  }
}

function statusForOutcome(outcome: CleanerEngineOutcome): CleaningRunItemStatus {
  switch (outcome.kind) {
    case "COMPLETED":
      return "COMPLETED";
    case "TERMINAL_NON_ERROR":
      return outcome.outcome;
    case "RETRYABLE_FAILURE":
      return "PENDING";
    case "PERMANENT_FAILURE":
      return "FAILED";
    case "SESSION_EXPIRED":
    case "CHALLENGE_OR_RATE_LIMIT":
    case "UNKNOWN_UI":
      return "PENDING";
  }
}

function updateForOutcome(
  item: CleaningRunItem,
  status: CleaningRunItemStatus,
  outcome: CleanerEngineOutcome,
  finishedAt: string
) {
  return {
    status,
    attemptCount: item.attemptCount + 1,
    processingStartedAt: null,
    nextRetryAt: outcome.kind === "RETRYABLE_FAILURE" ? (outcome.nextRetryAt ?? finishedAt) : null,
    completedAt: status === "PENDING" ? null : finishedAt,
    lastErrorCode: errorCodeForOutcome(outcome)
  } as const;
}

function errorCodeForOutcome(outcome: CleanerEngineOutcome): string | null {
  return "errorCode" in outcome ? (outcome.errorCode ?? null) : null;
}

function checkpointReasonForOutcome(outcome: CleanerEngineOutcome): CheckpointReason {
  switch (outcome.kind) {
    case "SESSION_EXPIRED":
      return "SESSION_EXPIRED";
    case "CHALLENGE_OR_RATE_LIMIT":
      return outcome.pauseReason;
    case "UNKNOWN_UI":
      return "UNKNOWN_UI";
    case "PERMANENT_FAILURE":
      return "FAILURE";
    default:
      return "ITEM_COMMITTED";
  }
}

function aggregateCounts(
  items: readonly CleaningRunItem[],
  replacingItem?: CleaningRunItem,
  replacement?: ReturnType<typeof updateForOutcome>
): string {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const status =
      replacingItem?.id === item.id && replacement !== undefined ? replacement.status : item.status;
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return JSON.stringify(counts);
}

function lastCommittedSequence(items: readonly CleaningRunItem[]): number | null {
  const committed = items.filter(
    (item) => item.status !== "PROCESSING" && item.status !== "PENDING"
  );
  return committed.at(-1)?.sequence ?? null;
}
