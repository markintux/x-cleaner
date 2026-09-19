import { mkdir } from "node:fs/promises";
import path from "node:path";

import { resolveApplicationDataDirectory } from "../platform/application-data.js";
import type { CatalogRepository } from "../application/ports/catalog-repository.js";
import type { CleanerEngine } from "../application/ports/cleaner-engine.js";
import type { Clock } from "../application/ports/clock.js";
import type { Delay } from "../application/ports/delay.js";
import type { ExecutorLockPort } from "../application/ports/executor-lock.js";
import type { Prompt } from "../application/ports/prompt.js";
import type { AuditRepository } from "../application/ports/audit-repository.js";
import type { RunRepository } from "../application/ports/run-repository.js";
import type { ExecutionUnitOfWork } from "../application/ports/execution-unit-of-work.js";
import type {
  ConfirmAccountInput,
  ConfirmedAccountResult
} from "../application/session/confirm-account.js";
import type {
  ClearSessionInput,
  ClearSessionResult
} from "../application/session/clear-session.js";
import type { LoginSessionResult } from "../application/session/login-session.js";
import type { PlanRepository } from "../application/ports/plan-repository.js";
import type { ReportRepository } from "../application/ports/report-repository.js";
import type { AuditLogger } from "../application/ports/audit-logger.js";
import type { Translator } from "../i18n/translator.js";
import type { DetectedAccount } from "../domain/account.js";
import type { RunReport } from "../application/reports/generate-run-report.js";
import type { ArchiveDetector } from "../infrastructure/archive/archive-detector.js";
import type { ImportArchiveOptions } from "../application/import/import-archive.js";
import type { ExecuteBatchSignal } from "../application/runs/execute-batch.js";
import { migrations } from "../infrastructure/database/migrations/index.js";
import { SqliteDatabase } from "../infrastructure/database/database.js";
import { Migrator } from "../infrastructure/database/migrator.js";
import { SqliteCatalogRepository } from "../infrastructure/database/repositories/sqlite-catalog-repository.js";
import { SqlitePlanRepository } from "../infrastructure/database/repositories/sqlite-plan-repository.js";
import { SqliteRunRepository } from "../infrastructure/database/repositories/sqlite-run-repository.js";
import { SqliteAuditRepository } from "../infrastructure/database/repositories/sqlite-audit-repository.js";
import { SqliteReportRepository } from "../infrastructure/database/repositories/sqlite-report-repository.js";
import { NdjsonLogger } from "../infrastructure/logging/ndjson-logger.js";
import { UnitOfWork } from "../infrastructure/database/unit-of-work.js";
import { ExecutorLock } from "../infrastructure/lock/executor-lock.js";
import {
  BrowserCleanerEngine,
  type BrowserCleanerEngineOptions
} from "../infrastructure/browser/browser-cleaner-engine.js";

export interface CliOutput {
  writeLine(message: string): void;
}

export interface CliSignalAdapter extends ExecuteBatchSignal {
  install(): () => void;
  uninstall(): void;
}

export interface CliReportWriter {
  write(report: RunReport): Promise<{
    readonly relativePath: string;
    readonly sha256: string;
  }>;
}

export interface CliArchiveDependencies {
  readonly detector?: ArchiveDetector;
  readonly sourceFactory?: ImportArchiveOptions["sourceFactory"];
}

export interface CliRepositories {
  readonly database: SqliteDatabase;
  readonly catalog: CatalogRepository;
  readonly plans: PlanRepository;
  readonly runs?: RunRepository;
  readonly audit?: AuditRepository;
  readonly reports?: ReportRepository;
  readonly auditLogger?: AuditLogger;
  readonly unitOfWork?: ExecutionUnitOfWork;
  readonly lock?: ExecutorLockPort;
  readonly close?: () => void;
}

export interface RunCliDependencies {
  readonly prompt?: Prompt;
  readonly engine?: CleanerEngine;
  readonly cleanerEngine?: CleanerEngine;
  readonly currentAccount?: DetectedAccount;
  readonly getCurrentAccount?: (dataDirectory: string) => Promise<DetectedAccount | null>;
  readonly clock?: Clock;
  readonly delay?: Delay;
  readonly lock?: ExecutorLockPort;
  readonly signalFactory?: (runId: string) => CliSignalAdapter;
  readonly createBrowserEngine?: (options: BrowserCleanerEngineOptions) => CleanerEngine;
}

export interface SessionPrompt {
  confirm(question: string): Promise<boolean>;
}

export interface SessionLoginRunner {
  execute(): Promise<LoginSessionResult>;
}

export interface SessionCliDependencies {
  readonly prompt?: SessionPrompt;
  readonly createLoginSession?: (
    dataDirectory: string
  ) => SessionLoginRunner | Promise<SessionLoginRunner>;
  readonly confirmAccount?: (
    catalog: CatalogRepository,
    input: ConfirmAccountInput
  ) => ConfirmedAccountResult;
  readonly clearSession?: (input: ClearSessionInput) => Promise<ClearSessionResult>;
}

export interface CliDependencies {
  readonly output: CliOutput;
  readonly errorOutput?: CliOutput;
  readonly translator: Translator;
  readonly clock?: Clock;
  readonly delay?: Delay;
  readonly diagnostics?: boolean;
  readonly resolveDataDirectory?: (override?: string) => string;
  /** Read-only commands must never access this future destructive boundary. */
  readonly cleanerEngine?: CleanerEngine | ((...arguments_: readonly unknown[]) => unknown);
  readonly prompt?: Prompt;
  readonly currentAccount?: DetectedAccount;
  readonly getCurrentAccount?: (dataDirectory: string) => Promise<DetectedAccount | null>;
  readonly run?: RunCliDependencies;
  /** Static repositories are useful for command integration tests. */
  readonly repositories?: CliRepositories;
  /** A test/application-specific repository boundary for a resolved data dir. */
  readonly repositoryFactory?: (
    dataDirectory: string
  ) => CliRepositories | Promise<CliRepositories>;
  readonly session?: SessionCliDependencies;
  readonly auditLogger?: AuditLogger;
  readonly auditLoggerFactory?: (dataDirectory: string) => AuditLogger;
  readonly archive?: CliArchiveDependencies;
  readonly reportWriterFactory?: (
    dataDirectory: string,
    reports: ReportRepository | undefined
  ) => CliReportWriter;
}

export function resolveCliDataDirectory(dependencies: CliDependencies, override?: string): string {
  return (
    dependencies.resolveDataDirectory?.(override) ??
    resolveApplicationDataDirectory(override === undefined ? {} : { dataDir: override })
  );
}

export async function openCliRepositories(
  dependencies: CliDependencies,
  dataDirectory: string
): Promise<CliRepositories> {
  if (dependencies.repositoryFactory !== undefined) {
    return dependencies.repositoryFactory(dataDirectory);
  }
  if (dependencies.repositories !== undefined) {
    return dependencies.repositories;
  }

  await mkdir(dataDirectory, { recursive: true });
  const database = new SqliteDatabase(path.join(dataDirectory, "state.sqlite"));
  const now = dependencies.clock?.now.bind(dependencies.clock);
  const migratorOptions = now === undefined ? {} : { now };
  new Migrator(database, migratorOptions).migrate(migrations);
  const catalogOptions = now === undefined ? {} : { now };
  const catalog = new SqliteCatalogRepository(database, catalogOptions);
  const plans = new SqlitePlanRepository(database);
  const runs = new SqliteRunRepository(database, catalogOptions);
  const audit = new SqliteAuditRepository(database);
  const reports = new SqliteReportRepository(database);
  const lockOptions = now === undefined ? {} : { now };
  return {
    database,
    catalog,
    plans,
    runs,
    audit,
    reports,
    auditLogger:
      dependencies.auditLogger ??
      dependencies.auditLoggerFactory?.(dataDirectory) ??
      new NdjsonLogger(dataDirectory),
    unitOfWork: new UnitOfWork(database, runs, audit),
    lock: new ExecutorLock(dataDirectory, lockOptions),
    close: () => database.close()
  };
}

export const consoleOutput: CliOutput = {
  writeLine(message) {
    process.stdout.write(`${message}\n`);
  }
};

export const consoleErrorOutput: CliOutput = {
  writeLine(message) {
    process.stderr.write(`${message}\n`);
  }
};

/**
 * Creates the real browser boundary for a confirmed destructive run only.
 * The constructor is lazy with respect to Playwright; the context is launched
 * by the engine on the first item after Core has accepted the batch.
 */
export function createConfirmedBrowserEngine(
  dataDirectory: string,
  confirmedHandle: string
): CleanerEngine {
  return new BrowserCleanerEngine({ dataDirectory, confirmedHandle });
}
