import { describe, expect, it } from "vitest";

import { createProgram } from "../../../src/cli/create-program.js";
import type { CliOutput } from "../../../src/cli/dependencies.js";
import {
  createDatabaseFixture,
  addInteraction,
  createPlan,
  fixedNow,
  seedCatalog
} from "../../support/database.js";
import { FakeCleanerEngine } from "../../support/fake-cleaner-engine.js";
import { FakePrompt } from "../../support/fake-prompt.js";
import { createTranslator } from "../../../src/i18n/translator.js";
import { UnitOfWork } from "../../../src/infrastructure/database/unit-of-work.js";
import { ExecutorLock } from "../../../src/infrastructure/lock/executor-lock.js";
import { NdjsonLogger } from "../../../src/infrastructure/logging/ndjson-logger.js";

describe("CLI run", () => {
  it("mostra aviso e handle, aceita somente APAGAR, respeita limite e não oferece bypass", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const managed = fixture.catalog.getManagedAccount()!;
      fixture.catalog.upsertManagedAccount({
        id: managed.id,
        xUserId: managed.xUserId,
        archiveHandle: managed.archiveHandle,
        confirmedHandle: managed.archiveHandle,
        confirmedAt: fixedNow
      });
      const plan = createPlan(fixture, accountId, [
        addInteraction(fixture, accountId, importId, 1),
        addInteraction(fixture, accountId, importId, 2)
      ]);
      const outputLines: string[] = [];
      const prompt = new FakePrompt(["APAGAR"]);
      const account = { handle: managed.archiveHandle!, xUserId: managed.xUserId };
      const engine = new FakeCleanerEngine([{ kind: "COMPLETED", outcome: "COMPLETED" }]);
      const auditLogger = new NdjsonLogger(fixture.directory);
      const program = createProgram({
        output: { writeLine: (line) => outputLines.push(line) } satisfies CliOutput,
        translator: createTranslator(),
        repositoryFactory: () => ({
          ...fixture,
          auditLogger,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
          lock: new ExecutorLock(fixture.directory),
          close: () => undefined
        }),
        run: { prompt, currentAccount: account, engine }
      });
      program.exitOverride();
      await program.parseAsync(["run", plan.id, "--limit", "1", "--data-dir", fixture.directory], {
        from: "user"
      });
      expect(prompt.messages.join("\n")).toContain("irreversível");
      expect(prompt.messages.join("\n")).toContain(`@${account.handle}`);
      expect(prompt.messages.join("\n")).toContain("Total: 1");
      expect(prompt.messages.join("\n")).toContain("ID 900719925474099301");
      expect(prompt.messages.join("\n")).toContain(`data ${fixedNow}`);
      expect(prompt.messages.join("\n")).not.toContain("ID 900719925474099302");
      expect(prompt.questions.join("\n")).toContain("Confirmação");
      expect(engine.calls).toHaveLength(1);
      expect(outputLines.join("\n")).toContain("Execução pausada após concluir o lote autorizado");
      expect(outputLines.join("\n")).not.toContain("UNKNOWN_UI");
      expect(program.helpInformation()).not.toMatch(/--(?:yes|force|skip-confirm|no-confirm)/iu);
      const audit = await import("node:fs/promises").then(({ readFile }) =>
        readFile(auditLogger.outputPath, "utf8")
      );
      for (const event of ["run.confirmation.succeeded", "interaction.attempted", "run.paused"]) {
        expect(audit).toContain(`"event":"${event}"`);
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("cancela vazio ou com caixa diferente e recusa conta divergente antes da engine", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const managed = fixture.catalog.getManagedAccount()!;
      fixture.catalog.upsertManagedAccount({
        id: managed.id,
        xUserId: managed.xUserId,
        archiveHandle: managed.archiveHandle,
        confirmedHandle: managed.archiveHandle,
        confirmedAt: fixedNow
      });
      const plan = createPlan(fixture, accountId, [
        addInteraction(fixture, accountId, importId, 1)
      ]);
      const engine = new FakeCleanerEngine();
      const outputLines: string[] = [];
      const prompt = new FakePrompt([""]);
      const account = { handle: managed.archiveHandle!, xUserId: managed.xUserId };
      const auditLogger = new NdjsonLogger(fixture.directory);
      const dependencies = {
        output: { writeLine: (line: string) => outputLines.push(line) },
        translator: createTranslator(),
        repositoryFactory: () => ({
          ...fixture,
          auditLogger,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
          lock: new ExecutorLock(fixture.directory),
          close: () => undefined
        }),
        run: { prompt, currentAccount: account, engine }
      };
      const program = createProgram(dependencies);
      program.exitOverride();
      await program.parseAsync(["run", plan.id, "--data-dir", fixture.directory], { from: "user" });
      expect(engine.calls).toHaveLength(0);
      expect(outputLines.join("\n")).toContain("cancelada");
      const audit = await import("node:fs/promises").then(({ readFile }) =>
        readFile(auditLogger.outputPath, "utf8")
      );
      expect(audit).toContain('"event":"run.confirmation.failed"');

      const mismatchProgram = createProgram({
        ...dependencies,
        run: {
          prompt: new FakePrompt(["APAGAR"]),
          currentAccount: { handle: "outra", xUserId: managed.xUserId },
          engine
        }
      });
      mismatchProgram.exitOverride();
      await expect(
        mismatchProgram.parseAsync(["run", plan.id, "--data-dir", fixture.directory], {
          from: "user"
        })
      ).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" });
      expect(engine.calls).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
