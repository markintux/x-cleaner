import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { xInteractionId, xUserId } from "../../src/domain/interaction.js";
import type { InteractionType } from "../../src/domain/interaction.js";
import type { CleaningPlan } from "../../src/domain/plan.js";
import { SqliteDatabase } from "../../src/infrastructure/database/database.js";
import { migrations } from "../../src/infrastructure/database/migrations/index.js";
import { Migrator } from "../../src/infrastructure/database/migrator.js";
import { SqliteAuditRepository } from "../../src/infrastructure/database/repositories/sqlite-audit-repository.js";
import { SqliteRepositoryTransactionRunner } from "../../src/infrastructure/database/repository-transaction.js";
import { SqliteCatalogRepository } from "../../src/infrastructure/database/repositories/sqlite-catalog-repository.js";
import { SqlitePlanRepository } from "../../src/infrastructure/database/repositories/sqlite-plan-repository.js";
import { SqliteRunRepository } from "../../src/infrastructure/database/repositories/sqlite-run-repository.js";

export const fixedNow = "2026-03-04T05:06:07.000Z";
export const digest = "a".repeat(64);

export interface DatabaseFixture {
  readonly directory: string;
  readonly database: SqliteDatabase;
  readonly transactions: SqliteRepositoryTransactionRunner;
  readonly catalog: SqliteCatalogRepository;
  readonly plans: SqlitePlanRepository;
  readonly runs: SqliteRunRepository;
  readonly audit: SqliteAuditRepository;
  cleanup(): Promise<void>;
}

export async function createDatabaseFixture(): Promise<DatabaseFixture> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-phase-3-"));
  const database = new SqliteDatabase(path.join(directory, "state.sqlite"));
  new Migrator(database, { now: () => fixedNow }).migrate(migrations);
  const catalog = new SqliteCatalogRepository(database, { now: () => fixedNow });
  return {
    directory,
    database,
    transactions: new SqliteRepositoryTransactionRunner(database),
    catalog,
    plans: new SqlitePlanRepository(database),
    runs: new SqliteRunRepository(database, { now: () => fixedNow }),
    audit: new SqliteAuditRepository(database),
    cleanup: async (): Promise<void> => {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  };
}

export function seedCatalog(
  fixture: DatabaseFixture,
  suffix = "1"
): {
  readonly accountId: string;
  readonly importId: string;
} {
  const accountId = `account-${suffix}`;
  const importId = `import-${suffix}`;
  fixture.catalog.upsertManagedAccount({
    id: accountId,
    xUserId: xUserId(`9007199254740993${suffix}`),
    archiveHandle: `synthetic-${suffix}`,
    confirmedHandle: null,
    confirmedAt: null
  });
  fixture.catalog.createArchiveImport({
    id: importId,
    accountId,
    sourceKind: "DIRECTORY",
    sourceLabel: `synthetic-${suffix}`,
    sourceSha256: digest,
    adapterKey: "synthetic-ytd",
    status: "COMPLETED",
    startedAt: fixedNow,
    finishedAt: fixedNow
  });
  return { accountId, importId };
}

export function addInteraction(
  fixture: DatabaseFixture,
  accountId: string,
  importId: string,
  sequence: number,
  type: "POST" | "REPLY" | "REPOST" | "LIKE" = "POST"
): number {
  return fixture.catalog.upsertInteraction({
    accountId,
    xInteractionId: xInteractionId(`90071992547409930${sequence}`),
    type,
    interactionCreatedAt: fixedNow,
    contentPreview: `conteúdo sintético ${sequence}`,
    sourceRelativePath: `data/${type.toLowerCase()}s.js`,
    sourceRecordKey: String(sequence),
    importId
  }).interaction.id;
}

export function createPlan(
  fixture: DatabaseFixture,
  accountId: string,
  interactionIds: readonly number[],
  types: readonly InteractionType[] = ["POST"]
): CleaningPlan {
  const plan: CleaningPlan = {
    id: `plan-${interactionIds.join("-")}`,
    accountId,
    catalogCutoffId: Math.max(...interactionIds),
    fromAt: null,
    toAt: null,
    selectedCount: interactionIds.length,
    locale: "pt-BR",
    reviewedAt: fixedNow,
    createdAt: fixedNow
  };
  fixture.plans.createSnapshot({
    plan,
    types,
    items: interactionIds.map((interactionId, index) => ({
      planId: plan.id,
      interactionId,
      sequence: index + 1,
      createdAt: fixedNow
    }))
  });
  return plan;
}
