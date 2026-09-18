import type { InteractionType } from "./interaction.js";

export interface CleaningPlan {
  readonly id: string;
  readonly accountId: string;
  readonly catalogCutoffId: number;
  readonly fromAt: string | null;
  readonly toAt: string | null;
  readonly selectedCount: number;
  readonly locale: string;
  readonly reviewedAt: string;
  readonly createdAt: string;
}

export interface CleaningPlanType {
  readonly planId: string;
  readonly interactionType: InteractionType;
}

export interface CleaningPlanItem {
  readonly planId: string;
  readonly interactionId: number;
  readonly sequence: number;
  readonly createdAt: string;
}
