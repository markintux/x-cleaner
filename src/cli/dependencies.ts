import { mkdir } from "node:fs/promises";
import path from "node:path";

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
import type { Translator } from "../i18n/translator.js";
import type { DetectedAccount } from "../domain/account.js";
import { migrations } from "../infrastructure/database/migrations/index.js";
import { SqliteDatabase } from "../infrastructure/database/database.js";
import { Migrator } from "../infrastructure/database/migrator.js";
import { SqliteCatalogRepository } from "../infrastructure/database/repositories/sqlite-catalog-repository.js";
import { SqlitePlanRepository } from "../infrastructure/database/repositories/sqlite-plan-repository.js";
import { SqliteRunRepository } from "../infrastructure/database/repositories/sqlite-run-repository.js";
import { SqliteAuditRepository } from "../infrastructure/database/repositories/sqlite-audit-repository.js";
import { UnitOfWork } from "../infrastructure/database/unit-of-work.js";
import { ExecutorLock } from "../infrastructure/lock/executor-lock.js";

export interface CliOutput {
  writeLine(message: string): void;
}

export interface CliRepositories {
  readonly database: SqliteDatabase;
  readonly catalog: CatalogRepository;
  readonly plans: PlanRepository;
  readonly runs?: RunRepository;
  readonly audit?: AuditRepository;
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
  readonly translator: Translator;
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
  new Migrator(database).migrate(migrations);
  const catalog = new SqliteCatalogRepository(database);
  const plans = new SqlitePlanRepository(database);
  const runs = new SqliteRunRepository(database);
  const audit = new SqliteAuditRepository(database);
  return {
    database,
    catalog,
    plans,
    runs,
    audit,
    unitOfWork: new UnitOfWork(database, runs, audit),
    lock: new ExecutorLock(dataDirectory),
    close: () => database.close()
  };
}

export const consoleOutput: CliOutput = {
  writeLine(message) {
    process.stdout.write(`${message}\n`);
  }
};
