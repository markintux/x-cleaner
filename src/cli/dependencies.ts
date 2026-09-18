import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { CatalogRepository } from "../application/ports/catalog-repository.js";
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
import { migrations } from "../infrastructure/database/migrations/index.js";
import { SqliteDatabase } from "../infrastructure/database/database.js";
import { Migrator } from "../infrastructure/database/migrator.js";
import { SqliteCatalogRepository } from "../infrastructure/database/repositories/sqlite-catalog-repository.js";
import { SqlitePlanRepository } from "../infrastructure/database/repositories/sqlite-plan-repository.js";

export interface CliOutput {
  writeLine(message: string): void;
}

export interface CliRepositories {
  readonly database: SqliteDatabase;
  readonly catalog: CatalogRepository;
  readonly plans: PlanRepository;
  readonly close?: () => void;
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
  readonly cleanerEngine?: (...arguments_: readonly unknown[]) => unknown;
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
  return {
    database,
    catalog: new SqliteCatalogRepository(database),
    plans: new SqlitePlanRepository(database),
    close: () => database.close()
  };
}

export const consoleOutput: CliOutput = {
  writeLine(message) {
    process.stdout.write(`${message}\n`);
  }
};
