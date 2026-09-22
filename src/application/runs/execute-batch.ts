import type { CleanerEngine, CleanerEngineOutcome } from "../ports/cleaner-engine.js";
import type { Clock } from "../ports/clock.js";
import { recordAudit, type AuditLogger } from "../ports/audit-logger.js";
import type { Delay } from "../ports/delay.js";
import type { ExecutionUnitOfWork } from "../ports/execution-unit-of-work.js";
import { reportProgress, type ExecutionProgressReporter } from "../ports/execution-progress.js";
import type { ExecutorLockPort } from "../ports/executor-lock.js";
import type { PlanRepository } from "../ports/plan-repository.js";
import type { RunRepository } from "../ports/run-repository.js";
import type { AuditRepository } from "../ports/audit-repository.js";
import type { CatalogRepository } from "../ports/catalog-repository.js";
import type { DetectedAccount } from "../../domain/account.js";
import { normalizeAccountHandle } from "../../domain/account.js";
import {
  RetryPolicy,
  type RetryFailureCategory,
  type RetryPolicyOptions
} from "../../domain/retry-policy.js";
import type {
  CleaningRun,
  CleaningRunItem,
  RunBatch,
  CleaningRunItemStatus,
  CheckpointReason
} from "../../domain/run.js";
import type { NewInteractionAttempt, NewRunCheckpoint } from "../ports/audit-repository.js";
import { selectNextItem } from "./select-next-item.js";
import { safetyError } from "./safety-error.js";

export interface ExecuteBatchInput {
  readonly runId: string;
  readonly batchId: string;
  readonly account?: DetectedAccount;
  readonly detectedAccount?: DetectedAccount;
  readonly currentAccount?: DetectedAccount;
}

export interface ExecuteBatchSignal {
  isStopRequested(): boolean;
  setCheckpointFlusher?(flusher: () => Promise<void> | void): void;
}

export interface ExecuteBatchOptions {
  readonly clock?: Clock;
  readonly delay?: Delay;
  /** Pacing delay between different interactions. */
  readonly delayMilliseconds?: number;
  readonly retryPolicy?: RetryPolicy | RetryPolicyOptions;
  readonly signal?: ExecuteBatchSignal;
  /** Optional operator feed; it never affects the durable outcome. */
  readonly progress?: ExecutionProgressReporter;
}

export interface ExecuteBatchDependencies {
  readonly plans: PlanRepository;
  readonly catalog: CatalogRepository;
  readonly runs: RunRepository;
  readonly audit: AuditRepository;
  readonly unitOfWork: ExecutionUnitOfWork;
  readonly lock?: ExecutorLockPort;
  readonly engine?: CleanerEngine;
  readonly auditLogger?: AuditLogger;
}

export interface ExecuteBatchResult {
  readonly run: CleaningRun;
  readonly batch: RunBatch;
  /** Number of distinct run items reached by this invocation. */
  readonly processedCount: number;
  /** Number of engine calls, including retries. */
  readonly engineCalls: number;
}

/** Sequentially executes one independently confirmed batch under the lock. */
export class ExecuteBatch {
  readonly #now: () => string;
  readonly #delay: Delay | undefined;
  readonly #delayMilliseconds: number;
  readonly #retryPolicy: RetryPolicy;
  readonly #signal: ExecuteBatchSignal | undefined;
  readonly #progress: ExecutionProgressReporter | undefined;

  constructor(
    private readonly dependencies: ExecuteBatchDependencies,
    options: ExecuteBatchOptions = {}
  ) {
    this.#now = options.clock?.now.bind(options.clock) ?? defaultNow;
    this.#delay = options.delay;
    this.#delayMilliseconds = options.delayMilliseconds ?? 0;
    this.#retryPolicy =
      options.retryPolicy instanceof RetryPolicy
        ? options.retryPolicy
        : new RetryPolicy(options.retryPolicy);
    this.#signal = options.signal;
    this.#progress = options.progress;
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
    if (run.status === "COMPLETED" || run.status === "FAILED") {
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
      // A command that owns the lock may safely treat a leftover PROCESSING
      // row as stale. Resume performs the audited version before confirmation.
      runs.recoverStaleProcessing(run.id, this.#now());
      runs.updateRunStatus(run.id, "RUNNING", {
        pauseReason: null,
        startedAt,
        pausedAt: null,
        finishedAt: null
      });

      let resolveCurrentBoundary: () => void = () => undefined;
      let currentBoundary = Promise.resolve();
      this.#signal?.setCheckpointFlusher?.(() => currentBoundary);

      let processedCount = 0;
      let engineCalls = 0;
      let paused = false;

      while (processedCount < (batch.requestedLimit ?? Number.MAX_SAFE_INTEGER)) {
        if (this.stopRequested()) {
          this.commitInterrupted(run, batch, startedAt, audit, unitOfWork);
          break;
        }
        const item = selectNextItem(runs, { batch, runId: run.id, now: this.#now() });
        if (item === null) {
          this.commitBatchCompletion(run, batch, startedAt, audit, unitOfWork);
          break;
        }

        if (processedCount > 0 && this.#delay !== undefined && this.#delayMilliseconds > 0) {
          reportProgress(this.#progress, {
            kind: "WAITING",
            milliseconds: this.#delayMilliseconds,
            nextPosition: processedCount + 1,
            total: batch.requestedLimit
          });
          await this.#delay.wait(this.#delayMilliseconds);
          if (this.stopRequested()) {
            this.commitInterrupted(run, batch, startedAt, audit, unitOfWork);
            break;
          }
        }

        let currentItem = item;
        let itemFinished = false;
        while (!itemFinished) {
          if (this.stopRequested()) {
            this.commitInterrupted(run, batch, startedAt, audit, unitOfWork);
            break;
          }

          const attemptNumber = currentItem.attemptCount + 1;
          const processingStartedAt = this.#now();
          currentBoundary = new Promise<void>((resolve) => {
            resolveCurrentBoundary = resolve;
          });
          runs.updateRunItem(currentItem.id, {
            status: "PROCESSING",
            attemptCount: attemptNumber,
            processingStartedAt,
            nextRetryAt: null,
            completedAt: null
          });
          const interaction = catalog.getInteraction(currentItem.interactionId);
          const progressItem = {
            position: processedCount + 1,
            total: batch.requestedLimit,
            sequence: currentItem.sequence,
            type: interaction?.type ?? null,
            xInteractionId: interaction?.xInteractionId ?? null,
            attemptNumber
          };
          reportProgress(this.#progress, { kind: "ITEM_STARTED", ...progressItem });
          const outcome =
            interaction === null
              ? ({
                  kind: "PERMANENT_FAILURE",
                  outcome: "FAILED",
                  errorCode: "INTERACTION_NOT_FOUND"
                } satisfies CleanerEngineOutcome)
              : await executeSafely(engine, {
                  runId: run.id,
                  runItemId: currentItem.id,
                  interaction
                });
          engineCalls += 1;
          const finishedAt = this.#now();
          const retryDecision = retryDecisionFor(outcome, attemptNumber, this.#retryPolicy);
          const retryAllowed = retryDecision.retry;
          const retryDelayMs = retryAllowed
            ? retryDelayFor(outcome, this.#retryPolicy.delayFor(attemptNumber), finishedAt)
            : 0;
          const status = statusForOutcome(outcome, retryAllowed);
          const updatedItem = updateForOutcome(
            currentItem,
            status,
            outcome,
            finishedAt,
            retryDelayMs
          );
          const checkpoint: NewRunCheckpoint = {
            runId: run.id,
            sequence: audit.listCheckpoints(run.id).length + 1,
            reason: checkpointReasonForOutcome(outcome, retryAllowed),
            lastRunItemSequence: currentItem.sequence,
            aggregateCountsJson: aggregateCounts(
              runs.listRunItems(run.id),
              currentItem,
              updatedItem
            ),
            createdAt: finishedAt
          };
          const attempt: NewInteractionAttempt = {
            runItemId: currentItem.id,
            batchId: batch.id,
            attemptNumber,
            outcome: outcome.outcome,
            retryable: outcome.kind === "RETRYABLE_FAILURE",
            durationMs: outcome.durationMs ?? 0,
            errorCode: errorCodeForOutcome(outcome),
            errorContextJson: null,
            startedAt: processingStartedAt,
            finishedAt,
            createdAt: finishedAt
          };

          const pauseReason = pauseReasonForOutcome(outcome);
          paused = pauseReason !== null;
          unitOfWork.commitAttempt({
            attempt,
            runItemId: currentItem.id,
            runItemUpdate: updatedItem,
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
              : {}),
            checkpoint
          });
          await recordAudit(this.dependencies.auditLogger, {
            event: "interaction.attempted",
            timestamp: finishedAt,
            runId: run.id,
            interactionId: interaction?.xInteractionId ?? null,
            type: interaction?.type ?? null,
            attemptNumber,
            outcome: outcome.outcome,
            durationMs: outcome.durationMs ?? 0,
            errorCode: errorCodeForOutcome(outcome)
          });
          resolveCurrentBoundary();
          reportProgress(this.#progress, {
            kind: "ITEM_FINISHED",
            ...progressItem,
            outcome: outcome.outcome,
            status,
            errorCode: errorCodeForOutcome(outcome),
            durationMs: outcome.durationMs ?? 0
          });

          if (paused) {
            itemFinished = true;
            break;
          }
          if (retryAllowed) {
            // The attempt is already durable as PENDING. The injected delay
            // is the scheduling boundary; no wall-clock sleep is used here.
            if (this.#delay !== undefined) {
              await this.#delay.wait(retryDelayMs);
            }
            if (this.stopRequested()) {
              this.commitInterrupted(run, batch, startedAt, audit, unitOfWork);
              itemFinished = true;
              break;
            }
            currentItem = runs.getRunItem(currentItem.id) ?? {
              ...currentItem,
              ...updatedItem
            };
            continue;
          }

          itemFinished = true;
        }
        if (this.stopRequested() || paused) {
          break;
        }
        processedCount += 1;
      }

      // A requested batch limit can end the scheduler immediately after the
      // last item. Close that confirmed batch at the same durable boundary.
      if (!paused && runs.getBatch(batch.id)?.status === "RUNNING") {
        this.commitBatchCompletion(run, batch, startedAt, audit, unitOfWork);
      }

      const finalRun = runs.getRun(run.id);
      const finalBatch = runs.getBatch(batch.id);
      if (finalRun === null || finalBatch === null) {
        throw new Error("EXECUTION_RESULT_MISSING");
      }
      const progressEvent =
        finalRun.status === "PAUSED"
          ? { event: "run.paused", reason: finalRun.pauseReason }
          : finalRun.status === "INTERRUPTED"
            ? { event: "run.interrupted" }
            : finalRun.status === "FAILED"
              ? { event: "run.failed" }
              : { event: "run.completed" };
      await recordAudit(this.dependencies.auditLogger, {
        ...progressEvent,
        timestamp: finalRun.finishedAt ?? this.#now(),
        runId: finalRun.id,
        aggregateCounts: aggregateCounts(this.dependencies.runs.listRunItems(run.id))
      });
      return { run: finalRun, batch: finalBatch, processedCount, engineCalls };
    } finally {
      await lease.release();
    }
  }

  private stopRequested(): boolean {
    return this.#signal?.isStopRequested() ?? false;
  }

  private commitInterrupted(
    run: CleaningRun,
    batch: RunBatch,
    startedAt: string,
    audit: AuditRepository,
    unitOfWork: ExecutionUnitOfWork
  ): void {
    const finishedAt = this.#now();
    unitOfWork.commitBatchBoundary({
      batch: { id: batch.id, status: "INTERRUPTED", finishedAt },
      run: {
        id: run.id,
        status: "INTERRUPTED",
        state: {
          pauseReason: null,
          startedAt,
          pausedAt: null,
          finishedAt
        }
      },
      checkpoint: {
        runId: run.id,
        sequence: audit.listCheckpoints(run.id).length + 1,
        reason: "MANUAL_INTERRUPT",
        lastRunItemSequence: lastCommittedSequence(this.dependencies.runs.listRunItems(run.id)),
        aggregateCountsJson: aggregateCounts(this.dependencies.runs.listRunItems(run.id)),
        createdAt: finishedAt
      }
    });
  }

  private commitBatchCompletion(
    run: CleaningRun,
    batch: RunBatch,
    startedAt: string,
    audit: AuditRepository,
    unitOfWork: ExecutionUnitOfWork
  ): void {
    const currentItems = this.dependencies.runs.listRunItems(run.id);
    const hasPending = currentItems.some((item) => item.status === "PENDING");
    const finishedAt = this.#now();
    const finalStatus: CleaningRun["status"] = hasPending ? "PAUSED" : "COMPLETED";
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
      checkpoint: {
        runId: run.id,
        sequence: audit.listCheckpoints(run.id).length + 1,
        reason: finalStatus === "COMPLETED" ? "COMPLETED" : "ITEM_COMMITTED",
        lastRunItemSequence: lastCommittedSequence(currentItems),
        aggregateCountsJson: aggregateCounts(currentItems),
        createdAt: finishedAt
      }
    });
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

function statusForOutcome(
  outcome: CleanerEngineOutcome,
  retryAllowed: boolean
): CleaningRunItemStatus {
  switch (outcome.kind) {
    case "COMPLETED":
      return "COMPLETED";
    case "TERMINAL_NON_ERROR":
      return outcome.outcome;
    case "RETRYABLE_FAILURE":
      return retryAllowed || pauseReasonForOutcome(outcome) !== null ? "PENDING" : "FAILED";
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
  finishedAt: string,
  delayMs: number
) {
  return {
    status,
    attemptCount: item.attemptCount + 1,
    processingStartedAt: null,
    nextRetryAt:
      outcome.kind === "RETRYABLE_FAILURE" && status === "PENDING"
        ? (outcome.nextRetryAt ?? addMilliseconds(finishedAt, delayMs))
        : null,
    completedAt: status === "PENDING" ? null : finishedAt,
    lastErrorCode: errorCodeForOutcome(outcome)
  } as const;
}

function retryDecisionFor(
  outcome: CleanerEngineOutcome,
  attemptNumber: number,
  policy: RetryPolicy
): { readonly retry: boolean; readonly category: RetryFailureCategory | null } {
  if (outcome.kind !== "RETRYABLE_FAILURE") {
    return { retry: false, category: null };
  }
  const category = retryCategoryFor(outcome.errorCode);
  const decision =
    category === "RATE_LIMIT"
      ? { attemptNumber, category, safeRetryAt: outcome.nextRetryAt ?? null }
      : { attemptNumber, category };
  return {
    category,
    retry: policy.shouldRetry(decision)
  };
}

function retryCategoryFor(errorCode: string): RetryFailureCategory {
  const normalized = errorCode.trim().toUpperCase();
  if (normalized.includes("CAPTCHA")) return "CAPTCHA";
  if (normalized.includes("SUSPICIOUS") || normalized.includes("LOGIN")) {
    return "SUSPICIOUS_LOGIN";
  }
  if (normalized.includes("RATE_LIMIT") || normalized === "RATE_LIMIT") return "RATE_LIMIT";
  if (normalized.includes("UNKNOWN")) return "UNKNOWN_UI";
  if (normalized.includes("SESSION")) return "SESSION_EXPIRED";
  return "TRANSIENT_FAILURE";
}

function retryDelayFor(
  outcome: CleanerEngineOutcome,
  policyDelayMs: number,
  finishedAt: string
): number {
  if (outcome.kind !== "RETRYABLE_FAILURE" || outcome.nextRetryAt === undefined) {
    return policyDelayMs;
  }
  const retryAt = Date.parse(outcome.nextRetryAt ?? "");
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(retryAt) || !Number.isFinite(finished)) {
    return policyDelayMs;
  }
  return Math.max(policyDelayMs, retryAt - finished);
}

function errorCodeForOutcome(outcome: CleanerEngineOutcome): string | null {
  return "errorCode" in outcome ? (outcome.errorCode ?? null) : null;
}

function pauseReasonForOutcome(outcome: CleanerEngineOutcome): CleaningRun["pauseReason"] {
  switch (outcome.kind) {
    case "SESSION_EXPIRED":
      return "SESSION_EXPIRED";
    case "CHALLENGE_OR_RATE_LIMIT":
      return outcome.pauseReason;
    case "UNKNOWN_UI":
      return "UNKNOWN_UI";
    case "RETRYABLE_FAILURE": {
      const code = outcome.errorCode.trim().toUpperCase();
      if (code.includes("RATE_LIMIT") && outcome.nextRetryAt === undefined) return "RATE_LIMIT";
      if (code.includes("RATE_LIMIT") && outcome.nextRetryAt === null) return "RATE_LIMIT";
      if (code.includes("RATE_LIMIT")) return null;
      if (code.includes("CAPTCHA") || code.includes("SUSPICIOUS") || code.includes("LOGIN")) {
        return "SECURITY_CHALLENGE";
      }
      if (code.includes("UNKNOWN")) return "UNKNOWN_UI";
      if (code.includes("SESSION")) return "SESSION_EXPIRED";
      return null;
    }
    default:
      return null;
  }
}

function checkpointReasonForOutcome(
  outcome: CleanerEngineOutcome,
  retryAllowed: boolean
): CheckpointReason {
  const pauseReason = pauseReasonForOutcome(outcome);
  if (pauseReason !== null) {
    return pauseReason;
  }
  switch (outcome.kind) {
    case "SESSION_EXPIRED":
      return "SESSION_EXPIRED";
    case "CHALLENGE_OR_RATE_LIMIT":
      return outcome.pauseReason;
    case "UNKNOWN_UI":
      return "UNKNOWN_UI";
    case "PERMANENT_FAILURE":
      return "FAILURE";
    case "RETRYABLE_FAILURE":
      return retryAllowed ? "ITEM_COMMITTED" : "FAILURE";
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

function addMilliseconds(iso: string, milliseconds: number): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp) || milliseconds <= 0) {
    return iso;
  }
  return new Date(timestamp + milliseconds).toISOString();
}

function defaultNow(): string {
  return new Date().toISOString();
}
