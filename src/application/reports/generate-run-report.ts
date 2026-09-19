import type { InteractionType } from "../../domain/interaction.js";
import type { CleaningRunItemStatus } from "../../domain/run.js";
import type { CleaningRunStatus, PauseReason } from "../../domain/run.js";
import {
  GetRunProgress,
  progressTypes,
  type ProgressCounts,
  type RunProgressListItem,
  type RunProgressRow,
  type RunProgress,
  type RunProgressSource
} from "../progress/get-run-progress.js";

export type RunReportTypeCounts = ProgressCounts;

export interface RunReport {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly planId: string;
  readonly state: CleaningRunStatus;
  readonly timestamps: {
    readonly createdAt: string;
    readonly startedAt: string | null;
    readonly pausedAt: string | null;
    readonly finishedAt: string | null;
  };
  readonly interrupted: boolean;
  readonly pauseReason: PauseReason | null;
  readonly counts: ProgressCounts & {
    readonly byType: Readonly<Record<InteractionType, RunReportTypeCounts>>;
    readonly byOutcome: Readonly<Record<string, number>>;
  };
  readonly failureSummaries: readonly string[];
}

export interface GenerateRunReportSource {
  getRun(runId: string): ReturnType<RunProgressSource["getRun"]>;
  getRunProgressRows?: (runId: string) => readonly RunProgressRow[];
  getRunProgress?: (runId: string) => readonly RunProgressRow[];
  listRunItems?: (runId: string) => readonly {
    readonly status: CleaningRunItemStatus;
    readonly attemptCount: number;
    readonly nextRetryAt: string | null;
    readonly interactionType?: RunProgressListItem["interactionType"];
    readonly type?: RunProgressListItem["type"];
    readonly lastErrorCode: string | null;
  }[];
}

export interface GenerateRunReportDependencies {
  readonly runs: GenerateRunReportSource;
  readonly progress?: GetRunProgress;
}

/** Creates an aggregate-only, language-neutral report for one local run. */
export class GenerateRunReport {
  readonly #progress: GetRunProgress;

  constructor(private readonly dependencies: GenerateRunReportDependencies) {
    this.#progress = dependencies.progress ?? new GetRunProgress(dependencies.runs);
  }

  execute(runId: string): RunReport {
    const run = this.dependencies.runs.getRun(runId);
    if (run === null) {
      throw new Error("RUN_NOT_FOUND");
    }
    const progress = this.#progress.execute(runId);
    const byOutcome = outcomeCounts(progress);
    const failureSummaries = this.failureSummaries(runId);
    return {
      schemaVersion: 1,
      runId: run.id,
      planId: run.planId,
      state: run.status,
      timestamps: {
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        pausedAt: run.pausedAt,
        finishedAt: run.finishedAt
      },
      interrupted: run.status === "INTERRUPTED",
      pauseReason: run.pauseReason,
      counts: {
        ...progress.counts,
        byType: progress.byType,
        byOutcome
      },
      failureSummaries
    };
  }

  generate(runId: string): RunReport {
    return this.execute(runId);
  }

  private failureSummaries(runId: string): readonly string[] {
    const items = this.dependencies.runs.listRunItems?.(runId) ?? [];
    const values = new Set<string>();
    for (const item of items) {
      if (item.lastErrorCode === null || item.lastErrorCode.trim() === "") continue;
      values.add(sanitizeFailureCode(item.lastErrorCode));
    }
    return [...values].sort();
  }
}

export function generateRunReport(
  dependencies: GenerateRunReportDependencies,
  runId: string
): RunReport {
  return new GenerateRunReport(dependencies).execute(runId);
}

function outcomeCounts(progress: RunProgress): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {
    COMPLETED: progress.completed,
    REMAINING: progress.remaining,
    SKIPPED: progress.skipped,
    TERMINAL_NON_ERROR: progress.terminalNonError,
    FAILED: progress.failed,
    RETRY: progress.retry
  };
  return counts;
}

export function sanitizeFailureCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (
    /^[A-Z][A-Z0-9_]{0,63}$/u.test(normalized) &&
    !/(CANARY|PASSWORD|COOKIE|TOKEN|SECRET|EMAIL|CONTENT|HTML)/u.test(normalized)
  ) {
    return normalized;
  }
  return "SANITIZED_FAILURE";
}

export { progressTypes };
