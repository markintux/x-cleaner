import { describe, expect, it, vi } from "vitest";

import { ArchiveVerification } from "../../../src/application/runs/archive-verification.js";
import { ConfirmBatch } from "../../../src/application/runs/confirm-batch.js";
import { ExecuteBatch } from "../../../src/application/runs/execute-batch.js";
import { createResumeCommand } from "../../../src/cli/commands/run.js";
import { createProgram } from "../../../src/cli/create-program.js";
import { groupRunsByType } from "../../../src/cli/run-groups.js";
import { createTranslator } from "../../../src/i18n/translator.js";
import { ExecutorLock } from "../../../src/infrastructure/lock/executor-lock.js";
import { UnitOfWork } from "../../../src/infrastructure/database/unit-of-work.js";
import { FakePrompt } from "../../support/fake-prompt.js";
import { FakeCleanerEngine } from "../../support/fake-cleaner-engine.js";
import {
  addInteraction,
  createDatabaseFixture,
  createPlan,
  fixedNow,
  seedCatalog
} from "../../support/database.js";

async function verificationFixture() {
  const fixture = await createDatabaseFixture();
  const { accountId, importId } = seedCatalog(fixture);
  const account = fixture.catalog.getManagedAccount()!;
  fixture.catalog.upsertManagedAccount({
    ...account,
    confirmedHandle: "synthetic-1",
    confirmedAt: fixedNow
  });
  const ids = [1, 2].map((n) => addInteraction(fixture, accountId, importId, n, "REPOST"));
  const plan = createPlan(fixture, accountId, ids, ["REPOST"]);
  const later = "2026-03-04T05:07:07.000Z";
  fixture.plans.createSnapshot({
    plan: { ...plan, id: "verification-plan", createdAt: later },
    types: ["REPOST"],
    items: ids.map((interactionId, n) => ({
      planId: "verification-plan",
      interactionId,
      sequence: n + 1,
      createdAt: later
    }))
  });
  for (const [id, planId, createdAt] of [
    ["original", plan.id, fixedNow],
    ["verification", "verification-plan", later]
  ] as const) {
    fixture.runs.createRun({
      id,
      planId,
      accountId,
      boundHandle: "synthetic-1",
      status: "PAUSED",
      pauseReason: null,
      startedAt: createdAt,
      pausedAt: createdAt,
      finishedAt: null,
      createdAt,
      updatedAt: createdAt
    });
  }
  for (const item of fixture.runs.listRunItems("original"))
    fixture.runs.updateRunItem(item.id, { status: "COMPLETED", completedAt: fixedNow });
  fixture.runs.updateRunStatus("original", "COMPLETED", {
    pauseReason: null,
    startedAt: fixedNow,
    pausedAt: null,
    finishedAt: fixedNow
  });
  fixture.runs.createBatch({
    id: "previous-batch",
    runId: "verification",
    requestedLimit: 1,
    confirmedAt: later,
    status: "COMPLETED",
    startedAt: later,
    finishedAt: later,
    createdAt: later,
    updatedAt: later
  });
  const checked = fixture.runs.listRunItems("verification")[0]!;
  fixture.runs.updateRunItem(checked.id, { status: "NOT_FOUND", attemptCount: 1 });
  fixture.audit.appendAttempt({
    runItemId: checked.id,
    batchId: "previous-batch",
    attemptNumber: 1,
    outcome: "NOT_FOUND",
    retryable: false,
    durationMs: 1,
    errorCode: null,
    errorContextJson: null,
    startedAt: later,
    finishedAt: later,
    createdAt: later
  });
  fixture.audit.appendCheckpoint({
    runId: "verification",
    sequence: 1,
    reason: "ITEM_COMMITTED",
    lastRunItemSequence: 1,
    aggregateCountsJson: JSON.stringify({ NOT_FOUND: 1, PENDING: 1 }),
    createdAt: later
  });
  return { ...fixture, lock: new ExecutorLock(fixture.directory), checkedId: checked.id };
}

function service(fixture: Awaited<ReturnType<typeof verificationFixture>>) {
  return new ArchiveVerification(fixture, () => fixedNow);
}

function cli(
  fixture: Awaited<ReturnType<typeof verificationFixture>>,
  prompt: FakePrompt,
  output: string[],
  engine = new FakeCleanerEngine()
) {
  return {
    translator: createTranslator(),
    prompt,
    output: { writeLine: (line: string) => output.push(line) },
    repositoryFactory: () => ({
      ...fixture,
      unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
      close: () => undefined
    }),
    run: { prompt, engine, currentAccount: { handle: "synthetic-1", xUserId: null } }
  };
}

describe("painel por tipo e conferências opcionais", () => {
  it("mostra um REPOST, permite consultar ambas as execuções e encerrar sem alterar os resultados", async () => {
    const fixture = await verificationFixture();
    try {
      const items = fixture.runs.listRunItems("verification");
      const original = fixture.runs.listRunItems("original");
      const attempts = fixture.audit.listAttempts(fixture.checkedId);
      const checkpoints = fixture.audit.listCheckpoints("verification");
      const output: string[] = [];
      const engine = new FakeCleanerEngine();
      const prompt = new FakePrompt(["h", "", "1", "h", "", "c", "ENCERRAR", "h", "", "0"]);
      await createProgram(cli(fixture, prompt, output, engine)).parseAsync(
        ["menu", "--data-dir", fixture.directory],
        { from: "user" }
      );
      const firstHistory = output.findIndex((line) => line.includes("X CLEANER  ·  HISTÓRICO"));
      expect(
        output.slice(0, firstHistory).filter((line) => /^│\s+1\s+│ REPOST/u.test(line))
      ).toHaveLength(1);
      expect(output.join("\n")).toContain("Conferência de remoções anteriores");
      expect(output.join("\n")).toContain("podem já ter sido removidos");
      expect(output.join("\n")).toContain("Confer. encerrada");
      const groups = groupRunsByType(fixture.runs.listRunOverviews());
      expect(groups).toHaveLength(1);
      expect(groups[0]?.current.runId).toBe("original");
      expect(groups[0]?.counts.pending).toBe(0);
      expect(fixture.runs.isRunArchived("verification")).toBe(true);
      expect(fixture.runs.listRunItems("verification")).toEqual(items);
      expect(fixture.runs.listRunItems("original")).toEqual(original);
      expect(fixture.audit.listAttempts(fixture.checkedId)).toEqual(attempts);
      expect(fixture.audit.listCheckpoints("verification")).toEqual(checkpoints);
      expect(engine.calls).toHaveLength(0);
      expect(fixture.runs.listBatches("verification")).toHaveLength(1);
      expect(fixture.runs.listRunOverviews()[1]).toMatchObject({
        archivedAt: expect.any(String),
        pending: 1,
        completed: 0
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it.each(["", "APAGAR", "encerrar"])(
    "cancelar com %j mantém a conferência no painel",
    async (answer) => {
      const fixture = await verificationFixture();
      try {
        const prompt = new FakePrompt(["1", "c", answer, "0"]);
        await createProgram(cli(fixture, prompt, [])).parseAsync(
          ["menu", "--data-dir", fixture.directory],
          { from: "user" }
        );
        expect(fixture.runs.isRunArchived("verification")).toBe(false);
        expect(groupRunsByType(fixture.runs.listRunOverviews())[0]?.current.runId).toBe(
          "verification"
        );
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it("não soma os contadores das execuções sobrepostas", async () => {
    const fixture = await verificationFixture();
    try {
      const groups = groupRunsByType(fixture.runs.listRunOverviews());
      expect(groups[0]?.counts).toMatchObject({ total: 2, processed: 1, pending: 1, completed: 0 });
      expect(groups[0]?.current.repeatedItems).toBe(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("divide planos com vários tipos em linhas com contadores próprios", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const post = addInteraction(fixture, accountId, importId, 1, "POST");
      const like = addInteraction(fixture, accountId, importId, 2, "LIKE");
      const plan = createPlan(fixture, accountId, [post, like], ["POST", "LIKE"]);
      fixture.runs.createRun({
        id: "mixed",
        planId: plan.id,
        accountId,
        boundHandle: "synthetic-1",
        status: "PAUSED",
        pauseReason: null,
        startedAt: fixedNow,
        pausedAt: fixedNow,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      fixture.runs.updateRunItem(fixture.runs.listRunItems("mixed")[0]!.id, {
        status: "COMPLETED"
      });
      const groups = groupRunsByType(fixture.runs.listRunOverviews());
      expect(groups.map((group) => [group.type, group.counts.total, group.counts.pending])).toEqual(
        [
          ["POST", 1, 0],
          ["LIKE", 1, 1]
        ]
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("mantém acesso a uma execução anterior aberta pelo histórico do tipo", async () => {
    const fixture = await verificationFixture();
    try {
      const item = fixture.runs.listRunItems("original")[0]!;
      fixture.runs.updateRunItem(item.id, { status: "PENDING", completedAt: null });
      fixture.runs.updateRunStatus("original", "PAUSED", {
        pauseReason: null,
        startedAt: fixedNow,
        pausedAt: fixedNow,
        finishedAt: null
      });
      const engine = new FakeCleanerEngine();
      const prompt = new FakePrompt(["1", "h", "1", "r", "1", "APAGAR", "0"]);
      await createProgram(cli(fixture, prompt, [], engine)).parseAsync(
        ["menu", "--data-dir", fixture.directory],
        { from: "user" }
      );
      expect(engine.calls.map((call) => call.interaction.id)).toEqual([item.interactionId]);
      expect(fixture.runs.listBatches("original")).toHaveLength(1);
      expect(fixture.runs.listBatches("verification")).toHaveLength(1);
      expect(fixture.runs.listRunItems("verification")[1]?.status).toBe("PENDING");
    } finally {
      await fixture.cleanup();
    }
  });

  it("recusa encerrar a limpeza original", async () => {
    const fixture = await verificationFixture();
    try {
      expect(() => service(fixture).review("original")).toThrow("VERIFICATION_NOT_ARCHIVABLE");
    } finally {
      await fixture.cleanup();
    }
  });

  it("recusa encerrar enquanto outro executor detém o lock", async () => {
    const fixture = await verificationFixture();
    const lease = await fixture.lock.acquire();
    try {
      await expect(
        service(fixture).execute(service(fixture).review("verification"), "ENCERRAR")
      ).rejects.toThrow("EXECUTOR_LOCK_HELD");
      expect(fixture.runs.isRunArchived("verification")).toBe(false);
    } finally {
      await lease.release();
      await fixture.cleanup();
    }
  });

  it("recusa encerrar quando ainda há um lote em andamento", async () => {
    const fixture = await verificationFixture();
    try {
      fixture.runs.updateBatchStatus("previous-batch", "RUNNING", null);
      expect(() => service(fixture).review("verification")).toThrow("RUN_STILL_ACTIVE");
      expect(fixture.runs.isRunArchived("verification")).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it("recusa uma revisão desatualizada", async () => {
    const fixture = await verificationFixture();
    try {
      const review = service(fixture).review("verification");
      fixture.runs.updateRunItem(fixture.runs.listRunItems("verification")[1]!.id, {
        status: "NOT_FOUND"
      });
      await expect(service(fixture).execute(review, "ENCERRAR")).rejects.toThrow(
        "VERIFICATION_NOT_ARCHIVABLE"
      );
      expect(fixture.runs.isRunArchived("verification")).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it("recusa itens em processamento e conta divergente", async () => {
    const fixture = await verificationFixture();
    try {
      const pending = fixture.runs.listRunItems("verification")[1]!;
      fixture.runs.updateRunItem(pending.id, { status: "PROCESSING" });
      expect(() => service(fixture).review("verification")).toThrow("VERIFICATION_NOT_ARCHIVABLE");
      fixture.runs.updateRunItem(pending.id, { status: "PENDING" });
      const account = fixture.catalog.getManagedAccount()!;
      fixture.catalog.upsertManagedAccount({ ...account, confirmedHandle: "other-synthetic" });
      expect(() => service(fixture).review("verification")).toThrow("ACCOUNT_MISMATCH");
    } finally {
      await fixture.cleanup();
    }
  });

  it("resume e confirmação recusam a conferência encerrada antes de login ou engine", async () => {
    const fixture = await verificationFixture();
    try {
      await service(fixture).execute(service(fixture).review("verification"), "ENCERRAR");
      const account = vi.fn();
      const engine = new FakeCleanerEngine();
      const prompt = new FakePrompt(["APAGAR"]);
      const dependencies = {
        ...cli(fixture, prompt, [], engine),
        run: { engine, getCurrentAccount: account }
      };
      await expect(
        createResumeCommand(dependencies)("verification", { dataDir: fixture.directory, limit: 1 })
      ).rejects.toThrow("RUN_NOT_RESUMABLE");
      await expect(
        new ConfirmBatch(fixture.plans, fixture.catalog, fixture.runs, prompt).execute({
          runId: "verification"
        })
      ).rejects.toThrow("RUN_NOT_RESUMABLE");
      expect(account).not.toHaveBeenCalled();
      expect(prompt.questions).toHaveLength(0);
      expect(engine.calls).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("executor revalida arquivamento sob o lock antes de qualquer ação", async () => {
    const fixture = await verificationFixture();
    try {
      await service(fixture).execute(service(fixture).review("verification"), "ENCERRAR");
      fixture.runs.createBatch({
        id: "racing-batch",
        runId: "verification",
        requestedLimit: 1,
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
          ...fixture,
          engine,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit)
        }).execute({
          runId: "verification",
          batchId: "racing-batch",
          account: { handle: "synthetic-1", xUserId: null }
        })
      ).rejects.toThrow("RUN_NOT_RESUMABLE");
      expect(engine.calls).toHaveLength(0);
      expect(fixture.runs.listRunItems("verification")[1]?.status).toBe("PENDING");
      expect(await fixture.lock.diagnoseStaleLock()).toBe("NOT_HELD");
    } finally {
      await fixture.cleanup();
    }
  });
});
