import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { ExecuteBatch } from "../../../src/application/runs/execute-batch.js";
import type { ExecutionUnitOfWork } from "../../../src/application/ports/execution-unit-of-work.js";
import { ProcessSignals } from "../../../src/platform/process-signals.js";
import type { SignalSource } from "../../../src/platform/process-signals.js";
import { ExecutorLock } from "../../../src/infrastructure/lock/executor-lock.js";
import { NdjsonLogger } from "../../../src/infrastructure/logging/ndjson-logger.js";
import { UnitOfWork } from "../../../src/infrastructure/database/unit-of-work.js";
import {
  addInteraction,
  createDatabaseFixture,
  createPlan,
  fixedNow,
  seedCatalog
} from "../../support/database.js";
import { FakeCleanerEngine } from "../../support/fake-cleaner-engine.js";

class FakeSignalSource implements SignalSource {
  #listener: (() => void) | null = null;

  on(_signal: "SIGINT", listener: () => void): this {
    this.#listener = listener;
    return this;
  }

  off(_signal: "SIGINT", listener: () => void): this {
    if (this.#listener === listener) {
      this.#listener = null;
    }
    return this;
  }

  emit(): void {
    this.#listener?.();
  }
}

describe("interrupção segura", () => {
  it("converte o primeiro SIGINT em parada e imprime o comando exato", async () => {
    const source = new FakeSignalSource();
    const events: string[] = [];
    const signals = new ProcessSignals({
      runId: "run-interrupt",
      source,
      stopScheduling: () => events.push("stop"),
      flushCheckpoint: () => events.push("flush"),
      writeLine: (message) => events.push(message),
      forceExit: (code) => events.push(`exit:${code}`)
    });
    signals.install();

    await signals.handleSigint();

    expect(signals.isStopRequested()).toBe(true);
    expect(events).toEqual(["stop", "flush", "x-cleaner resume run-interrupt"]);
  });

  it("força a segunda interrupção sem executar outro flush ou reescrever estado", async () => {
    const source = new FakeSignalSource();
    let flushes = 0;
    const output: string[] = [];
    const signals = new ProcessSignals({
      runId: "run-force",
      source,
      flushCheckpoint: () => {
        flushes += 1;
      },
      writeLine: (message) => output.push(message),
      forceExit: (code) => output.push(`exit:${code}`)
    });
    signals.install();

    await signals.handleSigint();
    await signals.handleSigint();

    expect(flushes).toBe(1);
    expect(output).toEqual(["x-cleaner resume run-force", "exit:130"]);
  });

  it("limita a perda a um único item em voo após uma falha de persistência", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const managed = fixture.catalog.getManagedAccount()!;
      fixture.catalog.upsertManagedAccount({
        ...managed,
        confirmedHandle: managed.archiveHandle,
        confirmedAt: fixedNow
      });
      const interactionIds = [
        addInteraction(fixture, accountId, importId, 1),
        addInteraction(fixture, accountId, importId, 2),
        addInteraction(fixture, accountId, importId, 3)
      ];
      const plan = createPlan(fixture, accountId, interactionIds);
      const runId = "run-in-flight-boundary";
      const batchId = "batch-in-flight-boundary";
      fixture.runs.createRun({
        id: runId,
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
      });
      fixture.runs.createBatch({
        id: batchId,
        runId,
        requestedLimit: null,
        confirmedAt: fixedNow,
        status: "RUNNING",
        startedAt: fixedNow,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });

      const durableUnitOfWork = new UnitOfWork(fixture.database, fixture.runs, fixture.audit);
      let commitAttempts = 0;
      const unitOfWork: ExecutionUnitOfWork = {
        commitAttempt(work) {
          commitAttempts += 1;
          if (commitAttempts === 2) {
            throw new Error("simulated crash after engine result");
          }
          durableUnitOfWork.commitAttempt(work);
        },
        commitBatchBoundary(work) {
          durableUnitOfWork.commitBatchBoundary(work);
        }
      };
      const engine = new FakeCleanerEngine([
        { kind: "COMPLETED", outcome: "COMPLETED" },
        { kind: "COMPLETED", outcome: "COMPLETED" }
      ]);

      await expect(
        new ExecuteBatch({
          plans: fixture.plans,
          catalog: fixture.catalog,
          runs: fixture.runs,
          audit: fixture.audit,
          unitOfWork,
          lock: new ExecutorLock(fixture.directory),
          engine
        }).execute({
          runId,
          batchId,
          account: { handle: "synthetic-1", xUserId: managed.xUserId }
        })
      ).rejects.toThrow("simulated crash after engine result");

      const items = fixture.runs.listRunItems(runId);
      expect(engine.calls.map((call) => call.interaction.id)).toEqual([
        interactionIds[0],
        interactionIds[1]
      ]);
      expect(items.map((item) => item.status)).toEqual(["COMPLETED", "PROCESSING", "PENDING"]);
      expect(fixture.audit.listAttempts(items[0]!.id)).toHaveLength(1);
      expect(fixture.audit.listAttempts(items[1]!.id)).toHaveLength(0);
      expect(fixture.audit.listAttempts(items[2]!.id)).toHaveLength(0);

      expect(fixture.runs.recoverStaleProcessing(runId, fixedNow)).toBe(1);
      expect(fixture.runs.listRunItems(runId).map((item) => item.status)).toEqual([
        "COMPLETED",
        "PENDING",
        "PENDING"
      ]);
      expect(
        fixture.runs.pageEligibleItems(runId, fixedNow, 10).items.map((item) => item.interactionId)
      ).toEqual([interactionIds[1], interactionIds[2]]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("produz o evento de interrupção depois de persistir o checkpoint", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture, "16");
      const managed = fixture.catalog.getManagedAccount()!;
      fixture.catalog.upsertManagedAccount({
        ...managed,
        confirmedHandle: managed.archiveHandle,
        confirmedAt: fixedNow
      });
      const interactionId = addInteraction(fixture, accountId, importId, 1);
      const plan = createPlan(fixture, accountId, [interactionId]);
      const runId = "run-audited-interrupt";
      const batchId = "batch-audited-interrupt";
      fixture.runs.createRun({
        id: runId,
        planId: plan.id,
        accountId,
        boundHandle: "synthetic-16",
        status: "PENDING",
        pauseReason: null,
        startedAt: null,
        pausedAt: null,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      fixture.runs.createBatch({
        id: batchId,
        runId,
        requestedLimit: null,
        confirmedAt: fixedNow,
        status: "RUNNING",
        startedAt: fixedNow,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      const auditLogger = new NdjsonLogger(fixture.directory);
      const result = await new ExecuteBatch(
        {
          plans: fixture.plans,
          catalog: fixture.catalog,
          runs: fixture.runs,
          audit: fixture.audit,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
          lock: new ExecutorLock(fixture.directory),
          engine: new FakeCleanerEngine(),
          auditLogger
        },
        { signal: { isStopRequested: () => true }, clock: { now: () => fixedNow } }
      ).execute({
        runId,
        batchId,
        account: { handle: "synthetic-16", xUserId: managed.xUserId }
      });

      expect(result.run.status).toBe("INTERRUPTED");
      expect(fixture.audit.listCheckpoints(runId)[0]?.reason).toBe("MANUAL_INTERRUPT");
      expect(await readFile(auditLogger.outputPath, "utf8")).toContain('"event":"run.interrupted"');
    } finally {
      await fixture.cleanup();
    }
  });
});
