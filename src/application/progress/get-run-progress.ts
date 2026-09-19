import type { InteractionType } from "../../domain/interaction.js";
import type { CleaningRun, CleaningRunItemStatus, PauseReason } from "../../domain/run.js";

export const progressTypes = ["POST", "REPLY", "REPOST", "LIKE"] as const;

export interface RunProgressRow {
  readonly type: InteractionType;
  readonly status: CleaningRunItemStatus;
  readonly attemptCount: number;
  readonly nextRetryAt: string | null;
}

export interface ProgressCounts {
  readonly total: number;
  readonly completed: number;
  readonly remaining: number;
  readonly skipped: number;
  readonly terminalNonError: number;
  readonly failed: number;
  readonly paused: number;
  readonly retry: number;
  readonly processing: number;
}

export interface RunProgress {
  readonly runId: string;
  readonly state: CleaningRun["status"];
  readonly pauseReason: PauseReason | null;
  readonly counts: ProgressCounts;
  readonly byType: Readonly<Record<InteractionType, ProgressCounts>>;
  readonly total: number;
  readonly completed: number;
  readonly remaining: number;
  readonly skipped: number;
  readonly terminalNonError: number;
  readonly failed: number;
  readonly paused: number;
  readonly retry: number;
}

export interface RunProgressSource {
  getRun(runId: string): CleaningRun | null;
  getRunProgressRows?: (runId: string) => readonly RunProgressRow[];
  getRunProgress?: (runId: string) => readonly RunProgressRow[];
  listRunItems?: (runId: string) => readonly RunProgressListItem[];
}

export interface RunProgressListItem {
  readonly status: CleaningRunItemStatus;
  readonly attemptCount: number;
  readonly nextRetryAt: string | null;
  readonly interactionType?: InteractionType | undefined;
  readonly type?: InteractionType | undefined;
}

type MutableProgressCounts = {
  -readonly [Key in keyof ProgressCounts]: ProgressCounts[Key];
};

/** Builds indexed lifecycle counts without selecting interaction content. */
export class GetRunProgress {
  constructor(private readonly source: RunProgressSource) {}

  execute(input: string | { readonly runId: string }): RunProgress {
    const runId = typeof input === "string" ? input : input.runId;
    const run = this.source.getRun(runId);
    if (run === null) {
      throw new Error("RUN_NOT_FOUND");
    }
    const rows = this.readRows(runId);
    const byType = Object.fromEntries(progressTypes.map((type) => [type, emptyCounts()])) as Record<
      InteractionType,
      MutableProgressCounts
    >;
    const counts = emptyCounts();
    for (const row of rows) {
      const typeCounts = byType[row.type];
      addStatus(typeCounts, row);
      addStatus(counts, row);
    }
    counts.paused = run.status === "PAUSED" ? 1 : 0;
    return {
      runId,
      state: run.status,
      pauseReason: run.pauseReason,
      counts,
      byType,
      ...counts
    };
  }

  get(input: string | { readonly runId: string }): RunProgress {
    return this.execute(input);
  }

  private readRows(runId: string): readonly RunProgressRow[] {
    if (this.source.getRunProgressRows !== undefined) {
      return this.source.getRunProgressRows(runId);
    }
    if (this.source.getRunProgress !== undefined) {
      return this.source.getRunProgress(runId);
    }
    if (this.source.listRunItems === undefined) {
      throw new Error("RUN_PROGRESS_SOURCE_UNAVAILABLE");
    }
    return this.source.listRunItems(runId).map((item) => {
      const type = item.interactionType ?? item.type;
      if (type === undefined) {
        throw new Error("RUN_PROGRESS_TYPE_UNAVAILABLE");
      }
      return {
        type,
        status: item.status,
        attemptCount: item.attemptCount,
        nextRetryAt: item.nextRetryAt
      };
    });
  }
}

export function getRunProgress(source: RunProgressSource, runId: string): RunProgress {
  return new GetRunProgress(source).execute(runId);
}

function emptyCounts(): MutableProgressCounts {
  return {
    total: 0,
    completed: 0,
    remaining: 0,
    skipped: 0,
    terminalNonError: 0,
    failed: 0,
    paused: 0,
    retry: 0,
    processing: 0
  };
}

function addStatus(counts: MutableProgressCounts, row: RunProgressRow): void {
  counts.total += 1;
  switch (row.status) {
    case "COMPLETED":
      counts.completed += 1;
      break;
    case "SKIPPED":
      counts.skipped += 1;
      break;
    case "NOT_FOUND":
    case "ALREADY_REMOVED":
    case "UNAVAILABLE":
      counts.terminalNonError += 1;
      break;
    case "FAILED":
      counts.failed += 1;
      break;
    case "PROCESSING":
      counts.processing += 1;
      counts.remaining += 1;
      break;
    case "PENDING":
      counts.remaining += 1;
      if (row.attemptCount > 0) counts.retry += 1;
      break;
  }
}
