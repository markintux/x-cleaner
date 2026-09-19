import type { CleanerEngineOutcome } from "../ports/cleaner-engine.js";
import type { Clock } from "../ports/clock.js";
import type { ExecutionUnitOfWork } from "../ports/execution-unit-of-work.js";
import type { AuditRepository, NewRunCheckpoint } from "../ports/audit-repository.js";
import type { RunRepository } from "../ports/run-repository.js";
import type { CleaningRun, PauseReason } from "../../domain/run.js";

export interface PauseRunDependencies {
  readonly runs: RunRepository;
  readonly audit: AuditRepository;
  readonly unitOfWork: ExecutionUnitOfWork;
}

export interface PauseRunInput {
  readonly runId: string;
  readonly batchId: string;
  readonly outcome?: CleanerEngineOutcome;
  readonly reason?: PauseReason;
}

export interface PauseRunOptions {
  readonly clock?: Clock;
  readonly now?: () => string;
  /** Called only after the pause and checkpoint are durably committed. */
  readonly printGuidance?: (reason: PauseReason, runId: string) => void;
}

export interface PauseRunResult {
  readonly run: CleaningRun;
  readonly reason: PauseReason;
  readonly checkpoint: ReturnType<AuditRepository["appendCheckpoint"]>;
}

/** Persists a pause before emitting any manual-intervention guidance. */
export class PauseRun {
  readonly #now: () => string;
  readonly #printGuidance: ((reason: PauseReason, runId: string) => void) | undefined;

  constructor(
    private readonly dependencies: PauseRunDependencies,
    options: PauseRunOptions = {}
  ) {
    this.#now = options.clock?.now.bind(options.clock) ?? options.now ?? defaultNow;
    this.#printGuidance = options.printGuidance;
  }

  execute(input: PauseRunInput): PauseRunResult {
    const reason =
      input.reason ?? (input.outcome === undefined ? null : pauseReasonForOutcome(input.outcome));
    if (reason === null) {
      throw new Error("PAUSE_REASON_REQUIRED");
    }
    const { runs, audit, unitOfWork } = this.dependencies;
    const run = runs.getRun(input.runId);
    const batch = runs.getBatch(input.batchId);
    if (run === null) {
      throw new Error("RUN_NOT_FOUND");
    }
    if (batch === null || batch.runId !== run.id) {
      throw new Error("BATCH_NOT_FOUND");
    }
    if (batch.status !== "RUNNING") {
      throw new Error("BATCH_ALREADY_FINISHED");
    }

    const pausedAt = this.#now();
    const checkpoint: NewRunCheckpoint = {
      runId: run.id,
      sequence: audit.listCheckpoints(run.id).length + 1,
      reason,
      lastRunItemSequence: lastCommittedSequence(runs.listRunItems(run.id)),
      aggregateCountsJson: aggregateCounts(runs.listRunItems(run.id)),
      createdAt: pausedAt
    };
    unitOfWork.commitBatchBoundary({
      batch: { id: batch.id, status: "PAUSED", finishedAt: pausedAt },
      run: {
        id: run.id,
        status: "PAUSED",
        state: {
          pauseReason: reason,
          startedAt: run.startedAt ?? pausedAt,
          pausedAt,
          finishedAt: null
        }
      },
      checkpoint
    });

    const savedCheckpoint = audit.listCheckpoints(run.id).at(-1);
    if (savedCheckpoint === undefined) {
      throw new Error("PAUSE_CHECKPOINT_MISSING");
    }
    this.#printGuidance?.(reason, run.id);
    return {
      run: runs.getRun(run.id) ?? run,
      reason,
      checkpoint: savedCheckpoint
    };
  }
}

export function pauseRun(
  dependencies: PauseRunDependencies,
  input: PauseRunInput,
  options: PauseRunOptions = {}
): PauseRunResult {
  return new PauseRun(dependencies, options).execute(input);
}

export function pauseReasonForOutcome(outcome: CleanerEngineOutcome): PauseReason | null {
  switch (outcome.kind) {
    case "CHALLENGE_OR_RATE_LIMIT":
      return outcome.pauseReason;
    case "SESSION_EXPIRED":
      return "SESSION_EXPIRED";
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

function aggregateCounts(items: ReturnType<RunRepository["listRunItems"]>): string {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }
  return JSON.stringify(counts);
}

function lastCommittedSequence(items: ReturnType<RunRepository["listRunItems"]>): number | null {
  const committed = items.filter(
    (item) => item.status !== "PROCESSING" && item.status !== "PENDING"
  );
  return committed.at(-1)?.sequence ?? null;
}

function defaultNow(): string {
  return new Date().toISOString();
}
