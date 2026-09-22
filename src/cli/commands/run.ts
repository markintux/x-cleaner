import {
  ConfirmBatch,
  type BatchConfirmationSummary
} from "../../application/runs/confirm-batch.js";
import { CreateRun } from "../../application/runs/create-run.js";
import { ExecuteBatch } from "../../application/runs/execute-batch.js";
import { RecoverRun } from "../../application/runs/recover-run.js";
import type { DetectedAccount } from "../../domain/account.js";
import {
  openCliRepositories,
  type CliDependencies,
  type CliRepositories,
  resolveCliDataDirectory
} from "../dependencies.js";
import type { CleanerEngine } from "../../application/ports/cleaner-engine.js";
import type { ExecuteBatchResult } from "../../application/runs/execute-batch.js";
import type { ExecutorLockPort } from "../../application/ports/executor-lock.js";
import { CliExecutionProgress } from "../execution-progress.js";
import { ProcessSignals } from "../../platform/process-signals.js";
import { SystemDelay } from "../../platform/delay.js";
import { GetRunProgress } from "../../application/progress/get-run-progress.js";
import { ProgressRenderer } from "../progress-renderer.js";
import { recordAudit } from "../../application/ports/audit-logger.js";
import { ReadlinePrompt } from "../prompt.js";

export interface RunCommandOptions {
  readonly dataDir?: string;
  readonly limit?: string | number;
  /** Owner-explicit recovery for a lock left behind by an unclean stop. */
  readonly releaseStaleLock?: boolean;
}

export interface RunCommandResult {
  readonly canceled: boolean;
  readonly runId: string;
  readonly batchId: string | null;
  readonly processedCount: number;
}

export function createRunCommand(
  dependencies: CliDependencies
): (planId: string, options: RunCommandOptions) => Promise<RunCommandResult> {
  return (planId, options) => executeCommand(dependencies, "run", planId, options);
}

export function createResumeCommand(
  dependencies: CliDependencies
): (runId: string, options: RunCommandOptions) => Promise<RunCommandResult> {
  return (runId, options) => executeCommand(dependencies, "resume", runId, options);
}

async function executeCommand(
  dependencies: CliDependencies,
  mode: "run" | "resume",
  identifier: string,
  options: RunCommandOptions
): Promise<RunCommandResult> {
  const dataDirectory = resolveCliDataDirectory(dependencies, options.dataDir);
  const repositories = await openCliRepositories(dependencies, dataDirectory);
  try {
    const services = requireRunRepositories(repositories);
    const lock = dependencies.run?.lock ?? services.lock;
    // The lock is diagnosed before recovery and before the destructive
    // confirmation, so a live executor is never reconciled underneath and the
    // owner never types the confirmation phrase into a command that cannot run.
    await assertExecutorLockAvailable(lock, dependencies, options.releaseStaleLock === true);
    const auditLogger = dependencies.auditLogger ?? repositories.auditLogger;
    const limit = parseLimit(options.limit);
    const commandClock = dependencies.run?.clock ?? dependencies.clock;
    const now = commandClock?.now.bind(commandClock) ?? defaultNow;
    let account: DetectedAccount | undefined;
    let run;
    if (mode === "run") {
      account = await resolveCurrentAccount(dependencies, dataDirectory);
      run =
        services.runs.getRunForPlan(identifier) ??
        new CreateRun(services.plans, services.catalog, services.runs, {
          now
        }).execute({ planId: identifier, account }).run;
    } else {
      run = requireRun(services.runs.getRun(identifier));
    }
    if (mode === "resume") {
      if (services.audit === undefined || services.unitOfWork === undefined) {
        throw new Error("EXECUTION_SERVICES_NOT_CONFIGURED");
      }
      const recovery = new RecoverRun(
        { runs: services.runs, audit: services.audit, unitOfWork: services.unitOfWork },
        commandClock === undefined ? {} : { clock: commandClock }
      ).execute({ runId: run.id });
      if (recovery.uncleanStop) {
        dependencies.output.writeLine(
          dependencies.translator.translate("run.recoveredUncleanStop", {
            batches: recovery.closedBatchIds.length,
            items: recovery.recoveredCount
          })
        );
      }
      run = requireRun(services.runs.getRun(run.id));
      account = await resolveCurrentAccount(dependencies, dataDirectory);
      if (account === undefined) {
        throw new Error("CURRENT_ACCOUNT_UNAVAILABLE");
      }
      assertAccountMatchesRun(run.boundHandle, account);
      await recordAudit(auditLogger, {
        event: "run.resumed",
        timestamp: now(),
        runId: run.id
      });
    }
    if (account === undefined) {
      throw new Error("CURRENT_ACCOUNT_UNAVAILABLE");
    }
    const prompt =
      dependencies.run?.prompt ??
      dependencies.prompt ??
      new ReadlinePrompt({ writeLine: (message) => dependencies.output.writeLine(message) });
    dependencies.output.writeLine(
      dependencies.translator.translate("run.planId", { planId: run.planId })
    );
    dependencies.output.writeLine(
      dependencies.translator.translate("run.runId", { runId: run.id })
    );
    const configuredEngine =
      dependencies.run?.engine ?? dependencies.run?.cleanerEngine ?? engineFromLegacy(dependencies);
    const confirmationOptions = commandClock ? { clock: commandClock } : {};
    const localizedConfirmationOptions = {
      ...confirmationOptions,
      ...(auditLogger === undefined ? {} : { auditLogger }),
      messages: {
        types: (summary: BatchConfirmationSummary) =>
          dependencies.translator.translate("run.typeCounts", {
            posts: summary.countsByType.POST,
            replies: summary.countsByType.REPLY,
            reposts: summary.countsByType.REPOST,
            likes: summary.countsByType.LIKE
          }),
        total: (summary: BatchConfirmationSummary) =>
          dependencies.translator.translate("run.total", { count: summary.totalCount }),
        account: (summary: BatchConfirmationSummary) =>
          dependencies.translator.translate("run.account", { handle: summary.handle }),
        items: (summary: BatchConfirmationSummary) =>
          dependencies.translator.translate("run.items", {
            items: summary.items
              .map(
                (item) =>
                  `- ${item.type} | ID ${item.xInteractionId} | data ${item.interactionCreatedAt ?? "SEM_DATA"}`
              )
              .join("\n")
          }),
        warning: dependencies.translator.translate("run.warning"),
        instruction: dependencies.translator.translate("run.confirmInstruction"),
        question: dependencies.translator.translate("run.confirmQuestion")
      }
    };
    const confirmation = await new ConfirmBatch(
      services.plans,
      services.catalog,
      services.runs,
      prompt,
      localizedConfirmationOptions
    ).execute({ run, account, requestedLimit: limit });
    if (!confirmation.confirmed || confirmation.batch === null) {
      dependencies.output.writeLine(dependencies.translator.translate("run.canceled"));
      return { canceled: true, runId: run.id, batchId: null, processedCount: 0 };
    }

    if (lock === undefined || services.unitOfWork === undefined || services.audit === undefined) {
      throw new Error("EXECUTION_SERVICES_NOT_CONFIGURED");
    }
    const engine =
      configuredEngine ??
      dependencies.run?.createBrowserEngine?.({
        dataDirectory,
        confirmedHandle: run.boundHandle
      });
    if (engine === undefined) {
      throw new Error("ENGINE_NOT_CONFIGURED");
    }
    const executionOptions = {
      ...(commandClock === undefined ? {} : { clock: commandClock }),
      delay: dependencies.run?.delay ?? dependencies.delay ?? new SystemDelay(),
      delayMilliseconds: dependencies.run?.delayMilliseconds ?? 0,
      progress:
        dependencies.run?.progress ??
        new CliExecutionProgress({
          translator: dependencies.translator,
          writeLine: (message) => dependencies.output.writeLine(message)
        })
    };
    const signals =
      dependencies.run?.signalFactory?.(run.id) ??
      new ProcessSignals({
        runId: run.id,
        resumeMessage: (value) =>
          dependencies.translator.translate("run.resumeInstruction", { runId: value }),
        writeLine: (message) => dependencies.output.writeLine(message)
      });
    const uninstallSignals = signals.install();
    let result: ExecuteBatchResult;
    try {
      result = await new ExecuteBatch(
        {
          plans: services.plans,
          catalog: services.catalog,
          runs: services.runs,
          audit: services.audit,
          unitOfWork: services.unitOfWork,
          lock,
          engine,
          ...(auditLogger === undefined ? {} : { auditLogger })
        },
        { ...executionOptions, signal: signals }
      ).execute({ runId: run.id, batchId: confirmation.batch.id, account });
    } finally {
      uninstallSignals();
      await closeEngine(engine);
    }
    const progress = new GetRunProgress(services.runs).execute(result.run.id);
    for (const line of new ProgressRenderer({ translator: dependencies.translator }).render(
      progress
    )) {
      dependencies.output.writeLine(line);
    }
    if (result.run.status === "PAUSED") {
      dependencies.output.writeLine(
        result.run.pauseReason === null
          ? dependencies.translator.translate("run.batchCompleted", {
              runId: result.run.id
            })
          : dependencies.translator.translate("run.paused", {
              runId: result.run.id,
              reason: result.run.pauseReason
            })
      );
    } else if (result.run.status === "INTERRUPTED") {
      dependencies.output.writeLine(
        dependencies.translator.translate("run.interrupted", { runId: result.run.id })
      );
    } else {
      dependencies.output.writeLine(
        dependencies.translator.translate("run.completed", {
          runId: result.run.id,
          count: result.processedCount
        })
      );
    }
    return {
      canceled: false,
      runId: result.run.id,
      batchId: result.batch.id,
      processedCount: result.processedCount
    };
  } finally {
    repositories.close?.();
  }
}

/**
 * Diagnoses the filesystem lock without ever taking it over implicitly. A
 * stale file is only removed when the owner asks for it in the same command.
 */
async function assertExecutorLockAvailable(
  lock: ExecutorLockPort | undefined,
  dependencies: CliDependencies,
  releaseStaleLock: boolean
): Promise<void> {
  if (lock?.diagnoseStaleLock === undefined) return;
  let diagnosis = await lock.diagnoseStaleLock();
  if (diagnosis === "STALE" && releaseStaleLock) {
    const released = (await lock.releaseStaleLock?.()) ?? false;
    dependencies.output.writeLine(
      dependencies.translator.translate(released ? "run.lockReleased" : "run.lockNotStale")
    );
    diagnosis = await lock.diagnoseStaleLock();
  }
  if (diagnosis === "NOT_HELD") return;
  if (diagnosis === "UNKNOWN") {
    dependencies.output.writeLine(dependencies.translator.translate("run.lockUnknown"));
    throw executorLockHeldError();
  }
  const owner = (await lock.readStatus?.()) ?? null;
  dependencies.output.writeLine(
    dependencies.translator.translate(diagnosis === "ACTIVE" ? "run.lockActive" : "run.lockStale", {
      pid: owner?.pid ?? "?",
      hostname: owner?.hostname ?? "?",
      acquiredAt: owner?.acquiredAt ?? "?"
    })
  );
  if (diagnosis === "STALE") {
    dependencies.output.writeLine(dependencies.translator.translate("run.lockStaleInstruction"));
  }
  throw executorLockHeldError();
}

function executorLockHeldError(): Error {
  return Object.assign(new Error("EXECUTOR_LOCK_HELD"), { code: "EXECUTOR_LOCK_HELD" });
}

async function closeEngine(engine: CleanerEngine): Promise<void> {
  if (
    typeof engine === "object" &&
    engine !== null &&
    "close" in engine &&
    typeof engine.close === "function"
  ) {
    await engine.close();
  }
}

async function resolveCurrentAccount(
  dependencies: CliDependencies,
  dataDirectory: string
): Promise<DetectedAccount> {
  const configured = dependencies.run?.currentAccount ?? dependencies.currentAccount;
  if (configured !== undefined) {
    return configured;
  }
  const getCurrentAccount = dependencies.run?.getCurrentAccount ?? dependencies.getCurrentAccount;
  if (getCurrentAccount !== undefined) {
    const account = await getCurrentAccount(dataDirectory);
    if (account !== null) {
      return account;
    }
    throw new Error("CURRENT_ACCOUNT_UNAVAILABLE");
  }
  const sessionFactory = dependencies.session?.createLoginSession;
  if (sessionFactory !== undefined) {
    const result = await (await sessionFactory(dataDirectory)).execute();
    if (result.account !== null) {
      return result.account;
    }
    throw new Error("CURRENT_ACCOUNT_UNAVAILABLE");
  }
  throw new Error("CURRENT_ACCOUNT_UNAVAILABLE");
}

function parseLimit(value: string | number | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("INVALID_BATCH_LIMIT");
  }
  return parsed;
}

function requireRun(run: ReturnType<NonNullable<CliRepositories["runs"]>["getRun"]>) {
  if (run === null) {
    throw new Error("RUN_NOT_FOUND");
  }
  return run;
}

function assertAccountMatchesRun(boundHandle: string, account: DetectedAccount): void {
  const handle = account.handle.trim().replace(/^@+/u, "").toLowerCase();
  if (handle !== boundHandle) {
    throw new Error("ACCOUNT_MISMATCH");
  }
}

function engineFromLegacy(dependencies: CliDependencies) {
  const candidate = dependencies.cleanerEngine;
  if (
    candidate !== undefined &&
    typeof candidate === "object" &&
    candidate !== null &&
    "execute" in candidate
  ) {
    return candidate as unknown as NonNullable<CliDependencies["run"]>["engine"];
  }
  return null;
}

function requireRunRepositories(repositories: CliRepositories) {
  if (repositories.runs === undefined) {
    throw new Error("EXECUTION_REPOSITORIES_NOT_CONFIGURED");
  }
  return { ...repositories, runs: repositories.runs };
}

function defaultNow(): string {
  return new Date().toISOString();
}
