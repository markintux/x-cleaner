import { describe, expect, it } from "vitest";

import type { CleaningRun, RunBatch } from "../../../src/domain/run.js";
import {
  addInteraction,
  createDatabaseFixture,
  createPlan,
  fixedNow,
  seedCatalog
} from "../../support/database.js";

function runFor(planId: string, accountId: string, id = "run-1"): CleaningRun {
  return {
    id,
    planId,
    accountId,
    boundHandle: "synthetic",
    status: "PENDING",
    pauseReason: null,
    startedAt: null,
    pausedAt: null,
    finishedAt: null,
    createdAt: fixedNow,
    updatedAt: fixedNow
  };
}

function batchFor(runId: string, id: string, requestedLimit: number | null): RunBatch {
  return {
    id,
    runId,
    requestedLimit,
    confirmedAt: fixedNow,
    status: "RUNNING",
    startedAt: fixedNow,
    finishedAt: null,
    createdAt: fixedNow,
    updatedAt: fixedNow
  };
}

describe("SqliteRunRepository", () => {
  it("materializa uma única execução por plano e pagina trabalho elegível sem terminais", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const itemIds = [
        addInteraction(fixture, accountId, importId, 1),
        addInteraction(fixture, accountId, importId, 2),
        addInteraction(fixture, accountId, importId, 3)
      ];
      const plan = createPlan(fixture, accountId, itemIds);
      const run = runFor(plan.id, accountId);
      fixture.runs.createRun(run);

      const firstPage = fixture.runs.pageEligibleItems(run.id, fixedNow, 1);
      expect(firstPage.items.map((item) => item.sequence)).toEqual([1]);
      expect(firstPage.hasMore).toBe(true);
      const allItems = fixture.runs.pageEligibleItems(run.id, fixedNow, 10).items;
      fixture.runs.updateRunItem(allItems[0]!.id, {
        status: "COMPLETED",
        completedAt: fixedNow
      });
      expect(
        fixture.runs.pageEligibleItems(run.id, fixedNow, 10).items.map((item) => item.sequence)
      ).toEqual([2, 3]);
      expect(() => fixture.runs.createRun(runFor(plan.id, accountId, "run-duplicate"))).toThrow();
    } finally {
      await fixture.cleanup();
    }
  });

  it("recupera somente PROCESSING obsoleto e registra confirmações em lotes separados", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const interaction = addInteraction(fixture, accountId, importId, 1);
      const plan = createPlan(fixture, accountId, [interaction]);
      const run = runFor(plan.id, accountId);
      fixture.runs.createRun(run);
      const runItem = fixture.runs.pageEligibleItems(run.id, fixedNow, 1).items[0]!;
      fixture.runs.updateRunItem(runItem.id, {
        status: "PROCESSING",
        processingStartedAt: fixedNow
      });
      expect(fixture.runs.recoverStaleProcessing(run.id, "2026-03-04T05:07:07.000Z")).toBe(1);
      expect(fixture.runs.getRunItem(runItem.id)).toMatchObject({
        status: "PENDING",
        processingStartedAt: null,
        nextRetryAt: "2026-03-04T05:07:07.000Z"
      });

      fixture.runs.createBatch(batchFor(run.id, "batch-1", 1));
      fixture.runs.createBatch(batchFor(run.id, "batch-2", 5));
      expect(fixture.runs.getBatch("batch-1")?.requestedLimit).toBe(1);
      expect(fixture.runs.getBatch("batch-2")?.requestedLimit).toBe(5);
    } finally {
      await fixture.cleanup();
    }
  });
});
