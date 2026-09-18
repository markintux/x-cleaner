import type {
  PlanRepository,
  CleaningPlanSnapshot
} from "../../../application/ports/plan-repository.js";
import type { RepositoryTransaction } from "../../../application/ports/repository-transaction.js";
import type { InteractionType } from "../../../domain/interaction.js";
import type { CleaningPlan, CleaningPlanItem, CleaningPlanType } from "../../../domain/plan.js";
import type { SqliteDatabase } from "../database.js";
import { connectionFor } from "../repository-transaction.js";

type Row = Record<string, unknown>;

/** Immutable plan snapshots are only inserted; the migration enforces that boundary too. */
export class SqlitePlanRepository implements PlanRepository {
  constructor(private readonly database: SqliteDatabase) {}

  createSnapshot(snapshot: CleaningPlanSnapshot, transaction?: RepositoryTransaction): void {
    const connection = connectionFor(this.database.connection, transaction);
    const write = (): void => {
      for (const type of snapshot.types) {
        connection
          .prepare("INSERT INTO cleaning_plan_types (plan_id, interaction_type) VALUES (?, ?)")
          .run(snapshot.plan.id, type);
      }
      for (const item of snapshot.items) {
        connection
          .prepare(
            `INSERT INTO cleaning_plan_items (plan_id, interaction_id, sequence, created_at)
             VALUES (?, ?, ?, ?)`
          )
          .run(item.planId, item.interactionId, item.sequence, item.createdAt);
      }
      connection
        .prepare(
          `INSERT INTO cleaning_plans (
            id, account_id, catalog_cutoff_id, from_at, to_at, selected_count, locale, reviewed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          snapshot.plan.id,
          snapshot.plan.accountId,
          snapshot.plan.catalogCutoffId,
          snapshot.plan.fromAt,
          snapshot.plan.toAt,
          snapshot.plan.selectedCount,
          snapshot.plan.locale,
          snapshot.plan.reviewedAt,
          snapshot.plan.createdAt
        );
    };

    if (transaction === undefined) {
      this.database.transaction(write);
      return;
    }
    write();
  }

  getSnapshot(planId: string): CleaningPlanSnapshot | null {
    const planRow = this.database.connection
      .prepare("SELECT * FROM cleaning_plans WHERE id = ?")
      .get(planId);
    if (planRow === undefined) {
      return null;
    }
    return {
      plan: mapPlan(planRow as Row),
      types: this.getPlanTypes(planId).map((type) => type.interactionType),
      items: this.database.connection
        .prepare("SELECT * FROM cleaning_plan_items WHERE plan_id = ? ORDER BY sequence")
        .all(planId)
        .map((row) => mapPlanItem(row as Row))
    };
  }

  getPlanTypes(planId: string): readonly CleaningPlanType[] {
    return this.database.connection
      .prepare(
        "SELECT plan_id, interaction_type FROM cleaning_plan_types WHERE plan_id = ? ORDER BY interaction_type"
      )
      .all(planId)
      .map((row) => {
        const value = row as Row;
        return {
          planId: requiredString(value.plan_id),
          interactionType: requiredString(value.interaction_type) as InteractionType
        };
      });
  }
}

function mapPlan(row: Row): CleaningPlan {
  return {
    id: requiredString(row.id),
    accountId: requiredString(row.account_id),
    catalogCutoffId: requiredNumber(row.catalog_cutoff_id),
    fromAt: nullableString(row.from_at),
    toAt: nullableString(row.to_at),
    selectedCount: requiredNumber(row.selected_count),
    locale: requiredString(row.locale),
    reviewedAt: requiredString(row.reviewed_at),
    createdAt: requiredString(row.created_at)
  };
}

function mapPlanItem(row: Row): CleaningPlanItem {
  return {
    planId: requiredString(row.plan_id),
    interactionId: requiredNumber(row.interaction_id),
    sequence: requiredNumber(row.sequence),
    createdAt: requiredString(row.created_at)
  };
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("INVALID_DATABASE_VALUE");
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : requiredString(value);
}

function requiredNumber(value: unknown): number {
  if (typeof value !== "number") {
    throw new Error("INVALID_DATABASE_VALUE");
  }
  return value;
}
