import { describe, expect, it } from "vitest";

import { UnitOfWork } from "../../../src/infrastructure/database/unit-of-work.js";
import {
  addInteraction,
  createDatabaseFixture,
  createPlan,
  fixedNow,
  seedCatalog
} from "../../support/database.js";

describe("UnitOfWork", () => {
  it("confirma tentativa, resultado, checkpoint e estados agregados na mesma transação", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const plan = createPlan(fixture, accountId, [
        addInteraction(fixture, accountId, importId, 1)
      ]);
      fixture.runs.createRun({
        id: "run-1",
        planId: plan.id,
        accountId,
        boundHandle: "synthetic",
        status: "RUNNING",
        pauseReason: null,
        startedAt: fixedNow,
        pausedAt: null,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      fixture.runs.createBatch({
        id: "batch-1",
        runId: "run-1",
        requestedLimit: 1,
        confirmedAt: fixedNow,
        status: "RUNNING",
        startedAt: fixedNow,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      const runItem = fixture.runs.pageEligibleItems("run-1", fixedNow, 1).items[0]!;
      fixture.runs.updateRunItem(runItem.id, {
        status: "PROCESSING",
        processingStartedAt: fixedNow
      });
      const unitOfWork = new UnitOfWork(fixture.database, fixture.runs, fixture.audit);
      const work = {
        attempt: {
          runItemId: runItem.id,
          batchId: "batch-1",
          attemptNumber: 1,
          outcome: "COMPLETED" as const,
          retryable: false,
          durationMs: 12,
          errorCode: null,
          errorContextJson: null,
          startedAt: fixedNow,
          finishedAt: fixedNow,
          createdAt: fixedNow
        },
        runItemId: runItem.id,
        runItemUpdate: {
          status: "COMPLETED" as const,
          attemptCount: 1,
          processingStartedAt: null,
          nextRetryAt: null,
          completedAt: fixedNow,
          lastErrorCode: null
        },
        checkpoint: {
          runId: "run-1",
          sequence: 1,
          reason: "ITEM_COMMITTED" as const,
          lastRunItemSequence: runItem.sequence,
          aggregateCountsJson: "{}",
          createdAt: fixedNow
        },
        batch: { id: "batch-1", status: "COMPLETED" as const, finishedAt: fixedNow },
        run: {
          id: "run-1",
          status: "COMPLETED" as const,
          state: { pauseReason: null, startedAt: fixedNow, pausedAt: null, finishedAt: fixedNow }
        }
      };
      unitOfWork.commitAttempt(work);

      const [attempt] = fixture.audit.listAttempts(runItem.id);
      const [checkpoint] = fixture.audit.listCheckpoints("run-1");
      expect(attempt).toBeDefined();
      expect(checkpoint).toBeDefined();
      expect(fixture.runs.getRunItem(runItem.id)?.status).toBe("COMPLETED");
      expect(fixture.runs.getBatch("batch-1")?.status).toBe("COMPLETED");
      expect(fixture.runs.getRun("run-1")?.status).toBe("COMPLETED");

      expect(() =>
        fixture.database.connection
          .prepare("UPDATE interaction_attempts SET duration_ms = ? WHERE id = ?")
          .run(13, attempt!.id)
      ).toThrow("APPEND_ONLY_INTERACTION_ATTEMPT");
      expect(() =>
        fixture.database.connection
          .prepare("DELETE FROM interaction_attempts WHERE id = ?")
          .run(attempt!.id)
      ).toThrow("APPEND_ONLY_INTERACTION_ATTEMPT");
      expect(() =>
        fixture.database.connection
          .prepare("UPDATE run_checkpoints SET reason = ? WHERE id = ?")
          .run("COMPLETED", checkpoint!.id)
      ).toThrow("APPEND_ONLY_RUN_CHECKPOINT");
      expect(() =>
        fixture.database.connection
          .prepare("DELETE FROM run_checkpoints WHERE id = ?")
          .run(checkpoint!.id)
      ).toThrow("APPEND_ONLY_RUN_CHECKPOINT");
      expect(fixture.audit.listAttempts(runItem.id)).toEqual([attempt]);
      expect(fixture.audit.listCheckpoints("run-1")).toEqual([checkpoint]);

      expect(() =>
        unitOfWork.commitAttempt({
          ...work,
          attempt: { ...work.attempt, attemptNumber: 2 },
          runItemUpdate: { ...work.runItemUpdate, status: "FAILED" },
          checkpoint: { ...work.checkpoint, sequence: 2, aggregateCountsJson: "[]" }
        })
      ).toThrow();
      expect(fixture.audit.listAttempts(runItem.id)).toHaveLength(1);
      expect(fixture.audit.listCheckpoints("run-1")).toHaveLength(1);
      expect(fixture.runs.getRunItem(runItem.id)?.status).toBe("COMPLETED");
    } finally {
      await fixture.cleanup();
    }
  });
});
