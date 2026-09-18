import type { InteractionType } from "../../domain/interaction.js";
import type { CleaningPlan, CleaningPlanItem, CleaningPlanType } from "../../domain/plan.js";
import type { RepositoryTransaction } from "./repository-transaction.js";

export interface CleaningPlanSnapshot {
  readonly plan: CleaningPlan;
  readonly types: readonly InteractionType[];
  readonly items: readonly CleaningPlanItem[];
}

export interface PlanRepository {
  createSnapshot(snapshot: CleaningPlanSnapshot, transaction?: RepositoryTransaction): void;
  getSnapshot(planId: string): CleaningPlanSnapshot | null;
  getPlanTypes(planId: string): readonly CleaningPlanType[];
}
