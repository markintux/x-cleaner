import { describe, expect, it } from "vitest";

import { createProgram } from "../../../src/cli/create-program.js";
import { createTranslator } from "../../../src/i18n/translator.js";
import { UnitOfWork } from "../../../src/infrastructure/database/unit-of-work.js";
import { ExecutorLock } from "../../../src/infrastructure/lock/executor-lock.js";
import { FakeCleanerEngine } from "../../support/fake-cleaner-engine.js";
import type { CleanerEngineOutcome } from "../../../src/application/ports/cleaner-engine.js";
import { FakePrompt } from "../../support/fake-prompt.js";
import {
  addInteraction,
  createDatabaseFixture,
  createPlan,
  fixedNow,
  seedCatalog
} from "../../support/database.js";

describe("menu interativo", () => {
  it.each(["POST", "REPLY", "REPOST", "LIKE"] as const)(
    "deixa um %s problemático de fora e exige nova autorização para o próximo lote",
    async (type) => {
      const fixture = await createDatabaseFixture();
      try {
        const { accountId, importId } = seedCatalog(fixture);
        confirmAccount(fixture);
        const ids = [1, 2, 3].map((sequence) =>
          addInteraction(fixture, accountId, importId, sequence, type)
        );
        const plan = createPlan(fixture, accountId, ids, [type]);
        fixture.runs.createRun(run("run-skip", plan.id, accountId, fixedNow));
        const engine = new FakeCleanerEngine([
          { kind: "COMPLETED", outcome: "COMPLETED" },
          {
            kind: "UNKNOWN_UI",
            outcome: "PAUSED",
            pauseReason: "UNKNOWN_UI",
            errorCode: "TARGET_EVIDENCE_MISSING"
          }
        ]);
        const prompt = new FakePrompt([
          "1",
          "2",
          "APAGAR",
          "",
          "1",
          "p",
          "PULAR",
          "1",
          "1",
          "APAGAR",
          "0"
        ]);
        const output: string[] = [];
        const program = createProgram({
          output: { writeLine: (line) => output.push(line) },
          translator: createTranslator(),
          prompt,
          repositoryFactory: () => ({
            ...fixture,
            unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
            lock: new ExecutorLock(fixture.directory),
            close: () => undefined
          }),
          run: { prompt, engine, currentAccount: { handle: "synthetic-1", xUserId: null } }
        });
        await program.parseAsync(["menu", "--data-dir", fixture.directory], { from: "user" });
        expect(engine.calls.map((call) => call.interaction.id)).toEqual(ids);
        expect(fixture.runs.listRunItems("run-skip").map((item) => item.status)).toEqual([
          "COMPLETED",
          "SKIPPED",
          "COMPLETED"
        ]);
        const skipped = fixture.runs.listRunItems("run-skip")[1]!;
        expect(skipped.lastErrorCode).toBe("TARGET_EVIDENCE_MISSING");
        expect(skipped.completedAt).toBeNull();
        expect(fixture.audit.listAttempts(skipped.id)).toHaveLength(1);
        expect(fixture.audit.listAttempts(skipped.id)[0]?.outcome).toBe("PAUSED");
        expect(fixture.runs.listBatches("run-skip").map((batch) => batch.requestedLimit)).toEqual([
          2, 1
        ]);
        expect(fixture.runs.listRunOverviews()[0]).toMatchObject({
          completed: 2,
          skipped: 1,
          pending: 0
        });
        expect(output.join("\n")).toContain("Pulados");
        expect(output.join("\n")).toContain("ITEM QUE SERÁ DEIXADO DE FORA");
        expect(output.join("\n")).toContain("900719925474099302");
        expect(output.join("\n")).toContain("Nenhuma alteração foi feita no X");
        expect(
          prompt.questions.filter((question) => question.includes("Confirmação:"))
        ).toHaveLength(2);
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it.each(["", "APAGAR", "pular"])(
    "cancela deixar item de fora com resposta %j",
    async (answer) => {
      const fixture = await createDatabaseFixture();
      try {
        const { accountId, importId } = seedCatalog(fixture);
        confirmAccount(fixture);
        const plan = createPlan(fixture, accountId, [
          addInteraction(fixture, accountId, importId, 1)
        ]);
        fixture.runs.createRun(run("run-cancel-skip", plan.id, accountId, fixedNow));
        const engine = new FakeCleanerEngine([
          {
            kind: "UNKNOWN_UI",
            outcome: "PAUSED",
            pauseReason: "UNKNOWN_UI",
            errorCode: "REPOST_CANONICAL_TARGET_MISSING"
          }
        ]);
        const prompt = new FakePrompt(["1", "1", "APAGAR", "", "1", "p", answer, "0"]);
        const output: string[] = [];
        const program = createProgram({
          output: { writeLine: (line) => output.push(line) },
          translator: createTranslator(),
          prompt,
          repositoryFactory: () => ({
            ...fixture,
            unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
            lock: new ExecutorLock(fixture.directory),
            close: () => undefined
          }),
          run: { prompt, engine, currentAccount: { handle: "synthetic-1", xUserId: null } }
        });
        await program.parseAsync(["menu", "--data-dir", fixture.directory], { from: "user" });
        expect(engine.calls).toHaveLength(1);
        expect(fixture.runs.getRun("run-cancel-skip")?.pauseReason).toBe("UNKNOWN_UI");
        expect(fixture.runs.listRunItems("run-cancel-skip")[0]?.status).toBe("PENDING");
        expect(output.join("\n")).toContain("Operação cancelada");
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it.each([
    ["COMPLETED", "APAGAR"],
    ["NOT_FOUND", "APAGAR"],
    ["UNKNOWN_UI", "APAGAR"],
    ["COMPLETED", "cancelar"]
  ] as const)(
    "recupera pausa com %s e confirmação %s sem repetir concluídos",
    async (outcome, answer) => {
      const fixture = await createDatabaseFixture();
      try {
        const { accountId, importId } = seedCatalog(fixture);
        confirmAccount(fixture);
        const ids = [1, 2, 3].map((sequence) =>
          addInteraction(fixture, accountId, importId, sequence)
        );
        const plan = createPlan(fixture, accountId, ids);
        fixture.runs.createRun(run("run-recovery", plan.id, accountId, fixedNow));
        const unknown: CleanerEngineOutcome = {
          kind: "UNKNOWN_UI",
          outcome: "PAUSED",
          pauseReason: "UNKNOWN_UI",
          errorCode: "UNDO_REPOST_NOT_CONFIRMED"
        };
        const recovery: CleanerEngineOutcome =
          outcome === "UNKNOWN_UI"
            ? unknown
            : outcome === "NOT_FOUND"
              ? { kind: "TERMINAL_NON_ERROR", outcome: "NOT_FOUND" }
              : { kind: "COMPLETED", outcome: "COMPLETED" };
        const engine = new FakeCleanerEngine([
          { kind: "COMPLETED", outcome: "COMPLETED" },
          unknown,
          recovery
        ]);
        const prompt = new FakePrompt(["1", "2", "APAGAR", "", "1", "t", answer, "", "0"]);
        const output: string[] = [];
        const program = createProgram({
          output: { writeLine: (line) => output.push(line) },
          translator: createTranslator(),
          prompt,
          repositoryFactory: () => ({
            ...fixture,
            unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
            lock: new ExecutorLock(fixture.directory),
            close: () => undefined
          }),
          run: { prompt, currentAccount: { handle: "synthetic-1", xUserId: null }, engine }
        });
        await program.parseAsync(["menu", "--data-dir", fixture.directory], { from: "user" });
        expect(output.join("\n")).toContain(
          "Último erro do item pendente: UNDO_REPOST_NOT_CONFIRMED"
        );
        expect(prompt.questions[5]).toContain("[T]");
        expect(prompt.questions[6]).toContain("Confirmação:");
        expect(engine.calls.map((call) => call.interaction.id)).toEqual(
          answer === "APAGAR" ? [ids[0], ids[1], ids[1]] : [ids[0], ids[1]]
        );
        const batches = fixture.runs.listBatches("run-recovery");
        expect(batches.map((batch) => batch.requestedLimit)).toEqual(
          answer === "APAGAR" ? [2, 1] : [2]
        );
        const items = fixture.runs.listRunItems("run-recovery");
        expect(items[0]?.status).toBe("COMPLETED");
        expect(items[2]?.status).toBe("PENDING");
        expect(
          fixture.audit.listAttempts(items[1]!.id).map((attempt) => attempt.errorCode)[0]
        ).toBe("UNDO_REPOST_NOT_CONFIRMED");
        expect(fixture.audit.listAttempts(items[1]!.id)).toHaveLength(answer === "APAGAR" ? 2 : 1);
        expect(fixture.runs.getRun("run-recovery")?.pauseReason).toBe(
          answer !== "APAGAR" || outcome === "UNKNOWN_UI" ? "UNKNOWN_UI" : null
        );
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it.each(["UNKNOWN_UI", "SESSION_EXPIRED", "SECURITY_CHALLENGE", "RATE_LIMIT"] as const)(
    "permite voltar de %s sem limpar a pausa nem abrir lote",
    async (reason) => {
      const fixture = await createDatabaseFixture();
      try {
        const { accountId, importId } = seedCatalog(fixture);
        confirmAccount(fixture);
        const plan = createPlan(fixture, accountId, [
          addInteraction(fixture, accountId, importId, 1)
        ]);
        fixture.runs.createRun({
          ...run("run-paused", plan.id, accountId, fixedNow),
          pauseReason: reason
        });
        const prompt = new FakePrompt(["1", "", "0"]);
        const engine = new FakeCleanerEngine();
        const output: string[] = [];
        const program = createProgram({
          output: { writeLine: (line) => output.push(line) },
          translator: createTranslator(),
          prompt,
          repositoryFactory: () => ({ ...fixture, close: () => undefined }),
          run: { prompt, engine }
        });
        await program.parseAsync(["menu", "--data-dir", fixture.directory], { from: "user" });
        expect(output.join("\n")).toContain(reason);
        expect(engine.calls).toHaveLength(0);
        expect(fixture.runs.listBatches("run-paused")).toHaveLength(0);
        expect(fixture.runs.getRun("run-paused")?.pauseReason).toBe(reason);
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it("revisa um limite e preserva APAGAR como confirmação separada", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      confirmAccount(fixture);
      const ids = [
        addInteraction(fixture, accountId, importId, 1),
        addInteraction(fixture, accountId, importId, 2)
      ];
      const plan = createPlan(fixture, accountId, ids);
      fixture.runs.createRun(run("run-post", plan.id, accountId, fixedNow));
      const prompt = new FakePrompt(["1", "2", "cancelar", "", "0"]);
      const engine = new FakeCleanerEngine();
      const output: string[] = [];
      const program = createProgram({
        output: { writeLine: (line) => output.push(line) },
        translator: createTranslator(),
        prompt,
        repositoryFactory: () => ({
          ...fixture,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
          lock: new ExecutorLock(fixture.directory),
          close: () => undefined
        }),
        run: {
          prompt,
          currentAccount: { handle: "synthetic-1", xUserId: null },
          engine
        }
      });
      await program.parseAsync(["menu", "--data-dir", fixture.directory], { from: "user" });

      const tableLines = output.filter((line) => line.includes("Tipo") || line.includes("POST"));
      expect(tableLines[0]).toContain("Restam");
      expect(tableLines[0]).toContain("Progresso");
      expect(tableLines[1]).toContain("POST");
      expect(tableLines[1]).toContain("░░░░░░░░");
      expect(tableLines[1]?.length).toBe(tableLines[0]?.length);
      expect(output.some((line) => line.includes("@synthetic-1") && line.startsWith("│"))).toBe(
        true
      );
      expect(prompt.messages.join("\n")).toContain("Total: 2");
      const reviewLines = prompt.messages.join("\n").split("\n");
      const itemHeader = reviewLines.find((line) => line.includes("Data (UTC)"));
      const firstItem = reviewLines.find((line) => line.includes("900719925474099301"));
      expect(reviewLines.join("\n")).toContain("REVISÃO DO LOTE");
      expect(reviewLines.join("\n")).toContain("Qualquer outra resposta cancela este lote");
      expect(firstItem?.length).toBe(itemHeader?.length);
      expect(prompt.questions).toHaveLength(5);
      expect(prompt.questions[2]).toContain("Confirmação:");
      expect(prompt.questions[3]).toContain("Voltar ao painel");
      expect(output.filter((line) => line.includes("X CLEANER  ·  PAINEL"))).toHaveLength(2);
      expect(engine.calls).toHaveLength(0);
      expect(fixture.runs.getRun("run-post")?.status).toBe("PAUSED");
    } finally {
      await fixture.cleanup();
    }
  });

  it("permite voltar sem executar quando o plano tem itens em outro run", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      confirmAccount(fixture);
      const interaction = addInteraction(fixture, accountId, importId, 1);
      const first = createPlan(fixture, accountId, [interaction]);
      fixture.runs.createRun(run("run-first", first.id, accountId, fixedNow));
      fixture.plans.createSnapshot({
        plan: {
          ...first,
          id: "plan-overlap",
          createdAt: "2026-03-04T05:07:07.000Z"
        },
        types: ["POST"],
        items: [
          {
            planId: "plan-overlap",
            interactionId: interaction,
            sequence: 1,
            createdAt: "2026-03-04T05:07:07.000Z"
          }
        ]
      });
      fixture.runs.createRun(
        run("run-overlap", "plan-overlap", accountId, "2026-03-04T05:07:07.000Z")
      );
      expect(fixture.runs.listRunOverviews()[1]?.overlappingPending).toBe(1);

      const prompt = new FakePrompt(["1", "", "0"]);
      const output: string[] = [];
      const program = createProgram({
        output: { writeLine: (line) => output.push(line) },
        translator: createTranslator(),
        prompt,
        repositoryFactory: () => ({
          ...fixture,
          lock: new ExecutorLock(fixture.directory),
          close: () => undefined
        })
      });
      await program.parseAsync(["menu", "--data-dir", fixture.directory], { from: "user" });

      expect(output.join("\n")).toContain("também estão em outra execução");
      expect(prompt.questions).toHaveLength(3);
      expect(fixture.runs.listBatches("run-overlap")).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it.each(["POST", "REPLY", "REPOST", "LIKE"] as const)(
    "revisa %s sobreposto a uma execução concluída, sem repetir itens concluídos no run escolhido",
    async (type) => {
      const fixture = await createDatabaseFixture();
      try {
        const { accountId, importId } = seedCatalog(fixture);
        confirmAccount(fixture);
        const ids = [1, 2].map((sequence) =>
          addInteraction(fixture, accountId, importId, sequence, type)
        );
        const first = createPlan(fixture, accountId, ids, [type]);
        fixture.runs.createRun(run("run-first", first.id, accountId, fixedNow));
        for (const item of fixture.runs.listRunItems("run-first")) {
          fixture.runs.updateRunItem(item.id, { status: "COMPLETED", completedAt: fixedNow });
        }
        fixture.runs.updateRunStatus("run-first", "COMPLETED", {
          pauseReason: null,
          startedAt: fixedNow,
          pausedAt: null,
          finishedAt: fixedNow
        });
        const later = "2026-03-04T05:07:07.000Z";
        fixture.plans.createSnapshot({
          plan: { ...first, id: "plan-overlap", createdAt: later },
          types: [type],
          items: ids.map((interactionId, index) => ({
            planId: "plan-overlap",
            interactionId,
            sequence: index + 1,
            createdAt: later
          }))
        });
        fixture.runs.createRun(run("run-overlap", "plan-overlap", accountId, later));
        const alreadyDone = fixture.runs.listRunItems("run-overlap")[0]!;
        fixture.runs.updateRunItem(alreadyDone.id, { status: "COMPLETED", completedAt: fixedNow });
        const originalCompleted = fixture.runs.getRunItem(alreadyDone.id);
        const originalItems = fixture.runs.listRunItems("run-first");
        // R authorizes review only; cancel the first review, then explicitly approve a new one.
        const prompt = new FakePrompt([
          "1",
          "r",
          "1",
          "cancelar",
          "",
          "1",
          "r",
          "1",
          "APAGAR",
          "0"
        ]);
        const engine = new FakeCleanerEngine();
        const output: string[] = [];
        const program = createProgram({
          output: { writeLine: (line) => output.push(line) },
          translator: createTranslator(),
          prompt,
          repositoryFactory: () => ({
            ...fixture,
            unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
            lock: new ExecutorLock(fixture.directory),
            close: () => undefined
          }),
          run: { prompt, engine, currentAccount: { handle: "synthetic-1", xUserId: null } }
        });
        await program.parseAsync(["menu", "--data-dir", fixture.directory], { from: "user" });
        expect(engine.calls.map((call) => call.interaction.id)).toEqual([ids[1]]);
        expect(fixture.runs.listRunItems("run-first")).toEqual(originalItems);
        expect(fixture.runs.getRun("run-first")?.status).toBe("COMPLETED");
        expect(fixture.runs.getRunItem(alreadyDone.id)).toEqual(originalCompleted);
        expect(fixture.runs.listBatches("run-overlap")).toHaveLength(1);
        expect(
          prompt.questions.filter((question) => question.includes("Confirmação:"))
        ).toHaveLength(2);
        expect(prompt.messages.join("\n")).toContain("900719925474099302");
        expect(output.join("\n")).toContain("X CLEANER  ·  PREPARAR LOTE");
        expect(output.join("\n")).toContain("Quantidade permitida");
        expect(output.join("\n")).toContain("Uma nova tentativa pode repetir operações anteriores");
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it("envia somente o limite escolhido ao executor após APAGAR", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      confirmAccount(fixture);
      const ids = [1, 2, 3].map((sequence) =>
        addInteraction(fixture, accountId, importId, sequence)
      );
      const plan = createPlan(fixture, accountId, ids);
      fixture.runs.createRun(run("run-limited", plan.id, accountId, fixedNow));
      const prompt = new FakePrompt(["1", "1", "APAGAR", "", "0"]);
      const engine = new FakeCleanerEngine();
      const output: string[] = [];
      const program = createProgram({
        output: { writeLine: (line) => output.push(line) },
        translator: createTranslator(),
        prompt,
        repositoryFactory: () => ({
          ...fixture,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
          lock: new ExecutorLock(fixture.directory),
          close: () => undefined
        }),
        run: {
          prompt,
          currentAccount: { handle: "synthetic-1", xUserId: null },
          engine
        }
      });
      await program.parseAsync(["menu", "--data-dir", fixture.directory], { from: "user" });

      expect(engine.calls).toHaveLength(1);
      expect(fixture.runs.listBatches("run-limited")[0]?.requestedLimit).toBe(1);
      expect(fixture.runs.listRunOverviews()[0]).toMatchObject({
        completed: 1,
        pending: 2
      });
      expect(output.join("\n")).toContain("RESULTADO DO LOTE");
      expect(output.join("\n")).toContain("Neste lote: 1 processado(s)  ·  1 concluído(s)");
      expect(output.join("\n")).toContain("No plano: 2 restante(s)  ·  0 falha(s)");
      expect(output.join("\n")).toContain("[1/1] POST · COMPLETED · salvo");
      expect(output.join("\n")).not.toContain("fronteira persistida");
      expect(output.filter((line) => line.includes("X CLEANER  ·  PAINEL"))).toHaveLength(2);
      expect(prompt.questions[3]).toContain("Voltar ao painel");
      expect(output.join("\n")).not.toContain("x-cleaner resume");
      expect(output.join("\n")).not.toContain("Nenhuma alteração foi feita no X.");
    } finally {
      await fixture.cleanup();
    }
  });

  it("volta à tabela após consultar o estado local", async () => {
    const fixture = await createDatabaseFixture();
    try {
      seedCatalog(fixture);
      const prompt = new FakePrompt(["e", "", "0"]);
      const output: string[] = [];
      const program = createProgram({
        output: { writeLine: (line) => output.push(line) },
        translator: createTranslator(),
        prompt,
        repositoryFactory: () => ({
          ...fixture,
          lock: new ExecutorLock(fixture.directory),
          close: () => undefined
        })
      });
      await program.parseAsync(["menu", "--data-dir", fixture.directory], { from: "user" });

      expect(output.filter((line) => line.includes("X CLEANER  ·  PAINEL"))).toHaveLength(2);
      const state = output.join("\n");
      expect(state).toContain("X CLEANER  ·  ESTADO LOCAL");
      expect(state).toMatch(/│ Campo\s+│ Estado\s+│/u);
      expect(state).toMatch(/│ Importações\s+│ 1\s+│/u);
      expect(state).toMatch(/│ Catálogo\s+│/u);
      expect(state).toMatch(/│ Executor\s+│ Livre\s+│/u);
      const titleIndex = output.indexOf("X CLEANER  ·  ESTADO LOCAL");
      const tableEnd = output.findIndex(
        (line, index) => index > titleIndex && line.startsWith("└")
      );
      const tableLines = output.slice(titleIndex + 1, tableEnd + 1);
      expect(tableLines.length).toBeGreaterThan(5);
      expect(new Set(tableLines.map((line) => line.length)).size).toBe(1);
      expect(prompt.questions[1]).toContain("voltar à tabela");
      expect(prompt.questions).toHaveLength(3);
    } finally {
      await fixture.cleanup();
    }
  });
});

function confirmAccount(fixture: Awaited<ReturnType<typeof createDatabaseFixture>>): void {
  const account = fixture.catalog.getManagedAccount()!;
  fixture.catalog.upsertManagedAccount({
    id: account.id,
    xUserId: account.xUserId,
    archiveHandle: account.archiveHandle,
    confirmedHandle: account.archiveHandle,
    confirmedAt: fixedNow
  });
}

function run(id: string, planId: string, accountId: string, createdAt: string) {
  return {
    id,
    planId,
    accountId,
    boundHandle: "synthetic-1",
    status: "PAUSED" as const,
    pauseReason: null,
    startedAt: fixedNow,
    pausedAt: createdAt,
    finishedAt: null,
    createdAt,
    updatedAt: createdAt
  };
}
