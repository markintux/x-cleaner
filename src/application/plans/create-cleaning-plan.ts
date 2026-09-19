import { randomUUID } from "node:crypto";

import type { CatalogRepository } from "../ports/catalog-repository.js";
import type { PlanRepository } from "../ports/plan-repository.js";
import type { InteractionType } from "../../domain/interaction.js";
import {
  assertNonEmptySelection,
  SelectionValidationError,
  validateSelection,
  type SelectionFilters,
  type SelectionInput
} from "../../domain/selection.js";
import type { CleaningPlan, CleaningPlanItem } from "../../domain/plan.js";
import type { RepositoryTransactionRunner } from "../ports/repository-transaction.js";

export interface CreateCleaningPlanInput extends SelectionInput {
  readonly accountId?: string;
  readonly locale?: string;
}

export interface CreateCleaningPlanOptions {
  readonly now?: () => string;
  readonly idFactory?: () => string;
}

export interface CreatedCleaningPlan {
  readonly plan: CleaningPlan;
  readonly filters: SelectionFilters;
  readonly types: readonly InteractionType[];
  readonly items: readonly CleaningPlanItem[];
}

/**
 * Resolves and materializes a plan while the catalog boundary is held in one
 * SQLite transaction. The plan repository inserts its child snapshot rows
 * before the immutable plan header, as required by the schema triggers.
 */
export class CreateCleaningPlan {
  readonly #now: () => string;
  readonly #idFactory: () => string;

  constructor(
    private readonly transactions: RepositoryTransactionRunner,
    private readonly catalog: CatalogRepository,
    private readonly plans: PlanRepository,
    options: CreateCleaningPlanOptions = {}
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? randomUUID;
  }

  execute(input: CreateCleaningPlanInput): CreatedCleaningPlan {
    const filters = validateSelection(input);
    const account = this.catalog.getManagedAccount();
    if (account === null) {
      throw new Error("ACCOUNT_NOT_FOUND");
    }
    const accountId = input.accountId ?? account.id;
    if (account.id !== accountId) {
      throw new Error("ACCOUNT_MISMATCH");
    }

    const now = this.#now();
    let result: CreatedCleaningPlan | undefined;
    this.transactions.run((transaction) => {
      const catalogCutoffId = this.catalog.getHighestInteractionId(accountId, transaction);
      if (catalogCutoffId === null) {
        throw new SelectionValidationError("SELECTION_EMPTY");
      }

      const selected = this.catalog.selectInteractions(
        accountId,
        filters,
        catalogCutoffId,
        transaction
      );
      assertNonEmptySelection(selected);

      const plan: CleaningPlan = {
        id: this.#idFactory(),
        accountId,
        catalogCutoffId,
        fromAt: filters.fromAt,
        toAt: filters.toAt,
        selectedCount: selected.length,
        locale: input.locale ?? "pt-BR",
        reviewedAt: now,
        createdAt: now
      };
      const items: CleaningPlanItem[] = selected.map((item, index) => ({
        planId: plan.id,
        interactionId: item.id,
        sequence: index + 1,
        createdAt: now
      }));
      this.plans.createSnapshot(
        {
          plan,
          types: filters.types,
          items
        },
        transaction
      );
      result = { plan, filters, types: filters.types, items };
    });

    if (result === undefined) {
      throw new Error("CLEANING_PLAN_RESULT_MISSING");
    }
    return result;
  }
}

export function createCleaningPlan(
  transactions: RepositoryTransactionRunner,
  catalog: CatalogRepository,
  plans: PlanRepository,
  input: CreateCleaningPlanInput,
  options: CreateCleaningPlanOptions = {}
): CreatedCleaningPlan {
  return new CreateCleaningPlan(transactions, catalog, plans, options).execute(input);
}
