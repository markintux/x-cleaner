import type { Clock } from "../ports/clock.js";
import type { ExecutionUnitOfWork } from "../ports/execution-unit-of-work.js";
import type { AuditRepository, NewRunCheckpoint } from "../ports/audit-repository.js";
import type { RunRepository } from "../ports/run-repository.js";
import type { CleaningRun, CleaningRunItem } from "../../domain/run.js";

export interface RecoverRunDependencies {
  readonly runs: RunRepository;
  readonly audit: AuditRepository;
  readonly unitOfWork?: ExecutionUnitOfWork;
}

export interface RecoverRunOptions {
  readonly clock?: Clock;
  readonly now?: () => string;
}

export interface RecoverRunInput {
  readonly runId: string;
}

export interface RecoverRunResult {
  readonly run: CleaningRun;
  readonly recoveredCount: number;
  readonly checkpoint: ReturnType<AuditRepository["appendCheckpoint"]>;
}

/**
 * Reconciles a run after an unclean stop. A PROCESSING row is only eligible
 * when its current attempt has no append-only completion record. Terminal rows
 * are never selected or rewritten.
 */
export class RecoverRun {
  readonly #now: () => string;

  constructor(
    private readonly dependencies: RecoverRunDependencies,
    options: RecoverRunOptions = {}
  ) {
    this.#now = options.clock?.now.bind(options.clock) ?? options.now ?? defaultNow;
  }

  execute(input: RecoverRunInput): RecoverRunResult {
    const { runs, audit, unitOfWork } = this.dependencies;
    const run = runs.getRun(input.runId);
    if (run === null) {
      throw new Error("RUN_NOT_FOUND");
    }

    const recoveredAt = this.#now();
    const before = runs.listRunItems(run.id);
    const checkpointSequence = audit.listCheckpoints(run.id).length + 1;
    const checkpoint: NewRunCheckpoint = {
      runId: run.id,
      sequence: checkpointSequence,
      reason: "ITEM_COMMITTED",
      lastRunItemSequence: lastCommittedSequence(before),
      aggregateCountsJson: aggregateCountsAfterRecovery(before, audit),
      createdAt: recoveredAt
    };

    const recoveredCount =
      unitOfWork?.commitRecovery === undefined
        ? recoverWithoutUnitOfWork(runs, audit, run.id, recoveredAt, checkpoint)
        : unitOfWork.commitRecovery({
            runId: run.id,
            recoveredAt,
            checkpoint
          });
    const savedCheckpoint = audit.listCheckpoints(run.id).at(-1);
    if (savedCheckpoint === undefined) {
      throw new Error("RECOVERY_CHECKPOINT_MISSING");
    }
    return {
      run: runs.getRun(run.id) ?? run,
      recoveredCount,
      checkpoint: savedCheckpoint
    };
  }
}

export function recoverRun(
  dependencies: RecoverRunDependencies,
  input: RecoverRunInput,
  options: RecoverRunOptions = {}
): RecoverRunResult {
  return new RecoverRun(dependencies, options).execute(input);
}

function recoverWithoutUnitOfWork(
  runs: RunRepository,
  audit: AuditRepository,
  runId: string,
  recoveredAt: string,
  checkpoint: NewRunCheckpoint
): number {
  const recovered = runs.recoverStaleProcessing(runId, recoveredAt);
  audit.appendCheckpoint(checkpoint);
  return recovered;
}

function aggregateCountsAfterRecovery(
  items: readonly CleaningRunItem[],
  audit: AuditRepository
): string {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const hasUncommittedAttempt =
      item.status === "PROCESSING" &&
      (item.attemptCount === 0 ||
        !audit
          .listAttempts(item.id)
          .some((attempt) => attempt.attemptNumber === item.attemptCount));
    const status = hasUncommittedAttempt ? "PENDING" : item.status;
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

function defaultNow(): string {
  return new Date().toISOString();
}
