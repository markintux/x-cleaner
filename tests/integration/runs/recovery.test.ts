import { describe, expect, it } from "vitest";

import { RecoverRun } from "../../../src/application/runs/recover-run.js";
import { ExecuteBatch } from "../../../src/application/runs/execute-batch.js";
import { createResumeCommand } from "../../../src/cli/commands/resume.js";
import { RetryPolicy } from "../../../src/domain/retry-policy.js";
import { ExecutorLock } from "../../../src/infrastructure/lock/executor-lock.js";
import { NdjsonLogger } from "../../../src/infrastructure/logging/ndjson-logger.js";
import { UnitOfWork } from "../../../src/infrastructure/database/unit-of-work.js";
import { createTranslator } from "../../../src/i18n/translator.js";
import type { CleaningRun, RunBatch } from "../../../src/domain/run.js";
import {
  addInteraction,
  createDatabaseFixture,
  createPlan,
  fixedNow,
  seedCatalog
} from "../../support/database.js";
import { FakeCleanerEngine } from "../../support/fake-cleaner-engine.js";
import { FakeClock } from "../../support/fake-clock.js";
import { FakeDelay } from "../../support/fake-delay.js";

describe("recuperação de runs", () => {
  it("recupera PROCESSING sem tentativa comprometida e preserva terminal e ledger", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const ids = [
        addInteraction(fixture, accountId, importId, 1),
        addInteraction(fixture, accountId, importId, 2),
        addInteraction(fixture, accountId, importId, 3)
      ];
      const plan = createPlan(fixture, accountId, ids);
      const run: CleaningRun = {
        id: "run-recovery",
        planId: plan.id,
        accountId,
        boundHandle: "synthetic-1",
        status: "PAUSED",
        pauseReason: "SESSION_EXPIRED",
        startedAt: fixedNow,
        pausedAt: fixedNow,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      };
      fixture.runs.createRun(run);
      const items = fixture.runs.listRunItems(run.id);
      fixture.runs.updateRunItem(items[0]!.id, { status: "COMPLETED", completedAt: fixedNow });
      fixture.runs.updateRunItem(items[1]!.id, {
        status: "PROCESSING",
        attemptCount: 1,
        processingStartedAt: fixedNow
      });
      fixture.runs.updateRunItem(items[2]!.id, {
        status: "PROCESSING",
        attemptCount: 1,
        processingStartedAt: fixedNow
      });
      const batch: RunBatch = {
        id: "batch-recovery",
        runId: run.id,
        requestedLimit: null,
        confirmedAt: fixedNow,
        status: "RUNNING",
        startedAt: fixedNow,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      };
      fixture.runs.createBatch(batch);
      fixture.audit.appendAttempt({
        runItemId: items[2]!.id,
        batchId: batch.id,
        attemptNumber: 1,
        outcome: "COMPLETED",
        retryable: false,
        durationMs: 1,
        errorCode: null,
        errorContextJson: null,
        startedAt: fixedNow,
        finishedAt: fixedNow,
        createdAt: fixedNow
      });

      const result = new RecoverRun(
        {
          runs: fixture.runs,
          audit: fixture.audit,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit)
        },
        { now: () => "2026-03-04T05:07:07.000Z" }
      ).execute({ runId: run.id });

      expect(result.recoveredCount).toBe(1);
      expect(fixture.runs.getRunItem(items[0]!.id)?.status).toBe("COMPLETED");
      expect(fixture.runs.getRunItem(items[1]!.id)).toMatchObject({
        status: "PENDING",
        processingStartedAt: null,
        nextRetryAt: "2026-03-04T05:07:07.000Z"
      });
      expect(fixture.runs.getRunItem(items[2]!.id)?.status).toBe("PROCESSING");
      expect(result.checkpoint.sequence).toBe(1);
      expect(fixture.audit.listCheckpoints(run.id)).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("registra cada tentativa, aplica backoff injetado e transforma exaustão em FAILED", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const managed = fixture.catalog.getManagedAccount()!;
      fixture.catalog.upsertManagedAccount({
        ...managed,
        confirmedHandle: managed.archiveHandle,
        confirmedAt: fixedNow
      });
      const interactionId = addInteraction(fixture, accountId, importId, 1);
      const plan = createPlan(fixture, accountId, [interactionId]);
      const run: CleaningRun = {
        id: "run-retry",
        planId: plan.id,
        accountId,
        boundHandle: "synthetic-1",
        status: "PENDING",
        pauseReason: null,
        startedAt: null,
        pausedAt: null,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      };
      fixture.runs.createRun(run);
      fixture.runs.createBatch({
        id: "batch-retry",
        runId: run.id,
        requestedLimit: 1,
        confirmedAt: fixedNow,
        status: "RUNNING",
        startedAt: fixedNow,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      const engine = new FakeCleanerEngine([
        { kind: "RETRYABLE_FAILURE", outcome: "RETRYABLE_FAILURE", errorCode: "TIMEOUT" },
        { kind: "COMPLETED", outcome: "COMPLETED" }
      ]);
      const delay = new FakeDelay();
      const result = await new ExecuteBatch(
        {
          plans: fixture.plans,
          catalog: fixture.catalog,
          runs: fixture.runs,
          audit: fixture.audit,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
          lock: new ExecutorLock(fixture.directory),
          engine
        },
        {
          clock: new FakeClock(fixedNow),
          delay,
          retryPolicy: new RetryPolicy({ maxAttempts: 2, baseDelayMs: 125, maxDelayMs: 125 })
        }
      ).execute({
        runId: run.id,
        batchId: "batch-retry",
        account: { handle: "synthetic-1", xUserId: fixture.catalog.getManagedAccount()!.xUserId }
      });

      const item = fixture.runs.listRunItems(run.id)[0]!;
      expect(result.engineCalls).toBe(2);
      expect(delay.calls).toEqual([125]);
      expect(item.status).toBe("COMPLETED");
      expect(fixture.audit.listAttempts(item.id).map((attempt) => attempt.attemptNumber)).toEqual([
        1, 2
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("persiste FAILED na exaustão real sem iniciar uma tentativa extra", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const managed = fixture.catalog.getManagedAccount()!;
      fixture.catalog.upsertManagedAccount({
        ...managed,
        confirmedHandle: managed.archiveHandle,
        confirmedAt: fixedNow
      });
      const interactionId = addInteraction(fixture, accountId, importId, 1);
      const plan = createPlan(fixture, accountId, [interactionId]);
      const run: CleaningRun = {
        id: "run-exhaustion",
        planId: plan.id,
        accountId,
        boundHandle: "synthetic-1",
        status: "PENDING",
        pauseReason: null,
        startedAt: null,
        pausedAt: null,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      };
      fixture.runs.createRun(run);
      fixture.runs.createBatch({
        id: "batch-exhaustion",
        runId: run.id,
        requestedLimit: 1,
        confirmedAt: fixedNow,
        status: "RUNNING",
        startedAt: fixedNow,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      const engine = new FakeCleanerEngine([
        { kind: "RETRYABLE_FAILURE", outcome: "RETRYABLE_FAILURE", errorCode: "TIMEOUT" },
        { kind: "RETRYABLE_FAILURE", outcome: "RETRYABLE_FAILURE", errorCode: "TIMEOUT" },
        { kind: "RETRYABLE_FAILURE", outcome: "RETRYABLE_FAILURE", errorCode: "TIMEOUT" }
      ]);
      const delay = new FakeDelay();

      const result = await new ExecuteBatch(
        {
          plans: fixture.plans,
          catalog: fixture.catalog,
          runs: fixture.runs,
          audit: fixture.audit,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
          lock: new ExecutorLock(fixture.directory),
          engine
        },
        {
          clock: new FakeClock(fixedNow),
          delay,
          retryPolicy: new RetryPolicy({ maxAttempts: 3, baseDelayMs: 125, maxDelayMs: 125 })
        }
      ).execute({
        runId: run.id,
        batchId: "batch-exhaustion",
        account: { handle: "synthetic-1", xUserId: managed.xUserId }
      });

      const item = fixture.runs.listRunItems(run.id)[0]!;
      expect(result.engineCalls).toBe(3);
      expect(engine.calls).toHaveLength(3);
      expect(delay.calls).toEqual([125, 125]);
      expect(item).toMatchObject({
        status: "FAILED",
        attemptCount: 3,
        nextRetryAt: null,
        lastErrorCode: "TIMEOUT"
      });
      expect(fixture.audit.listAttempts(item.id).map((attempt) => attempt.attemptNumber)).toEqual([
        1, 2, 3
      ]);
      expect(
        fixture.audit
          .listAttempts(item.id)
          .every((attempt) => attempt.outcome === "RETRYABLE_FAILURE")
      ).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("no resume recupera o estado antes da nova confirmação e agenda só o item elegível", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const managed = fixture.catalog.getManagedAccount()!;
      fixture.catalog.upsertManagedAccount({
        ...managed,
        confirmedHandle: managed.archiveHandle,
        confirmedAt: fixedNow
      });
      const ids = [
        addInteraction(fixture, accountId, importId, 1),
        addInteraction(fixture, accountId, importId, 2)
      ];
      const plan = createPlan(fixture, accountId, ids);
      const run: CleaningRun = {
        id: "run-cli-resume",
        planId: plan.id,
        accountId,
        boundHandle: "synthetic-1",
        status: "INTERRUPTED",
        pauseReason: null,
        startedAt: fixedNow,
        pausedAt: null,
        finishedAt: fixedNow,
        createdAt: fixedNow,
        updatedAt: fixedNow
      };
      fixture.runs.createRun(run);
      const items = fixture.runs.listRunItems(run.id);
      fixture.runs.updateRunItem(items[0]!.id, {
        status: "PROCESSING",
        attemptCount: 1,
        processingStartedAt: fixedNow
      });
      fixture.runs.updateRunItem(items[1]!.id, { status: "COMPLETED", completedAt: fixedNow });
      const output: string[] = [];
      const engine = new FakeCleanerEngine([{ kind: "COMPLETED", outcome: "COMPLETED" }]);
      const auditLogger = new NdjsonLogger(fixture.directory);
      const result = await createResumeCommand({
        output: { writeLine: (message) => output.push(message) },
        translator: createTranslator(),
        repositories: {
          database: fixture.database,
          catalog: fixture.catalog,
          plans: fixture.plans,
          runs: fixture.runs,
          audit: fixture.audit,
          auditLogger,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
          lock: new ExecutorLock(fixture.directory)
        },
        run: {
          currentAccount: { handle: "synthetic-1", xUserId: managed.xUserId },
          prompt: new (class {
            writeLine(): void {}

            async ask(): Promise<string> {
              return "APAGAR";
            }
          })(),
          engine,
          clock: new FakeClock(fixedNow),
          delay: new FakeDelay()
        }
      })(run.id, { dataDir: fixture.directory });

      expect(result.canceled).toBe(false);
      expect(engine.calls.map((call) => call.interaction.id)).toEqual([ids[0]]);
      expect(fixture.runs.listRunItems(run.id).map((item) => item.status)).toEqual([
        "COMPLETED",
        "COMPLETED"
      ]);
      expect(fixture.audit.listCheckpoints(run.id)[0]?.sequence).toBe(1);
      expect(output.some((line) => line.includes("concluído"))).toBe(true);
      const audit = await import("node:fs/promises").then(({ readFile }) =>
        readFile(auditLogger.outputPath, "utf8")
      );
      expect(audit).toContain('"event":"run.resumed"');
    } finally {
      await fixture.cleanup();
    }
  });
});
