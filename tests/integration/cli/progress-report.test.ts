import { describe, expect, it } from "vitest";

import { CreateRun } from "../../../src/application/runs/create-run.js";
import { GetRunProgress } from "../../../src/application/progress/get-run-progress.js";
import { createProgram } from "../../../src/cli/create-program.js";
import { ProgressRenderer } from "../../../src/cli/progress-renderer.js";
import type { CliOutput } from "../../../src/cli/dependencies.js";
import { createTranslator } from "../../../src/i18n/translator.js";
import { SqliteReportRepository } from "../../../src/infrastructure/database/repositories/sqlite-report-repository.js";
import { JsonReportWriter } from "../../../src/infrastructure/reports/json-report-writer.js";
import {
  addInteraction,
  createDatabaseFixture,
  createPlan,
  fixedNow,
  seedCatalog
} from "../../support/database.js";

describe("saída de progresso e relatório", () => {
  it("conta todos os estados sem consultar ou expor content_preview", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture, "15");
      const account = fixture.catalog.getManagedAccount()!;
      fixture.catalog.upsertManagedAccount({
        id: account.id,
        xUserId: account.xUserId,
        archiveHandle: account.archiveHandle,
        confirmedHandle: account.archiveHandle,
        confirmedAt: fixedNow
      });
      const interactionIds = [
        addInteraction(fixture, accountId, importId, 1, "POST"),
        addInteraction(fixture, accountId, importId, 2, "REPLY"),
        addInteraction(fixture, accountId, importId, 3, "REPOST"),
        addInteraction(fixture, accountId, importId, 4, "LIKE"),
        addInteraction(fixture, accountId, importId, 5, "POST"),
        addInteraction(fixture, accountId, importId, 6, "REPLY"),
        addInteraction(fixture, accountId, importId, 7, "REPOST"),
        addInteraction(fixture, accountId, importId, 8, "LIKE")
      ];
      const plan = createPlan(fixture, accountId, interactionIds, [
        "POST",
        "REPLY",
        "REPOST",
        "LIKE"
      ]);
      const run = new CreateRun(fixture.plans, fixture.catalog, fixture.runs, {
        now: () => fixedNow,
        idFactory: () => "run-progress-states"
      }).execute({
        planId: plan.id,
        account: { handle: account.archiveHandle!, xUserId: account.xUserId }
      }).run;
      const items = fixture.runs.listRunItems(run.id);
      fixture.runs.updateRunItem(items[0]!.id, { status: "COMPLETED", completedAt: fixedNow });
      fixture.runs.updateRunItem(items[1]!.id, {
        status: "PENDING",
        attemptCount: 1,
        nextRetryAt: "2026-09-18T12:00:00.000Z"
      });
      fixture.runs.updateRunItem(items[2]!.id, {
        status: "PROCESSING",
        attemptCount: 1,
        processingStartedAt: fixedNow
      });
      fixture.runs.updateRunItem(items[3]!.id, { status: "SKIPPED", completedAt: fixedNow });
      fixture.runs.updateRunItem(items[4]!.id, {
        status: "FAILED",
        completedAt: fixedNow,
        lastErrorCode: "CANARY_FAILURE"
      });
      fixture.runs.updateRunItem(items[5]!.id, { status: "NOT_FOUND", completedAt: fixedNow });
      fixture.runs.updateRunItem(items[6]!.id, {
        status: "ALREADY_REMOVED",
        completedAt: fixedNow
      });
      fixture.runs.updateRunItem(items[7]!.id, { status: "UNAVAILABLE", completedAt: fixedNow });
      fixture.runs.updateRunStatus(run.id, "PAUSED", {
        pauseReason: "UNKNOWN_UI",
        startedAt: fixedNow,
        pausedAt: fixedNow,
        finishedAt: null
      });

      const progress = new GetRunProgress(fixture.runs).execute(run.id);
      expect(progress.counts).toMatchObject({
        total: 8,
        completed: 1,
        remaining: 2,
        skipped: 1,
        terminalNonError: 3,
        failed: 1,
        paused: 1,
        retry: 1,
        processing: 1
      });
      expect(progress.byType).toMatchObject({
        POST: { total: 2, completed: 1, failed: 1 },
        REPLY: { total: 2, remaining: 1, terminalNonError: 1, retry: 1 },
        REPOST: { total: 2, remaining: 1, terminalNonError: 1, processing: 1 },
        LIKE: { total: 2, skipped: 1, terminalNonError: 1 }
      });

      const rows = fixture.runs.getRunProgressRows(run.id);
      expect(JSON.stringify(rows)).not.toContain("contentPreview");
      expect(JSON.stringify(rows)).not.toContain("conteúdo sintético");
      const rendered = new ProgressRenderer().renderText(progress);
      expect(rendered).toContain("pausados 1");
      expect(rendered).toContain("tentativas 1");
      expect(rendered).not.toContain("CANARY_FAILURE");
    } finally {
      await fixture.cleanup();
    }
  });

  it("mostra resumo em português sem imprimir preview completo", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture, "14");
      const seededAccount = fixture.catalog.getManagedAccount()!;
      fixture.catalog.upsertManagedAccount({
        id: seededAccount.id,
        xUserId: seededAccount.xUserId,
        archiveHandle: seededAccount.archiveHandle,
        confirmedHandle: seededAccount.archiveHandle,
        confirmedAt: fixedNow
      });
      const interactionId = fixture.catalog.upsertInteraction({
        accountId,
        importId,
        xInteractionId: "900719925474099399" as never,
        type: "POST",
        interactionCreatedAt: fixedNow,
        contentPreview: "CANARY_FULL_PRIVATE_CONTENT",
        sourceRelativePath: "data/records.js",
        sourceRecordKey: "1"
      }).interaction.id;
      const plan = createPlan(fixture, accountId, [interactionId]);
      const managed = fixture.catalog.getManagedAccount()!;
      const run = new CreateRun(fixture.plans, fixture.catalog, fixture.runs, {
        now: () => fixedNow,
        idFactory: () => "run-cli"
      }).execute({
        planId: plan.id,
        account: { handle: managed.archiveHandle!, xUserId: managed.xUserId }
      }).run;
      const item = fixture.runs.listRunItems(run.id)[0]!;
      fixture.runs.updateRunItem(item.id, { status: "COMPLETED", completedAt: fixedNow });
      fixture.runs.updateRunStatus(run.id, "COMPLETED", {
        pauseReason: null,
        startedAt: fixedNow,
        pausedAt: null,
        finishedAt: fixedNow
      });
      const lines: string[] = [];
      const output: CliOutput = { writeLine: (line) => lines.push(line) };
      const program = createProgram({
        output,
        translator: createTranslator(),
        repositories: {
          transactions: fixture.transactions,
          catalog: fixture.catalog,
          plans: fixture.plans,
          runs: fixture.runs,
          audit: fixture.audit,
          reports: new SqliteReportRepository(fixture.database)
        },
        reportWriterFactory: (dataDirectory, reports) =>
          new JsonReportWriter(dataDirectory, { reports })
      });
      program.exitOverride();
      await program.parseAsync(["report", run.id, "--data-dir", fixture.directory], {
        from: "user"
      });

      const rendered = lines.join("\n");
      expect(rendered).toContain("Progresso da execução");
      expect(rendered).toContain("POST");
      expect(rendered).toContain("Relatório local gerado");
      expect(rendered).toContain("Caminho local relativo: reports/run-cli.json");
      expect(rendered).not.toContain("CANARY_FULL_PRIVATE_CONTENT");
      expect(rendered).not.toContain("data/records.js");
    } finally {
      await fixture.cleanup();
    }
  });
});
