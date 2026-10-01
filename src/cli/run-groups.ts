import { interactionTypes } from "../domain/interaction.js";
import type { RunOverview } from "../application/ports/run-repository.js";

export interface RunGroup {
  readonly type: string;
  readonly runs: readonly RunOverview[];
  readonly current: RunOverview;
  readonly counts: RunOverview["typeCounts"][number];
}

/** One type per row. Counters describe one execution, never a sum of duplicate plans. */
export function groupRunsByType(runs: readonly RunOverview[]): readonly RunGroup[] {
  const types = interactionTypes.filter((type) => runs.some((run) => run.types.includes(type)));
  return types.map((type) => {
    const matching = runs.filter((run) => run.types.includes(type));
    const visible = matching.filter((run) => run.archivedAt === null);
    const current =
      [...visible]
        .reverse()
        .find((run) =>
          run.typeCounts.some(
            (counts) =>
              counts.type === type && (counts.pending > 0 || counts.total > counts.processed)
          )
        ) ??
      visible.at(-1) ??
      matching.at(-1)!;
    const counts = current.typeCounts.find((row) => row.type === type)!;
    return { type, runs: matching, current, counts };
  });
}
