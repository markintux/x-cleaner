import type { Clock } from "../ports/clock.js";
import type { RunRepository } from "../ports/run-repository.js";
import type { CleaningRunItem, RunBatch } from "../../domain/run.js";
import { safetyError } from "./safety-error.js";

export interface SelectNextItemsInput {
  readonly batchId?: string;
  readonly batch?: RunBatch;
  readonly runId?: string;
  readonly now?: string;
  readonly clock?: Clock;
  readonly pageSize?: number;
}

/** Reads only pending, due work and applies the limit of this confirmed batch. */
export function selectNextItems(
  runs: RunRepository,
  input: SelectNextItemsInput
): readonly CleaningRunItem[] {
  const batch = input.batch ?? (input.batchId === undefined ? null : runs.getBatch(input.batchId));
  if (batch === null) {
    throw safetyError("BATCH_NOT_FOUND");
  }
  if (batch.status !== "RUNNING") {
    throw safetyError("BATCH_ALREADY_FINISHED");
  }
  const runId = input.runId ?? batch.runId;
  const now = input.now ?? input.clock?.now() ?? new Date().toISOString();
  const pageSize = input.pageSize ?? 100;
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw safetyError("INVALID_BATCH_LIMIT");
  }

  const wanted = batch.requestedLimit ?? Number.MAX_SAFE_INTEGER;
  const selected: CleaningRunItem[] = [];
  let cursorHasMore = true;
  let page = 0;
  let afterSequence = 0;
  while (cursorHasMore && selected.length < wanted) {
    const remaining = Math.min(pageSize, wanted - selected.length);
    const result = runs.pageEligibleItems(runId, now, remaining, afterSequence);
    // The repository page is stable by sequence. A bounded first page is
    // enough for a batch limit, while larger batches are read incrementally.
    selected.push(...result.items);
    afterSequence = selected.at(-1)?.sequence ?? afterSequence;
    cursorHasMore = result.hasMore;
    page += 1;
    if (page > 10_000) {
      throw new Error("RUN_SCHEDULER_PAGE_OVERFLOW");
    }
  }
  return selected.slice(0, wanted);
}

export function selectNextItem(
  runs: RunRepository,
  input: SelectNextItemsInput
): CleaningRunItem | null {
  return selectNextItems(runs, input)[0] ?? null;
}
