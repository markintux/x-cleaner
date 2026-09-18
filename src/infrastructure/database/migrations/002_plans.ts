import type { DatabaseSync } from "node:sqlite";

import type { Migration } from "../migrator.js";

export const plansMigration: Migration = {
  version: 2,
  name: "002_plans",
  up(connection: DatabaseSync): void {
    connection.exec(`
      CREATE TABLE cleaning_plans (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES managed_accounts (id),
        catalog_cutoff_id INTEGER NOT NULL REFERENCES interactions (id),
        from_at TEXT,
        to_at TEXT,
        selected_count INTEGER NOT NULL CHECK (selected_count > 0),
        locale TEXT NOT NULL DEFAULT 'pt-BR',
        reviewed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX cleaning_plans_account_created_idx ON cleaning_plans (account_id, created_at);

      CREATE TABLE cleaning_plan_types (
        plan_id TEXT NOT NULL REFERENCES cleaning_plans (id) DEFERRABLE INITIALLY DEFERRED,
        interaction_type TEXT NOT NULL CHECK (interaction_type IN ('POST', 'REPLY', 'REPOST', 'LIKE')),
        PRIMARY KEY (plan_id, interaction_type)
      );

      CREATE TABLE cleaning_plan_items (
        plan_id TEXT NOT NULL REFERENCES cleaning_plans (id) DEFERRABLE INITIALLY DEFERRED,
        interaction_id INTEGER NOT NULL REFERENCES interactions (id),
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        created_at TEXT NOT NULL,
        PRIMARY KEY (plan_id, interaction_id),
        UNIQUE (plan_id, sequence)
      );

      CREATE UNIQUE INDEX cleaning_plan_types_pk
        ON cleaning_plan_types (plan_id, interaction_type);
      CREATE UNIQUE INDEX cleaning_plan_items_pk ON cleaning_plan_items (plan_id, interaction_id);
      CREATE UNIQUE INDEX cleaning_plan_items_sequence_uq
        ON cleaning_plan_items (plan_id, sequence);
      CREATE INDEX cleaning_plan_items_interaction_idx ON cleaning_plan_items (interaction_id);

      CREATE TRIGGER cleaning_plans_require_complete_snapshot
      BEFORE INSERT ON cleaning_plans
      WHEN NOT EXISTS (
        SELECT 1 FROM cleaning_plan_types WHERE plan_id = NEW.id
      ) OR (
        SELECT count(*) FROM cleaning_plan_items WHERE plan_id = NEW.id
      ) != NEW.selected_count
      BEGIN
        SELECT RAISE(ABORT, 'INCOMPLETE_CLEANING_PLAN');
      END;

      CREATE TRIGGER cleaning_plans_immutable_update
      BEFORE UPDATE ON cleaning_plans
      BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_CLEANING_PLAN');
      END;

      CREATE TRIGGER cleaning_plans_immutable_delete
      BEFORE DELETE ON cleaning_plans
      BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_CLEANING_PLAN');
      END;

      CREATE TRIGGER cleaning_plan_types_immutable_update
      BEFORE UPDATE ON cleaning_plan_types
      BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_CLEANING_PLAN');
      END;

      CREATE TRIGGER cleaning_plan_types_immutable_delete
      BEFORE DELETE ON cleaning_plan_types
      BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_CLEANING_PLAN');
      END;

      CREATE TRIGGER cleaning_plan_types_immutable_insert
      BEFORE INSERT ON cleaning_plan_types
      WHEN EXISTS (
        SELECT 1 FROM cleaning_plans WHERE id = NEW.plan_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_CLEANING_PLAN');
      END;

      CREATE TRIGGER cleaning_plan_items_immutable_update
      BEFORE UPDATE ON cleaning_plan_items
      BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_CLEANING_PLAN');
      END;

      CREATE TRIGGER cleaning_plan_items_immutable_delete
      BEFORE DELETE ON cleaning_plan_items
      BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_CLEANING_PLAN');
      END;

      CREATE TRIGGER cleaning_plan_items_selected_count
      BEFORE INSERT ON cleaning_plan_items
      BEGIN
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM cleaning_plans WHERE id = NEW.plan_id
        ) THEN RAISE(ABORT, 'IMMUTABLE_CLEANING_PLAN') END;
        SELECT CASE WHEN NEW.sequence != (
          SELECT count(*) + 1 FROM cleaning_plan_items WHERE plan_id = NEW.plan_id
        ) THEN RAISE(ABORT, 'INVALID_CLEANING_PLAN_SEQUENCE') END;
      END;
    `);
  }
};
