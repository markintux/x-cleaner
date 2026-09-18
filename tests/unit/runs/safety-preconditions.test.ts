import { describe, expect, it } from "vitest";

import type { PlanRepository } from "../../../src/application/ports/plan-repository.js";
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
import { FakePrompt } from "../../support/fake-prompt.js";

describe("precondições de segurança do Core", () => {
  it("recusa plano ausente e seleção não vazia ausente antes de qualquer engine", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      fixture.catalog.upsertManagedAccount({
        id: accountId,
        xUserId: fixture.catalog.getManagedAccount()!.xUserId,
        archiveHandle: "synthetic-1",
        confirmedHandle: "synthetic-1",
        confirmedAt: fixedNow
      });
      const creator = new CreateRun(fixture.plans, fixture.catalog, fixture.runs, {
        now: () => fixedNow,
        idFactory: () => "run-safety"
      });
      const account = {
        handle: "synthetic-1",
        xUserId: fixture.catalog.getManagedAccount()!.xUserId
      };
      expect(() => creator.execute({ planId: "missing", account })).toThrow(
        "REVIEWED_PLAN_REQUIRED"
      );

      const emptyPlans: PlanRepository = {
        createSnapshot: () => undefined,
        getSnapshot: () => ({
          plan: {
            id: "empty",
            accountId,
            catalogCutoffId: addInteraction(fixture, accountId, importId, 1),
            fromAt: null,
            toAt: null,
            selectedCount: 0,
            locale: "pt-BR",
            reviewedAt: fixedNow,
            createdAt: fixedNow
          },
          types: ["POST"],
          items: []
        }),
        getPlanTypes: () => []
      };
      expect(() =>
        new CreateRun(emptyPlans, fixture.catalog, fixture.runs).execute({
          planId: "empty",
          account
        })
      ).toThrow("PLAN_EMPTY");
    } finally {
      await fixture.cleanup();
    }
  });

  it("recusa conta não confirmada, conta divergente e confirmação textual incorreta", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const interactionId = addInteraction(fixture, accountId, importId, 1);
      const plan = createPlan(fixture, accountId, [interactionId]);
      const account = {
        handle: "synthetic-1",
        xUserId: fixture.catalog.getManagedAccount()!.xUserId
      };
      const creator = new CreateRun(fixture.plans, fixture.catalog, fixture.runs);
      expect(() => creator.execute({ planId: plan.id, account })).toThrow(
        "CONFIRMED_ACCOUNT_REQUIRED"
      );

      fixture.catalog.upsertManagedAccount({
        id: accountId,
        xUserId: account.xUserId,
        archiveHandle: "synthetic-1",
        confirmedHandle: "synthetic-1",
        confirmedAt: fixedNow
      });
      expect(() =>
        creator.execute({ planId: plan.id, account: { ...account, handle: "other-account" } })
      ).toThrow("ACCOUNT_MISMATCH");
      expect(() => creator.execute({ planId: plan.id })).toThrow("CURRENT_ACCOUNT_REQUIRED");

      const { run } = creator.execute({ planId: plan.id, account });
      const prompt = new FakePrompt(["apagar"]);
      const confirmation = await new ConfirmBatch(
        fixture.plans,
        fixture.catalog,
        fixture.runs,
        prompt,
        { now: () => fixedNow, idFactory: () => "batch-canceled" }
      ).execute({ run, account });
      expect(confirmation).toMatchObject({ confirmed: false, canceled: true, batch: null });
      expect(prompt.messages.join("\n")).toContain("irreversível");
      expect(
        fixture.database.connection.prepare("SELECT count(*) AS count FROM run_batches").get()
      ).toEqual({ count: 0 });
    } finally {
      await fixture.cleanup();
    }
  });

  it("não inicia a engine quando o lote não foi confirmado ou quando o lock está ocupado", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const interactionId = addInteraction(fixture, accountId, importId, 1);
      const plan = createPlan(fixture, accountId, [interactionId]);
      const account = {
        handle: "synthetic-1",
        xUserId: fixture.catalog.getManagedAccount()!.xUserId
      };
      fixture.catalog.upsertManagedAccount({
        id: accountId,
        xUserId: account.xUserId,
        archiveHandle: "synthetic-1",
        confirmedHandle: "synthetic-1",
        confirmedAt: fixedNow
      });
      const { run } = new CreateRun(fixture.plans, fixture.catalog, fixture.runs, {
        now: () => fixedNow,
        idFactory: () => "run-lock"
      }).execute({ planId: plan.id, account });
      const engine = new FakeCleanerEngine();
      const lock = new ExecutorLock(fixture.directory, { pid: () => 101, hostname: () => "test" });
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
          }).execute({ runId: run.id, batchId: "not-confirmed", account })
        ).rejects.toMatchObject({ code: "BATCH_NOT_FOUND" });
        expect(engine.calls).toHaveLength(0);
      } finally {
        await held.release();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("recusa um plano não revisado diretamente no executor", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const interactionId = addInteraction(fixture, accountId, importId, 1);
      fixture.catalog.upsertManagedAccount({
        id: accountId,
        xUserId: fixture.catalog.getManagedAccount()!.xUserId,
        archiveHandle: "synthetic-1",
        confirmedHandle: "synthetic-1",
        confirmedAt: fixedNow
      });
      const plan = createPlan(fixture, accountId, [interactionId]);
      const account = {
        handle: "synthetic-1",
        xUserId: fixture.catalog.getManagedAccount()!.xUserId
      };
      const { run } = new CreateRun(fixture.plans, fixture.catalog, fixture.runs).execute({
        planId: plan.id,
        account
      });
      const reviewedSnapshot = fixture.plans.getSnapshot(plan.id)!;
      const unreviewedPlans: PlanRepository = {
        createSnapshot: fixture.plans.createSnapshot.bind(fixture.plans),
        getSnapshot: (planId) =>
          planId === plan.id
            ? { ...reviewedSnapshot, plan: { ...reviewedSnapshot.plan, reviewedAt: "" } }
            : fixture.plans.getSnapshot(planId),
        getPlanTypes: fixture.plans.getPlanTypes.bind(fixture.plans)
      };
      fixture.runs.createBatch({
        id: "batch-unreviewed",
        runId: run.id,
        requestedLimit: null,
        confirmedAt: fixedNow,
        status: "RUNNING",
        startedAt: fixedNow,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      const engine = new FakeCleanerEngine();

      await expect(
        new ExecuteBatch({
          plans: unreviewedPlans,
          catalog: fixture.catalog,
          runs: fixture.runs,
          audit: fixture.audit,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
          lock: new ExecutorLock(fixture.directory),
          engine
        }).execute({ runId: run.id, batchId: "batch-unreviewed", account })
      ).rejects.toMatchObject({ code: "REVIEWED_PLAN_REQUIRED" });
      expect(engine.calls).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("recusa uma seleção vazia diretamente no executor", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const interactionId = addInteraction(fixture, accountId, importId, 1);
      fixture.catalog.upsertManagedAccount({
        id: accountId,
        xUserId: fixture.catalog.getManagedAccount()!.xUserId,
        archiveHandle: "synthetic-1",
        confirmedHandle: "synthetic-1",
        confirmedAt: fixedNow
      });
      const plan = createPlan(fixture, accountId, [interactionId]);
      const account = {
        handle: "synthetic-1",
        xUserId: fixture.catalog.getManagedAccount()!.xUserId
      };
      const { run } = new CreateRun(fixture.plans, fixture.catalog, fixture.runs).execute({
        planId: plan.id,
        account
      });
      const reviewedSnapshot = fixture.plans.getSnapshot(plan.id)!;
      const emptyPlans: PlanRepository = {
        createSnapshot: fixture.plans.createSnapshot.bind(fixture.plans),
        getSnapshot: (planId) =>
          planId === plan.id
            ? {
                ...reviewedSnapshot,
                plan: { ...reviewedSnapshot.plan, selectedCount: 0 },
                items: []
              }
            : fixture.plans.getSnapshot(planId),
        getPlanTypes: fixture.plans.getPlanTypes.bind(fixture.plans)
      };
      fixture.runs.createBatch({
        id: "batch-empty-plan",
        runId: run.id,
        requestedLimit: null,
        confirmedAt: fixedNow,
        status: "RUNNING",
        startedAt: fixedNow,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      const engine = new FakeCleanerEngine();

      await expect(
        new ExecuteBatch({
          plans: emptyPlans,
          catalog: fixture.catalog,
          runs: fixture.runs,
          audit: fixture.audit,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
          lock: new ExecutorLock(fixture.directory),
          engine
        }).execute({ runId: run.id, batchId: "batch-empty-plan", account })
      ).rejects.toMatchObject({ code: "PLAN_EMPTY" });
      expect(engine.calls).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("recusa diretamente uma conta sem confirmação persistida", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const interactionId = addInteraction(fixture, accountId, importId, 1);
      fixture.catalog.upsertManagedAccount({
        id: accountId,
        xUserId: fixture.catalog.getManagedAccount()!.xUserId,
        archiveHandle: "synthetic-1",
        confirmedHandle: "synthetic-1",
        confirmedAt: fixedNow
      });
      const plan = createPlan(fixture, accountId, [interactionId]);
      const account = {
        handle: "synthetic-1",
        xUserId: fixture.catalog.getManagedAccount()!.xUserId
      };
      const { run } = new CreateRun(fixture.plans, fixture.catalog, fixture.runs).execute({
        planId: plan.id,
        account
      });
      fixture.catalog.upsertManagedAccount({
        id: accountId,
        xUserId: account.xUserId,
        archiveHandle: "synthetic-1",
        confirmedHandle: null,
        confirmedAt: null
      });
      fixture.runs.createBatch({
        id: "batch-unconfirmed-account",
        runId: run.id,
        requestedLimit: null,
        confirmedAt: fixedNow,
        status: "RUNNING",
        startedAt: fixedNow,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      const engine = new FakeCleanerEngine();

      await expect(
        new ExecuteBatch({
          plans: fixture.plans,
          catalog: fixture.catalog,
          runs: fixture.runs,
          audit: fixture.audit,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
          lock: new ExecutorLock(fixture.directory),
          engine
        }).execute({ runId: run.id, batchId: "batch-unconfirmed-account", account })
      ).rejects.toMatchObject({ code: "CONFIRMED_ACCOUNT_REQUIRED" });
      expect(engine.calls).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("recusa diretamente uma conta divergente da conta vinculada", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const interactionId = addInteraction(fixture, accountId, importId, 1);
      fixture.catalog.upsertManagedAccount({
        id: accountId,
        xUserId: fixture.catalog.getManagedAccount()!.xUserId,
        archiveHandle: "synthetic-1",
        confirmedHandle: "synthetic-1",
        confirmedAt: fixedNow
      });
      const plan = createPlan(fixture, accountId, [interactionId]);
      const account = {
        handle: "synthetic-1",
        xUserId: fixture.catalog.getManagedAccount()!.xUserId
      };
      const { run } = new CreateRun(fixture.plans, fixture.catalog, fixture.runs).execute({
        planId: plan.id,
        account
      });
      fixture.runs.createBatch({
        id: "batch-divergent-account",
        runId: run.id,
        requestedLimit: null,
        confirmedAt: fixedNow,
        status: "RUNNING",
        startedAt: fixedNow,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      const engine = new FakeCleanerEngine();

      await expect(
        new ExecuteBatch({
          plans: fixture.plans,
          catalog: fixture.catalog,
          runs: fixture.runs,
          audit: fixture.audit,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
          lock: new ExecutorLock(fixture.directory),
          engine
        }).execute({
          runId: run.id,
          batchId: "batch-divergent-account",
          account: { handle: "other-account", xUserId: account.xUserId }
        })
      ).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" });
      expect(engine.calls).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("recusa confirmação ausente antes de adquirir o lock ou chamar a engine", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const interactionId = addInteraction(fixture, accountId, importId, 1);
      fixture.catalog.upsertManagedAccount({
        id: accountId,
        xUserId: fixture.catalog.getManagedAccount()!.xUserId,
        archiveHandle: "synthetic-1",
        confirmedHandle: "synthetic-1",
        confirmedAt: fixedNow
      });
      const plan = createPlan(fixture, accountId, [interactionId]);
      const account = {
        handle: "synthetic-1",
        xUserId: fixture.catalog.getManagedAccount()!.xUserId
      };
      const { run } = new CreateRun(fixture.plans, fixture.catalog, fixture.runs).execute({
        planId: plan.id,
        account
      });
      fixture.runs.createBatch({
        id: "batch-without-confirmation",
        runId: run.id,
        requestedLimit: null,
        confirmedAt: "",
        status: "RUNNING",
        startedAt: fixedNow,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      const engine = new FakeCleanerEngine();

      await expect(
        new ExecuteBatch({
          plans: fixture.plans,
          catalog: fixture.catalog,
          runs: fixture.runs,
          audit: fixture.audit,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
          lock: new ExecutorLock(fixture.directory),
          engine
        }).execute({ runId: run.id, batchId: "batch-without-confirmation", account })
      ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
      expect(engine.calls).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("recusa iniciar sem a porta de lock mesmo com lote confirmado", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const interactionId = addInteraction(fixture, accountId, importId, 1);
      fixture.catalog.upsertManagedAccount({
        id: accountId,
        xUserId: fixture.catalog.getManagedAccount()!.xUserId,
        archiveHandle: "synthetic-1",
        confirmedHandle: "synthetic-1",
        confirmedAt: fixedNow
      });
      const plan = createPlan(fixture, accountId, [interactionId]);
      const account = {
        handle: "synthetic-1",
        xUserId: fixture.catalog.getManagedAccount()!.xUserId
      };
      const { run } = new CreateRun(fixture.plans, fixture.catalog, fixture.runs).execute({
        planId: plan.id,
        account
      });
      const confirmed = await new ConfirmBatch(
        fixture.plans,
        fixture.catalog,
        fixture.runs,
        new FakePrompt(["APAGAR"]),
        { now: () => fixedNow, idFactory: () => "batch-without-lock" }
      ).execute({ run, account });
      const engine = new FakeCleanerEngine();

      await expect(
        new ExecuteBatch({
          plans: fixture.plans,
          catalog: fixture.catalog,
          runs: fixture.runs,
          audit: fixture.audit,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
          engine
        }).execute({ runId: run.id, batchId: confirmed.batch!.id, account })
      ).rejects.toMatchObject({ code: "EXECUTOR_LOCK_REQUIRED" });
      expect(engine.calls).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
