import { createInterface } from "node:readline/promises";
import { stdin as standardInput, stdout as standardOutput } from "node:process";

import {
  ConfirmBatch,
  type BatchConfirmationSummary
} from "../../application/runs/confirm-batch.js";
import { CreateRun } from "../../application/runs/create-run.js";
import { ExecuteBatch } from "../../application/runs/execute-batch.js";
import type { Prompt } from "../../application/ports/prompt.js";
import type { DetectedAccount } from "../../domain/account.js";
import { LoginSession } from "../../application/session/login-session.js";
import { resolveApplicationDataDirectory } from "../../platform/application-data.js";
import {
  openCliRepositories,
  createConfirmedBrowserEngine,
  type CliDependencies,
  type CliRepositories
} from "../dependencies.js";
import type { CleanerEngine } from "../../application/ports/cleaner-engine.js";
import type { ExecuteBatchResult } from "../../application/runs/execute-batch.js";

export interface RunCommandOptions {
  readonly dataDir?: string;
  readonly limit?: string | number;
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
  const dataDirectory = resolveApplicationDataDirectory(
    options.dataDir === undefined ? {} : { dataDir: options.dataDir }
  );
  const repositories = await openCliRepositories(dependencies, dataDirectory);
  try {
    const services = requireRunRepositories(repositories);
    const account = await resolveCurrentAccount(dependencies, dataDirectory);
    const limit = parseLimit(options.limit);
    const run =
      mode === "run"
        ? (services.runs.getRunForPlan(identifier) ??
          new CreateRun(services.plans, services.catalog, services.runs).execute({
            planId: identifier,
            account
          }).run)
        : requireRun(services.runs.getRun(identifier));
    if (mode === "resume") {
      assertAccountMatchesRun(run.boundHandle, account);
    }
    const prompt = dependencies.run?.prompt ?? dependencies.prompt ?? new CliPrompt(dependencies);
    dependencies.output.writeLine(
      dependencies.translator.translate("run.planId", { planId: run.planId })
    );
    dependencies.output.writeLine(
      dependencies.translator.translate("run.runId", { runId: run.id })
    );
    const configuredEngine =
      dependencies.run?.engine ?? dependencies.run?.cleanerEngine ?? engineFromLegacy(dependencies);
    const confirmationOptions = dependencies.run?.clock ? { clock: dependencies.run.clock } : {};
    const localizedConfirmationOptions = {
      ...confirmationOptions,
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

    const lock = dependencies.run?.lock ?? services.lock;
    if (lock === undefined || services.unitOfWork === undefined || services.audit === undefined) {
      throw new Error("EXECUTION_SERVICES_NOT_CONFIGURED");
    }
    const engine =
      configuredEngine ??
      dependencies.run?.createBrowserEngine?.({
        dataDirectory,
        confirmedHandle: run.boundHandle
      }) ??
      createConfirmedBrowserEngine(dataDirectory, run.boundHandle);
    const executionOptions = {
      ...(dependencies.run?.clock === undefined ? {} : { clock: dependencies.run.clock }),
      ...(dependencies.run?.delay === undefined ? {} : { delay: dependencies.run.delay })
    };
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
          engine
        },
        executionOptions
      ).execute({ runId: run.id, batchId: confirmation.batch.id, account });
    } finally {
      await closeEngine(engine);
    }
    dependencies.output.writeLine(
      dependencies.translator.translate("run.completed", {
        runId: result.run.id,
        count: result.processedCount
      })
    );
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
  const result = await new LoginSession({ dataDirectory }).execute();
  if (result.account === null) {
    throw new Error("CURRENT_ACCOUNT_UNAVAILABLE");
  }
  return result.account;
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

class CliPrompt implements Prompt {
  constructor(private readonly dependencies: CliDependencies) {}

  writeLine(message: string): void {
    this.dependencies.output.writeLine(message);
  }

  async ask(question: string): Promise<string> {
    const readline = createInterface({ input: standardInput, output: standardOutput });
    try {
      return await readline.question(question + " ");
    } finally {
      readline.close();
    }
  }
}
