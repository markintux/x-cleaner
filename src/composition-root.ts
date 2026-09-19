import { lstat } from "node:fs/promises";

import { ArchiveSourceError, type ArchiveSource } from "./application/ports/archive-source.js";
import type { BrowserContextFactoryPort } from "./application/ports/browser-session.js";
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
import { DirectoryArchiveSource } from "./infrastructure/archive/directory-archive-source.js";
import { YtdArchiveAdapter } from "./infrastructure/archive/adapters/ytd-archive-adapter.js";
import { ZipArchiveSource } from "./infrastructure/archive/zip-archive-source.js";
import { BrowserContextFactory } from "./infrastructure/browser/browser-context-factory.js";
import {
  BrowserCleanerEngine,
  type BrowserCleanerEngineOptions
} from "./infrastructure/browser/browser-cleaner-engine.js";
import { JsonReportWriter } from "./infrastructure/reports/json-report-writer.js";
import { NdjsonLogger } from "./infrastructure/logging/ndjson-logger.js";
import { ProcessSignalAdapter } from "./platform/process-signals.js";
import { SystemDelay } from "./platform/delay.js";
import { createTranslator, type Translator } from "./i18n/translator.js";
import {
  consoleErrorOutput,
  consoleOutput,
  type CliDependencies,
  type CliOutput,
  type CliSignalAdapter,
  type SessionPrompt,
  openCliRepositories
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
  readonly prompt?: Prompt;
  readonly sessionPrompt?: SessionPrompt;
  readonly diagnostics?: boolean;
  readonly createBrowserContextFactory?: (dataDirectory: string) => BrowserContextFactoryPort;
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
    new LoginSession({
      dataDirectory,
      contextFactory: createBrowserContextFactory(dataDirectory)
    });

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
      detector,
      sourceFactory: createArchiveSource
    },
    repositoryFactory: (dataDirectory) =>
      openCliRepositories(
        {
          output,
          errorOutput,
          translator,
          clock,
          delay,
          auditLoggerFactory: (directory) => new NdjsonLogger(directory)
        },
        dataDirectory
      ),
    session: {
      prompt: sessionPrompt,
      createLoginSession,
      confirmAccount: (catalog, input: ConfirmAccountInput): ConfirmedAccountResult =>
        new ConfirmAccount(catalog, { now: clock.now.bind(clock) }).execute(input),
      clearSession: (input: ClearSessionInput): Promise<ClearSessionResult> =>
        new ClearSession(clock.now.bind(clock)).execute(input)
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
      signalFactory: (runId) =>
        options.createSignalAdapter?.(runId, output) ??
        new ProcessSignalAdapter({
          runId,
          resumeMessage: (value) => translator.translate("run.resumeInstruction", { runId: value }),
          writeLine: (message) => output.writeLine(message)
        }),
      getCurrentAccount: async (dataDirectory) =>
        (await createLoginSession(dataDirectory)).execute().then((result) => result.account),
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

function isSessionPrompt(value: Prompt): value is Prompt & SessionPrompt {
  return "confirm" in value && typeof value.confirm === "function";
}
