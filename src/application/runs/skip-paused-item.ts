import type { CatalogRepository } from "../ports/catalog-repository.js";
import type { AuditRepository } from "../ports/audit-repository.js";
import type { ExecutorLockPort } from "../ports/executor-lock.js";
import type { RepositoryTransactionRunner } from "../ports/repository-transaction.js";
import type { RunRepository } from "../ports/run-repository.js";
import type { CleaningRunItem } from "../../domain/run.js";
import type { InteractionType, XInteractionId } from "../../domain/interaction.js";

export interface PausedItemReview {
  readonly item: CleaningRunItem;
  readonly type: InteractionType;
  readonly xInteractionId: XInteractionId;
  readonly interactionCreatedAt: string | null;
}

export interface SkipPausedItemDependencies {
  readonly runs: RunRepository;
  readonly catalog: CatalogRepository;
  readonly audit: AuditRepository;
  readonly transactions: RepositoryTransactionRunner;
  readonly lock: ExecutorLockPort;
}

/** A local owner decision, never a browser action or a successful deletion. */
export class SkipPausedItem {
  constructor(
    private readonly dependencies: SkipPausedItemDependencies,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  review(runId: string): PausedItemReview {
    const { runs, catalog, audit } = this.dependencies;
    const run = runs.getRun(runId);
    if (runs.isRunArchived?.(runId) === true) throw new Error("PAUSED_ITEM_NOT_SKIPPABLE");
    if (run?.status !== "PAUSED" || run.pauseReason !== "UNKNOWN_UI") {
      throw new Error("PAUSED_ITEM_NOT_SKIPPABLE");
    }
    const account = catalog.getManagedAccount();
    if (
      account?.id !== run.accountId ||
      account.confirmedHandle !== run.boundHandle ||
      account.confirmedAt === null
    ) {
      throw new Error("ACCOUNT_MISMATCH");
    }
    if (
      runs.listRunItems(runId).some((item) => item.status === "PROCESSING") ||
      runs.listBatches?.(runId).some((batch) => batch.status === "RUNNING")
    ) {
      throw new Error("RUN_STILL_ACTIVE");
    }
    const item = runs
      .listRunItems(runId)
      .filter((candidate) => candidate.status === "PENDING" && candidate.lastErrorCode !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const attempt = item === undefined ? undefined : audit.listAttempts(item.id).at(-1);
    if (
      item === undefined ||
      attempt?.outcome !== "PAUSED" ||
      attempt.attemptNumber !== item.attemptCount ||
      attempt.errorCode !== item.lastErrorCode
    ) {
      throw new Error("PAUSED_ITEM_NOT_SKIPPABLE");
    }
    const interaction = catalog.getInteraction(item.interactionId);
    if (interaction?.accountId !== run.accountId) throw new Error("ACCOUNT_MISMATCH");
    return {
      item,
      type: interaction.type,
      xInteractionId: interaction.xInteractionId,
      interactionCreatedAt: interaction.interactionCreatedAt
    };
  }

  async execute(runId: string, reviewed: PausedItemReview, confirmation: string): Promise<void> {
    if (confirmation !== "PULAR") throw new Error("SKIP_CONFIRMATION_REQUIRED");
    const { runs, audit, transactions, lock } = this.dependencies;
    const lease = await lock.acquire();
    try {
      transactions.run((transaction) => {
        const current = this.review(runId);
        if (
          current.item.id !== reviewed.item.id ||
          current.item.attemptCount !== reviewed.item.attemptCount ||
          current.item.updatedAt !== reviewed.item.updatedAt ||
          current.item.lastErrorCode !== reviewed.item.lastErrorCode ||
          current.xInteractionId !== reviewed.xInteractionId ||
          current.type !== reviewed.type
        ) {
          throw new Error("PAUSED_ITEM_REVIEW_CHANGED");
        }
        const run = runs.getRun(runId)!;
        const now = this.now();
        runs.updateRunItem(
          current.item.id,
          {
            status: "SKIPPED",
            nextRetryAt: null,
            processingStartedAt: null,
            completedAt: null
          },
          transaction
        );
        const items = runs.listRunItems(runId);
        const counts: Record<string, number> = {};
        for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
        const remaining = items.some((item) => item.status === "PENDING");
        audit.appendCheckpoint(
          {
            runId,
            sequence: audit.listCheckpoints(runId).length + 1,
            reason: remaining ? "ITEM_COMMITTED" : "COMPLETED",
            lastRunItemSequence: current.item.sequence,
            aggregateCountsJson: JSON.stringify(counts),
            createdAt: now
          },
          transaction
        );
        runs.updateRunStatus(
          runId,
          remaining ? "PAUSED" : "COMPLETED",
          {
            pauseReason: null,
            startedAt: run.startedAt,
            pausedAt: remaining ? now : null,
            finishedAt: remaining ? null : now
          },
          transaction
        );
      });
    } finally {
      await lease.release();
    }
  }
}
