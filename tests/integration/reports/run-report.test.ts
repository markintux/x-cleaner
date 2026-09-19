import { readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GenerateRunReport } from "../../../src/application/reports/generate-run-report.js";
import { CreateRun } from "../../../src/application/runs/create-run.js";
import { JsonReportWriter } from "../../../src/infrastructure/reports/json-report-writer.js";
import { SqliteReportRepository } from "../../../src/infrastructure/database/repositories/sqlite-report-repository.js";
import {
  addInteraction,
  createDatabaseFixture,
  createPlan,
  fixedNow,
  seedCatalog
} from "../../support/database.js";

describe("relatórios agregados de execução", () => {
  const fixtures: Awaited<ReturnType<typeof createDatabaseFixture>>[] = [];

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
  });

  it.each(["COMPLETED", "FAILED", "PAUSED", "INTERRUPTED"] as const)(
    "gera JSON agregado para estado %s",
    async (state) => {
      const fixture = await createDatabaseFixture();
      fixtures.push(fixture);
      const { accountId, importId } = seedCatalog(fixture, "12");
      const seededAccount = fixture.catalog.getManagedAccount()!;
      fixture.catalog.upsertManagedAccount({
        id: seededAccount.id,
        xUserId: seededAccount.xUserId,
        archiveHandle: seededAccount.archiveHandle,
        confirmedHandle: seededAccount.archiveHandle,
        confirmedAt: fixedNow
      });
      const interactionIds = [
        addInteraction(fixture, accountId, importId, 1, "POST"),
        addInteraction(fixture, accountId, importId, 2, "LIKE")
      ];
      const plan = createPlan(fixture, accountId, interactionIds, ["POST", "LIKE"]);
      const managed = fixture.catalog.getManagedAccount()!;
      const run = new CreateRun(fixture.plans, fixture.catalog, fixture.runs, {
        now: () => fixedNow,
        idFactory: () => `run-${state.toLowerCase()}`
      }).execute({
        planId: plan.id,
        account: { handle: managed.archiveHandle!, xUserId: managed.xUserId }
      }).run;
      const items = fixture.runs.listRunItems(run.id);
      fixture.runs.updateRunItem(items[0]!.id, { status: "COMPLETED", completedAt: fixedNow });
      fixture.runs.updateRunItem(items[1]!.id, {
        status: state === "FAILED" ? "FAILED" : "SKIPPED",
        completedAt: fixedNow,
        lastErrorCode: state === "FAILED" ? "CANARY_SECRET_VALUE" : null
      });
      fixture.runs.updateRunStatus(run.id, state, {
        pauseReason: state === "PAUSED" ? "UNKNOWN_UI" : null,
        startedAt: fixedNow,
        pausedAt: state === "PAUSED" ? fixedNow : null,
        finishedAt: state === "COMPLETED" || state === "FAILED" || state === "INTERRUPTED" ? fixedNow : null
      });

      const aggregate = new GenerateRunReport({ runs: fixture.runs }).execute(run.id);
      expect(aggregate.state).toBe(state);
      expect(aggregate.interrupted).toBe(state === "INTERRUPTED");
      expect(aggregate.counts.total).toBe(2);
      expect(aggregate.counts.byType.POST.total).toBe(1);
      expect(aggregate.counts.byType.LIKE.total).toBe(1);
      expect(JSON.stringify(aggregate)).not.toContain("CANARY_SECRET_VALUE");
      expect(JSON.stringify(aggregate)).not.toContain("conteúdo sintético");

      const reports = new SqliteReportRepository(fixture.database);
      const writer = new JsonReportWriter(fixture.directory, {
        reports,
        now: () => fixedNow,
        idFactory: () => `report-${state.toLowerCase()}`
      });
      const first = await writer.write(aggregate);
      const replacement = await writer.write(aggregate);
      expect(replacement.relativePath).toBe(first.relativePath);
      expect(replacement.sha256).toBe(first.sha256);
      expect(
        path.relative(fixture.directory, replacement.absolutePath).replaceAll(path.sep, "/")
      ).toBe(replacement.relativePath);
      const bytes = await readFile(replacement.absolutePath);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(replacement.sha256);
      expect(fixture.database.connection.prepare("SELECT count(*) AS count FROM generated_reports").get()).toEqual({ count: 1 });
      expect(JSON.parse(bytes.toString("utf8"))).toMatchObject({ runId: run.id, state });
    }
  );

  it("não deixa temporários de escrita atômica", async () => {
    const fixture = await createDatabaseFixture();
    fixtures.push(fixture);
    const { accountId, importId } = seedCatalog(fixture, "13");
    const seededAccount = fixture.catalog.getManagedAccount()!;
    fixture.catalog.upsertManagedAccount({
      id: seededAccount.id,
      xUserId: seededAccount.xUserId,
      archiveHandle: seededAccount.archiveHandle,
      confirmedHandle: seededAccount.archiveHandle,
      confirmedAt: fixedNow
    });
    const interactionId = addInteraction(fixture, accountId, importId, 1);
    const plan = createPlan(fixture, accountId, [interactionId]);
    const managed = fixture.catalog.getManagedAccount()!;
    const run = new CreateRun(fixture.plans, fixture.catalog, fixture.runs, {
      idFactory: () => "run-atomic"
    }).execute({
      planId: plan.id,
      account: { handle: managed.archiveHandle!, xUserId: managed.xUserId }
    }).run;
    const report = new GenerateRunReport({ runs: fixture.runs }).execute(run.id);
    expect(
      () => new JsonReportWriter(fixture.directory, { relativePath: "C:outside.json" })
    ).toThrow("INVALID_AUDIT_OUTPUT_PATH");
    await new JsonReportWriter(fixture.directory).write(report);
    const names = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(fixture.directory, "reports")));
    expect(names).toEqual(["run-atomic.json"]);
    await rm(path.join(fixture.directory, "reports", "run-atomic.json"));
  });
});
