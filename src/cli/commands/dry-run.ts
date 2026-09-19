import { createCleaningPlan } from "../../application/plans/create-cleaning-plan.js";
import { recordAudit } from "../../application/ports/audit-logger.js";
import { SelectionValidationError, type SelectionInput } from "../../domain/selection.js";
import type { InteractionType } from "../../domain/interaction.js";
import {
  openCliRepositories,
  type CliDependencies,
  type CliRepositories,
  resolveCliDataDirectory
} from "../dependencies.js";

export interface DryRunCommandOptions {
  readonly dataDir?: string;
  readonly type?: readonly string[];
  readonly from?: string;
  readonly to?: string;
}

export interface DryRunCommandResult {
  readonly planId: string;
  readonly totalCount: number;
  readonly countsByType: Readonly<Record<InteractionType, number>>;
}

export function createDryRunCommand(
  dependencies: CliDependencies
): (options: DryRunCommandOptions) => Promise<DryRunCommandResult> {
  return async (options) => {
    const dataDirectory = resolveCliDataDirectory(dependencies, options.dataDir);
    const repositories = await openRepositories(dependencies, dataDirectory);
    try {
      const input: SelectionInput = {
        types: options.type ?? [],
        from: options.from ?? null,
        to: options.to ?? null
      };
      const result = createCleaningPlan(
        repositories.transactions,
        repositories.catalog,
        repositories.plans,
        input,
        dependencies.clock === undefined
          ? {}
          : { now: dependencies.clock.now.bind(dependencies.clock) }
      );
      // The plan stores exact item IDs; derive type counts without loading
      // content by resolving the same lightweight selection rows.
      const selectedRows = repositories.catalog.selectInteractions(
        result.plan.accountId,
        result.filters,
        result.plan.catalogCutoffId
      );
      const actualCounts = countPlanItems(result.items, selectedRows);
      const auditLogger = dependencies.auditLogger ?? repositories.auditLogger;
      await recordAudit(auditLogger, {
        event: "plan.created",
        timestamp: result.plan.createdAt,
        planId: result.plan.id,
        filters: {
          types: result.types,
          from: result.filters.fromAt,
          to: result.filters.toAt
        },
        countsByType: actualCounts,
        total: result.items.length
      });
      await recordAudit(auditLogger, {
        event: "plan.previewed",
        timestamp: result.plan.reviewedAt,
        planId: result.plan.id,
        countsByType: actualCounts,
        total: result.items.length
      });
      dependencies.output.writeLine(dependencies.translator.translate("dryRun.notice"));
      dependencies.output.writeLine(dependencies.translator.translate("dryRun.noMutation"));
      dependencies.output.writeLine(
        dependencies.translator.translate("dryRun.planId", { planId: result.plan.id })
      );
      dependencies.output.writeLine(
        dependencies.translator.translate("dryRun.types", { types: result.types.join(", ") })
      );
      if (result.filters.fromAt !== null) {
        dependencies.output.writeLine(
          dependencies.translator.translate("dryRun.from", { from: result.filters.fromAt })
        );
      }
      if (result.filters.toAt !== null) {
        dependencies.output.writeLine(
          dependencies.translator.translate("dryRun.to", { to: result.filters.toAt })
        );
      }
      for (const [type, count] of Object.entries(actualCounts)) {
        dependencies.output.writeLine(
          dependencies.translator.translate("dryRun.typeCount", { type, count })
        );
      }
      dependencies.output.writeLine(
        dependencies.translator.translate("dryRun.total", { count: result.items.length })
      );
      return {
        planId: result.plan.id,
        totalCount: result.items.length,
        countsByType: actualCounts
      };
    } catch (error) {
      if (error instanceof SelectionValidationError) {
        dependencies.output.writeLine(
          dependencies.translator.translate("selection.error", { errorCode: error.code })
        );
        if (error.code === "SELECTION_EMPTY") {
          dependencies.output.writeLine(dependencies.translator.translate("dryRun.empty"));
        }
      }
      throw error;
    } finally {
      repositories.close?.();
    }
  };
}

function countPlanItems(
  items: readonly { readonly interactionId: number }[],
  selectedRows: readonly { readonly id: number; readonly type: InteractionType }[]
): Record<InteractionType, number> {
  const typesById = new Map(selectedRows.map((row) => [row.id, row.type]));
  const counts: Record<InteractionType, number> = { POST: 0, REPLY: 0, REPOST: 0, LIKE: 0 };
  for (const item of items) {
    const type = typesById.get(item.interactionId);
    if (type !== undefined) counts[type] += 1;
  }
  return counts;
}

async function openRepositories(
  dependencies: CliDependencies,
  dataDirectory: string
): Promise<CliRepositories> {
  return openCliRepositories(dependencies, dataDirectory);
}
