import { describe, expect, it } from "vitest";

import { ConfirmBatch } from "../../../src/application/runs/confirm-batch.js";
import { CreateRun } from "../../../src/application/runs/create-run.js";
import { ExecuteBatch } from "../../../src/application/runs/execute-batch.js";
import { ExecutorLock } from "../../../src/infrastructure/lock/executor-lock.js";
import { UnitOfWork } from "../../../src/infrastructure/database/unit-of-work.js";
import {
  addInteraction,
  createDatabaseFixture,
  createPlan,
  fixedNow,
  seedCatalog
} from "../../support/database.js";
import { FakeCleanerEngine } from "../../support/fake-cleaner-engine.js";
import { FakeClock } from "../../support/fake-clock.js";
import { FakePrompt } from "../../support/fake-prompt.js";

function account(fixture: Awaited<ReturnType<typeof createDatabaseFixture>>) {
  const managed = fixture.catalog.getManagedAccount()!;
  return { handle: managed.archiveHandle!, xUserId: managed.xUserId };
}

function confirmAccount(fixture: Awaited<ReturnType<typeof createDatabaseFixture>>) {
  const managed = fixture.catalog.getManagedAccount()!;
  fixture.catalog.upsertManagedAccount({
    id: managed.id,
    xUserId: managed.xUserId,
    archiveHandle: managed.archiveHandle,
    confirmedHandle: managed.archiveHandle,
    confirmedAt: fixedNow
  });
}

describe("execução segura com fake engine", () => {
  it("materializa em ordem, persiste cada resultado e trata sucesso e terminais", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      confirmAccount(fixture);
      const interactionIds = [
        addInteraction(fixture, accountId, importId, 1, "POST"),
        addInteraction(fixture, accountId, importId, 2, "REPLY"),
        addInteraction(fixture, accountId, importId, 3, "LIKE")
      ];
      const plan = createPlan(fixture, accountId, interactionIds, ["POST", "REPLY", "LIKE"]);
      const created = new CreateRun(fixture.plans, fixture.catalog, fixture.runs, {
        now: () => fixedNow,
        idFactory: () => "run-execution"
      }).execute({ planId: plan.id, account: account(fixture) });
      const prompt = new FakePrompt(["APAGAR"]);
      const confirmed = await new ConfirmBatch(
        fixture.plans,
        fixture.catalog,
        fixture.runs,
        prompt,
        { now: () => fixedNow, idFactory: () => "batch-all" }
      ).execute({ run: created.run, account: account(fixture) });
      expect(confirmed.confirmed).toBe(true);
      const engine = new FakeCleanerEngine([
        { kind: "COMPLETED", outcome: "COMPLETED" },
        { kind: "TERMINAL_NON_ERROR", outcome: "ALREADY_REMOVED" },
        { kind: "TERMINAL_NON_ERROR", outcome: "NOT_FOUND" }
      ]);
      const executed = await new ExecuteBatch(
        {
          plans: fixture.plans,
          catalog: fixture.catalog,
          runs: fixture.runs,
          audit: fixture.audit,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
          lock: new ExecutorLock(fixture.directory),
          engine
        },
        { clock: new FakeClock(fixedNow) }
      ).execute({ runId: created.run.id, batchId: confirmed.batch!.id, account: account(fixture) });

      expect(engine.calls.map((call) => call.interaction.id)).toEqual(interactionIds);
      expect(executed.run.status).toBe("COMPLETED");
      expect(fixture.runs.listRunItems(created.run.id).map((item) => item.status)).toEqual([
        "COMPLETED",
        "ALREADY_REMOVED",
        "NOT_FOUND"
      ]);
      expect(
        fixture.audit.listAttempts(fixture.runs.listRunItems(created.run.id)[0]!.id)
      ).toHaveLength(1);
      expect(fixture.audit.listCheckpoints(created.run.id).length).toBe(4);
    } finally {
      await fixture.cleanup();
    }
  });

  it("respeita --limit 1 e exige confirmação independente em cada retomada", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      confirmAccount(fixture);
      const ids = [
        addInteraction(fixture, accountId, importId, 1),
        addInteraction(fixture, accountId, importId, 2),
        addInteraction(fixture, accountId, importId, 3)
      ];
      const plan = createPlan(fixture, accountId, ids);
      const owner = account(fixture);
      const created = new CreateRun(fixture.plans, fixture.catalog, fixture.runs, {
        now: () => fixedNow,
        idFactory: () => "run-resume"
      }).execute({ planId: plan.id, account: owner });
      const engine = new FakeCleanerEngine([
        { kind: "COMPLETED", outcome: "COMPLETED" },
        { kind: "COMPLETED", outcome: "COMPLETED" }
      ]);
      const execute = (batchId: string) =>
        new ExecuteBatch(
          {
            plans: fixture.plans,
            catalog: fixture.catalog,
            runs: fixture.runs,
            audit: fixture.audit,
            unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
            lock: new ExecutorLock(fixture.directory),
            engine
          },
          { clock: new FakeClock(fixedNow) }
        ).execute({ runId: created.run.id, batchId, account: owner });
      const first = await new ConfirmBatch(
        fixture.plans,
        fixture.catalog,
        fixture.runs,
        new FakePrompt(["APAGAR"]),
        { now: () => fixedNow, idFactory: () => "batch-one" }
      ).execute({ run: created.run, account: owner, requestedLimit: 1 });
      expect((await execute(first.batch!.id)).processedCount).toBe(1);
      expect(engine.calls).toHaveLength(1);
      expect(
        fixture.runs.listRunItems(created.run.id).filter((item) => item.status === "PENDING")
      ).toHaveLength(2);

      const resumedRun = fixture.runs.getRun(created.run.id)!;
      const second = await new ConfirmBatch(
        fixture.plans,
        fixture.catalog,
        fixture.runs,
        new FakePrompt(["APAGAR"]),
        { now: () => fixedNow, idFactory: () => "batch-two" }
      ).execute({ run: resumedRun, account: owner, requestedLimit: 1 });
      await execute(second.batch!.id);
      expect(engine.calls).toHaveLength(2);
      expect(engine.calls.map((call) => call.interaction.id)).toEqual([ids[0], ids[1]]);
      expect(
        fixture.database.connection.prepare("SELECT count(*) AS count FROM run_batches").get()
      ).toEqual({ count: 2 });
    } finally {
      await fixture.cleanup();
    }
  });

  it("não repete estados terminais e rejeita um segundo executor", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      confirmAccount(fixture);
      const ids = [
        addInteraction(fixture, accountId, importId, 1),
        addInteraction(fixture, accountId, importId, 2)
      ];
      const plan = createPlan(fixture, accountId, ids);
      const owner = account(fixture);
      const created = new CreateRun(fixture.plans, fixture.catalog, fixture.runs, {
        idFactory: () => "run-terminal"
      }).execute({
        planId: plan.id,
        account: owner
      });
      const items = fixture.runs.listRunItems(created.run.id);
      fixture.runs.updateRunItem(items[0]!.id, { status: "NOT_FOUND", completedAt: fixedNow });
      const confirmation = await new ConfirmBatch(
        fixture.plans,
        fixture.catalog,
        fixture.runs,
        new FakePrompt(["APAGAR"]),
        { idFactory: () => "batch-terminal" }
      ).execute({ run: created.run, account: owner });
      const engine = new FakeCleanerEngine([{ kind: "COMPLETED", outcome: "COMPLETED" }]);
      const lock = new ExecutorLock(fixture.directory);
      const held = await lock.acquire();
      try {
        await expect(
          new ExecuteBatch({
            plans: fixture.plans,
            catalog: fixture.catalog,
            runs: fixture.runs,
            audit: fixture.audit,
            unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
            lock,
            engine
          }).execute({ runId: created.run.id, batchId: confirmation.batch!.id, account: owner })
        ).rejects.toMatchObject({ code: "EXECUTOR_LOCK_HELD" });
      } finally {
        await held.release();
      }
      await new ExecuteBatch({
        plans: fixture.plans,
        catalog: fixture.catalog,
        runs: fixture.runs,
        audit: fixture.audit,
        unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
        lock,
        engine
      }).execute({ runId: created.run.id, batchId: confirmation.batch!.id, account: owner });
      expect(engine.calls.map((call) => call.interaction.id)).toEqual([ids[1]]);
    } finally {
      await fixture.cleanup();
    }
  });
});
