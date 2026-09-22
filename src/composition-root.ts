import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";

import { ArchiveSourceError, type ArchiveSource } from "./application/ports/archive-source.js";
import type { BrowserContextFactoryPort } from "./infrastructure/browser/browser-session.js";
import type { CleanerEngine } from "./application/ports/cleaner-engine.js";
import type { Clock } from "./application/ports/clock.js";
import type { Delay } from "./application/ports/delay.js";
import type { Prompt } from "./application/ports/prompt.js";
import type {
  ConfirmAccountInput,
  ConfirmedAccountResult
} from "./application/session/confirm-account.js";
import type { ClearSessionInput, ClearSessionResult } from "./application/session/clear-session.js";
import { ConfirmAccount } from "./application/session/confirm-account.js";
import { ClearSession } from "./application/session/clear-session.js";
import { LoginSession, type LoginSessionResult } from "./application/session/login-session.js";
import { ArchiveDetector } from "./infrastructure/archive/archive-detector.js";
import { DetectedArchiveParser } from "./infrastructure/archive/archive-parser.js";
import { DirectoryArchiveSource } from "./infrastructure/archive/directory-archive-source.js";
import { YtdArchiveAdapter } from "./infrastructure/archive/adapters/ytd-archive-adapter.js";
import { ZipArchiveSource } from "./infrastructure/archive/zip-archive-source.js";
import { BrowserContextFactory } from "./infrastructure/browser/browser-context-factory.js";
import { XLoginGateway } from "./infrastructure/browser/x-login-gateway.js";
import {
  ManualChromeLauncher,
  type ManualBrowserLauncherPort
} from "./infrastructure/browser/manual-chrome-launcher.js";
import { FileSystemSessionStorage } from "./infrastructure/browser/file-system-session-storage.js";
import {
  BrowserCleanerEngine,
  type BrowserCleanerEngineOptions
} from "./infrastructure/browser/browser-cleaner-engine.js";
import { JsonReportWriter } from "./infrastructure/reports/json-report-writer.js";
import { NdjsonLogger } from "./infrastructure/logging/ndjson-logger.js";
import { migrations } from "./infrastructure/database/migrations/index.js";
import { SqliteDatabase } from "./infrastructure/database/database.js";
import { Migrator } from "./infrastructure/database/migrator.js";
import { SqliteRepositoryTransactionRunner } from "./infrastructure/database/repository-transaction.js";
import { SqliteCatalogRepository } from "./infrastructure/database/repositories/sqlite-catalog-repository.js";
import { SqlitePlanRepository } from "./infrastructure/database/repositories/sqlite-plan-repository.js";
import { SqliteRunRepository } from "./infrastructure/database/repositories/sqlite-run-repository.js";
import { SqliteAuditRepository } from "./infrastructure/database/repositories/sqlite-audit-repository.js";
import { SqliteReportRepository } from "./infrastructure/database/repositories/sqlite-report-repository.js";
import { UnitOfWork } from "./infrastructure/database/unit-of-work.js";
import { ExecutorLock } from "./infrastructure/lock/executor-lock.js";
import { ProcessSignalAdapter } from "./platform/process-signals.js";
import { SystemDelay } from "./platform/delay.js";
import { createTranslator, type Translator } from "./i18n/translator.js";
import {
  consoleErrorOutput,
  consoleOutput,
  type CliDependencies,
  type CliOutput,
  type CliRepositories,
  type CliSignalAdapter,
  type SessionPrompt
} from "./cli/dependencies.js";
import { ReadlinePrompt } from "./cli/prompt.js";
import { createProgram } from "./cli/create-program.js";
import { resolveApplicationDataDirectory } from "./platform/application-data.js";

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export interface CompositionRootOptions {
  readonly output?: CliOutput;
  readonly errorOutput?: CliOutput;
  readonly translator?: Translator;
  readonly clock?: Clock;
  readonly delay?: Delay;
  readonly interactionDelayMilliseconds?: number;
  readonly prompt?: Prompt;
  readonly sessionPrompt?: SessionPrompt;
  readonly diagnostics?: boolean;
  readonly createBrowserContextFactory?: (dataDirectory: string) => BrowserContextFactoryPort;
  readonly manualBrowserLauncher?: ManualBrowserLauncherPort;
  readonly createBrowserEngine?: (options: BrowserCleanerEngineOptions) => CleanerEngine;
  readonly createSignalAdapter?: (runId: string, output: CliOutput) => CliSignalAdapter;
  readonly createLoginSession?: (
    dataDirectory: string
  ) =>
    | { execute(): Promise<LoginSessionResult> }
    | Promise<{ execute(): Promise<LoginSessionResult> }>;
  readonly archiveDetector?: ArchiveDetector;
}

export interface CompositionRoot {
  readonly dependencies: CliDependencies;
  createProgram(): ReturnType<typeof createProgram>;
  close(): Promise<void>;
}

/** Creates one complete application graph; stateful adapters remain data-dir scoped. */
export function createCompositionRoot(options: CompositionRootOptions = {}): CompositionRoot {
  const output = options.output ?? consoleOutput;
  const errorOutput = options.errorOutput ?? consoleErrorOutput;
  const translator = options.translator ?? createTranslator();
  const clock = options.clock ?? new SystemClock();
  const delay = options.delay ?? new SystemDelay();
  const prompt =
    options.prompt ?? new ReadlinePrompt({ writeLine: (message) => output.writeLine(message) });
  const sessionPrompt =
    options.sessionPrompt ??
    (isSessionPrompt(prompt)
      ? prompt
      : new ReadlinePrompt({ writeLine: (message) => output.writeLine(message) }));
  const detector = options.archiveDetector ?? new ArchiveDetector([new YtdArchiveAdapter()]);

  const createBrowserContextFactory =
    options.createBrowserContextFactory ??
    ((dataDirectory: string): BrowserContextFactoryPort =>
      new BrowserContextFactory({ dataDirectory }));
  const createBrowserEngine =
    options.createBrowserEngine ??
    ((engineOptions: BrowserCleanerEngineOptions): CleanerEngine => {
      const dataDirectory = engineOptions.dataDirectory;
      if (dataDirectory === undefined && engineOptions.contextFactory === undefined) {
        return new BrowserCleanerEngine(engineOptions);
      }
      return new BrowserCleanerEngine({
        ...engineOptions,
        ...(engineOptions.contextFactory === undefined && dataDirectory !== undefined
          ? { contextFactory: createBrowserContextFactory(dataDirectory) }
          : {})
      });
    });

  const createLoginSession = async (dataDirectory: string) =>
    options.createLoginSession?.(dataDirectory) ??
    new LoginSession(
      new XLoginGateway({
        contextFactory: createBrowserContextFactory(dataDirectory),
        manualBrowserLauncher: options.manualBrowserLauncher ?? new ManualChromeLauncher()
      })
    );

  const createSessionInspector = async (dataDirectory: string) =>
    options.createLoginSession?.(dataDirectory) ??
    new LoginSession(
      new XLoginGateway({ contextFactory: createBrowserContextFactory(dataDirectory) })
    );

  const dependencies: CliDependencies = {
    output,
    errorOutput,
    translator,
    clock,
    delay,
    diagnostics: options.diagnostics ?? false,
    resolveDataDirectory: (override) =>
      resolveApplicationDataDirectory(override === undefined ? {} : { dataDir: override }),
    prompt,
    auditLoggerFactory: (dataDirectory) => new NdjsonLogger(dataDirectory),
    archive: {
      parser: new DetectedArchiveParser(detector),
      sourceFactory: createArchiveSource
    },
    repositoryFactory: (dataDirectory) => openRepositories(dataDirectory, clock),
    session: {
      prompt: sessionPrompt,
      createLoginSession,
      confirmAccount: (catalog, input: ConfirmAccountInput): ConfirmedAccountResult =>
        new ConfirmAccount(catalog, { now: clock.now.bind(clock) }).execute(input),
      clearSession: (input: ClearSessionInput): Promise<ClearSessionResult> =>
        new ClearSession(new FileSystemSessionStorage(), clock.now.bind(clock)).execute(input)
    },
    reportWriterFactory: (dataDirectory, reports) =>
      new JsonReportWriter(dataDirectory, {
        ...(reports === undefined ? {} : { reports }),
        now: clock.now.bind(clock)
      }),
    run: {
      prompt,
      clock,
      delay,
      delayMilliseconds: options.interactionDelayMilliseconds ?? 5_000,
      signalFactory: (runId) =>
        options.createSignalAdapter?.(runId, output) ??
        new ProcessSignalAdapter({
          runId,
          resumeMessage: (value) => translator.translate("run.resumeInstruction", { runId: value }),
          writeLine: (message) => output.writeLine(message)
        }),
      getCurrentAccount: async (dataDirectory) =>
        (await createSessionInspector(dataDirectory)).execute().then((result) => result.account),
      createBrowserEngine
    }
  };

  return {
    dependencies,
    createProgram: () => createProgram(dependencies),
    close: async () => undefined
  };
}

export const createApplication = createCompositionRoot;

async function createArchiveSource(input: string): Promise<ArchiveSource> {
  const stats = await lstat(input).catch(() => null);
  if (stats === null || stats.isSymbolicLink()) {
    throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID");
  }
  if (stats.isDirectory()) return new DirectoryArchiveSource(input);
  if (stats.isFile()) return new ZipArchiveSource(input);
  throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID");
}

async function openRepositories(dataDirectory: string, clock: Clock): Promise<CliRepositories> {
  await mkdir(dataDirectory, { recursive: true });
  const database = new SqliteDatabase(path.join(dataDirectory, "state.sqlite"));
  const now = clock.now.bind(clock);
  new Migrator(database, { now }).migrate(migrations);
  const catalog = new SqliteCatalogRepository(database, { now });
  const plans = new SqlitePlanRepository(database);
  const runs = new SqliteRunRepository(database, { now });
  const audit = new SqliteAuditRepository(database);
  const reports = new SqliteReportRepository(database);
  return {
    transactions: new SqliteRepositoryTransactionRunner(database),
    catalog,
    plans,
    runs,
    audit,
    reports,
    auditLogger: new NdjsonLogger(dataDirectory),
    unitOfWork: new UnitOfWork(database, runs, audit),
    lock: new ExecutorLock(dataDirectory, { now }),
    close: () => database.close()
  };
}

function isSessionPrompt(value: Prompt): value is Prompt & SessionPrompt {
  return "confirm" in value && typeof value.confirm === "function";
}
