import { describe, expect, it } from "vitest";

import { createProgram } from "../../../src/cli/create-program.js";
import { createTranslator } from "../../../src/i18n/translator.js";
import { UnitOfWork } from "../../../src/infrastructure/database/unit-of-work.js";
import { ExecutorLock } from "../../../src/infrastructure/lock/executor-lock.js";
import { FakeCleanerEngine } from "../../support/fake-cleaner-engine.js";
import { FakePrompt } from "../../support/fake-prompt.js";
import {
  addInteraction,
  createDatabaseFixture,
  createPlan,
  fixedNow,
  seedCatalog
} from "../../support/database.js";

describe("menu interativo", () => {
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

  it("bloqueia o plano posterior quando seus itens já pertencem a outro run", async () => {
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

      const prompt = new FakePrompt(["2", "0"]);
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

      expect(output.join("\n")).toContain("Este plano se sobrepõe a outra execução");
      expect(prompt.questions).toHaveLength(2);
      expect(fixture.runs.listBatches("run-overlap")).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

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
