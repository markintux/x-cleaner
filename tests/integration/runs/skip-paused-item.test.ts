import { describe, expect, it, vi } from "vitest";

import { SkipPausedItem } from "../../../src/application/runs/skip-paused-item.js";
import { ExecutorLock } from "../../../src/infrastructure/lock/executor-lock.js";
import {
  addInteraction,
  createDatabaseFixture,
  createPlan,
  fixedNow,
  seedCatalog
} from "../../support/database.js";

describe("decisão local de deixar item pausado de fora", () => {
  it("encerra run sem pendências, preserva tentativas e nunca conta como removido", async () => {
    const fixture = await pausedFixture();
    try {
      const service = new SkipPausedItem({ ...fixture, lock: new ExecutorLock(fixture.directory) });
      const review = service.review("run-skip");
      const attempts = fixture.audit.listAttempts(review.item.id);
      await service.execute("run-skip", review, "PULAR");
      expect(fixture.runs.getRun("run-skip")).toMatchObject({
        status: "COMPLETED",
        pauseReason: null
      });
      expect(fixture.runs.getRunItem(review.item.id)).toMatchObject({
        status: "SKIPPED",
        attemptCount: 1,
        completedAt: null,
        lastErrorCode: "TARGET_EVIDENCE_MISSING"
      });
      expect(fixture.audit.listAttempts(review.item.id)).toEqual(attempts);
      expect(fixture.runs.listRunOverviews()[0]).toMatchObject({
        completed: 0,
        skipped: 1,
        pending: 0
      });
      expect(
        JSON.parse(fixture.audit.listCheckpoints("run-skip").at(-1)!.aggregateCountsJson)
      ).toEqual({ SKIPPED: 1 });
    } finally {
      await fixture.cleanup();
    }
  });

  it.each(["SESSION_EXPIRED", "SECURITY_CHALLENGE", "RATE_LIMIT"] as const)(
    "não usa a decisão para contornar %s",
    async (reason) => {
      const fixture = await pausedFixture();
      try {
        const run = fixture.runs.getRun("run-skip")!;
        fixture.runs.updateRunStatus(run.id, "PAUSED", { ...run, pauseReason: reason });
        const service = new SkipPausedItem({
          ...fixture,
          lock: new ExecutorLock(fixture.directory)
        });
        expect(() => service.review(run.id)).toThrow("PAUSED_ITEM_NOT_SKIPPABLE");
        expect(fixture.runs.listRunItems(run.id)[0]?.status).toBe("PENDING");
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it("recusa revisão desatualizada e não pula outro item", async () => {
    const fixture = await pausedFixture();
    try {
      const service = new SkipPausedItem({ ...fixture, lock: new ExecutorLock(fixture.directory) });
      const review = service.review("run-skip");
      await expect(
        service.execute(
          "run-skip",
          { ...review, item: { ...review.item, id: review.item.id + 1 } },
          "PULAR"
        )
      ).rejects.toThrow("PAUSED_ITEM_REVIEW_CHANGED");
      expect(fixture.runs.getRunItem(review.item.id)?.status).toBe("PENDING");
      expect(fixture.audit.listCheckpoints("run-skip")).toHaveLength(0);
      expect(await new ExecutorLock(fixture.directory).diagnoseStaleLock()).toBe("NOT_HELD");
    } finally {
      await fixture.cleanup();
    }
  });

  it("recusa mudança na conta confirmada", async () => {
    const fixture = await pausedFixture();
    try {
      const service = new SkipPausedItem({ ...fixture, lock: new ExecutorLock(fixture.directory) });
      const review = service.review("run-skip");
      const account = fixture.catalog.getManagedAccount()!;
      fixture.catalog.upsertManagedAccount({ ...account, confirmedHandle: "other-owner" });
      await expect(service.execute("run-skip", review, "PULAR")).rejects.toThrow(
        "ACCOUNT_MISMATCH"
      );
      expect(fixture.runs.getRunItem(review.item.id)?.status).toBe("PENDING");
    } finally {
      await fixture.cleanup();
    }
  });

  it("respeita outro executor e mantém estado intacto", async () => {
    const fixture = await pausedFixture();
    const lock = new ExecutorLock(fixture.directory);
    const lease = await lock.acquire();
    try {
      const service = new SkipPausedItem({ ...fixture, lock });
      const review = service.review("run-skip");
      await expect(service.execute("run-skip", review, "PULAR")).rejects.toThrow(
        "EXECUTOR_LOCK_HELD"
      );
      expect(fixture.runs.getRunItem(review.item.id)?.status).toBe("PENDING");
      expect(fixture.audit.listCheckpoints("run-skip")).toHaveLength(0);
    } finally {
      await lease.release();
      await fixture.cleanup();
    }
  });

  it("reverte tudo quando a gravação do checkpoint falha", async () => {
    const fixture = await pausedFixture();
    try {
      const service = new SkipPausedItem({ ...fixture, lock: new ExecutorLock(fixture.directory) });
      const review = service.review("run-skip");
      const append = vi.spyOn(fixture.audit, "appendCheckpoint").mockImplementation(() => {
        throw new Error("synthetic failure");
      });
      await expect(service.execute("run-skip", review, "PULAR")).rejects.toThrow(
        "synthetic failure"
      );
      append.mockRestore();
      expect(fixture.runs.getRunItem(review.item.id)?.status).toBe("PENDING");
      expect(fixture.runs.getRun("run-skip")?.pauseReason).toBe("UNKNOWN_UI");
      expect(fixture.audit.listCheckpoints("run-skip")).toHaveLength(0);
      expect(await new ExecutorLock(fixture.directory).diagnoseStaleLock()).toBe("NOT_HELD");
    } finally {
      await fixture.cleanup();
    }
  });
});

async function pausedFixture() {
  const fixture = await createDatabaseFixture();
  const { accountId, importId } = seedCatalog(fixture);
  const account = fixture.catalog.getManagedAccount()!;
  fixture.catalog.upsertManagedAccount({
    ...account,
    confirmedHandle: "synthetic-1",
    confirmedAt: fixedNow
  });
  const plan = createPlan(fixture, accountId, [addInteraction(fixture, accountId, importId, 1)]);
  fixture.runs.createRun({
    id: "run-skip",
    planId: plan.id,
    accountId,
    boundHandle: "synthetic-1",
    status: "PAUSED",
    pauseReason: "UNKNOWN_UI",
    startedAt: fixedNow,
    pausedAt: fixedNow,
    finishedAt: null,
    createdAt: fixedNow,
    updatedAt: fixedNow
  });
  fixture.runs.createBatch({
    id: "batch-skip",
    runId: "run-skip",
    requestedLimit: 1,
    status: "PAUSED",
    confirmedAt: fixedNow,
    startedAt: fixedNow,
    finishedAt: fixedNow,
    createdAt: fixedNow,
    updatedAt: fixedNow
  });
  const item = fixture.runs.listRunItems("run-skip")[0]!;
  fixture.runs.updateRunItem(item.id, {
    status: "PENDING",
    attemptCount: 1,
    lastErrorCode: "TARGET_EVIDENCE_MISSING"
  });
  fixture.audit.appendAttempt({
    runItemId: item.id,
    batchId: "batch-skip",
    attemptNumber: 1,
    outcome: "PAUSED",
    retryable: false,
    durationMs: 1,
    errorCode: "TARGET_EVIDENCE_MISSING",
    errorContextJson: null,
    startedAt: fixedNow,
    finishedAt: fixedNow,
    createdAt: fixedNow
  });
  return fixture;
}
