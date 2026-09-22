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
import type { ArchiveParser } from "../application/ports/archive-parser.js";
import type { ArchiveSource } from "../application/ports/archive-source.js";
import type { RepositoryTransactionRunner } from "../application/ports/repository-transaction.js";
import type { Translator } from "../i18n/translator.js";
import type { DetectedAccount } from "../domain/account.js";
import type { RunReport } from "../application/reports/generate-run-report.js";
import type { ExecuteBatchSignal } from "../application/runs/execute-batch.js";
import type { ExecutionProgressReporter } from "../application/ports/execution-progress.js";

export interface BrowserEngineOptions {
  readonly dataDirectory: string;
  readonly confirmedHandle: string;
}

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
  readonly parser: ArchiveParser;
  readonly sourceFactory: (input: string) => ArchiveSource | Promise<ArchiveSource>;
}

export interface CliRepositories {
  readonly transactions: RepositoryTransactionRunner;
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
  readonly delayMilliseconds?: number;
  readonly progress?: ExecutionProgressReporter;
  readonly lock?: ExecutorLockPort;
  readonly signalFactory?: (runId: string) => CliSignalAdapter;
  readonly createBrowserEngine?: (options: BrowserEngineOptions) => CleanerEngine;
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

  throw new Error("REPOSITORY_FACTORY_NOT_CONFIGURED");
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
