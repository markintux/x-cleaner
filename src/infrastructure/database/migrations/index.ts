import type { Migration } from "../migrator.js";

import { catalogMigration } from "./001_catalog.js";
import { plansMigration } from "./002_plans.js";
import { runsMigration } from "./003_runs.js";
import { auditMigration } from "./004_audit.js";

import { runArchivingMigration } from "./005_run_archiving.js";

export const migrations: readonly Migration[] = [
  catalogMigration,
  plansMigration,
  runsMigration,
  auditMigration,
  runArchivingMigration
];
