import { randomUUID } from "node:crypto";

import type { CatalogRepository } from "../ports/catalog-repository.js";
import type { Clock } from "../ports/clock.js";
import type { PlanRepository } from "../ports/plan-repository.js";
import type { Prompt } from "../ports/prompt.js";
import type { RunRepository } from "../ports/run-repository.js";
import type { DetectedAccount } from "../../domain/account.js";
import { normalizeAccountHandle } from "../../domain/account.js";
import type { CleaningRun, RunBatch } from "../../domain/run.js";
import { safetyError } from "./safety-error.js";

export const DESTRUCTIVE_CONFIRMATION_PHRASE = "APAGAR";

export interface ConfirmBatchInput {
  readonly runId?: string;
  readonly run?: CleaningRun;
  readonly account?: DetectedAccount;
  readonly detectedAccount?: DetectedAccount;
  readonly currentAccount?: DetectedAccount;
  readonly requestedLimit?: number | null;
}

export interface ConfirmBatchOptions {
  readonly now?: () => string;
  readonly clock?: Clock;
  readonly idFactory?: () => string;
  readonly messages?: ConfirmBatchMessages;
}

export interface ConfirmBatchMessages {
  readonly types: (summary: BatchConfirmationSummary) => string;
  readonly total: (summary: BatchConfirmationSummary) => string;
  readonly account: (summary: BatchConfirmationSummary) => string;
  readonly warning: string;
  readonly instruction: string;
  readonly question: string;
}

export interface BatchConfirmationSummary {
  readonly countsByType: Readonly<Record<"POST" | "REPLY" | "REPOST" | "LIKE", number>>;
  readonly totalCount: number;
  readonly handle: string;
}

export interface ConfirmedBatchResult {
  readonly confirmed: boolean;
  readonly canceled: boolean;
  readonly batch: RunBatch | null;
  readonly summary: BatchConfirmationSummary;
}

/** Shows the exact destructive scope and writes a batch only after APAGAR. */
export class ConfirmBatch {
  readonly #now: () => string;
  readonly #idFactory: () => string;
  readonly #messages: ConfirmBatchMessages;

  constructor(
    private readonly plans: PlanRepository,
    private readonly catalog: CatalogRepository,
    private readonly runs: RunRepository,
    private readonly prompt: Prompt,
    options: ConfirmBatchOptions = {}
  ) {
    this.#now =
      options.clock?.now.bind(options.clock) ?? options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#messages = options.messages ?? defaultMessages;
  }

  async execute(input: ConfirmBatchInput): Promise<ConfirmedBatchResult> {
    const run = input.run ?? (input.runId === undefined ? null : this.runs.getRun(input.runId));
    if (run === null) {
      throw safetyError("RUN_NOT_FOUND");
    }
    if (run.status === "COMPLETED" || run.status === "FAILED" || run.status === "INTERRUPTED") {
      throw safetyError("RUN_NOT_RESUMABLE");
    }
    const account = input.account ?? input.detectedAccount ?? input.currentAccount;
    if (account === undefined) {
      throw safetyError("CURRENT_ACCOUNT_REQUIRED");
    }
    const handle = normalizeHandleOrMismatch(account.handle);
    if (handle !== run.boundHandle) {
      throw safetyError("ACCOUNT_MISMATCH");
    }
    const managedAccount = this.catalog.getManagedAccount();
    if (
      managedAccount === null ||
      managedAccount.confirmedHandle === null ||
      managedAccount.confirmedAt === null
    ) {
      throw safetyError("CONFIRMED_ACCOUNT_REQUIRED");
    }
    if (normalizeHandleOrMismatch(managedAccount.confirmedHandle) !== handle) {
      throw safetyError("ACCOUNT_MISMATCH");
    }
    if (
      managedAccount.xUserId !== null &&
      account.xUserId !== null &&
      managedAccount.xUserId !== account.xUserId
    ) {
      throw safetyError("ACCOUNT_MISMATCH");
    }
    if (managedAccount.id !== run.accountId) {
      throw safetyError("ACCOUNT_MISMATCH");
    }

    const snapshot = this.plans.getSnapshot(run.planId);
    if (snapshot === null || snapshot.plan.reviewedAt.trim() === "") {
      throw safetyError("REVIEWED_PLAN_REQUIRED");
    }
    if (
      snapshot.plan.selectedCount <= 0 ||
      snapshot.items.length === 0 ||
      snapshot.items.length !== snapshot.plan.selectedCount
    ) {
      throw safetyError("PLAN_EMPTY");
    }
    if (snapshot.plan.accountId !== run.accountId) {
      throw safetyError("ACCOUNT_MISMATCH");
    }

    const requestedLimit = validateLimit(input.requestedLimit);
    const summary = this.summarize(
      snapshot.items.map((item) => item.interactionId),
      handle
    );
    this.prompt.writeLine(this.#messages.types(summary));
    this.prompt.writeLine(this.#messages.total(summary));
    this.prompt.writeLine(this.#messages.account(summary));
    this.prompt.writeLine(this.#messages.warning);
    this.prompt.writeLine(this.#messages.instruction);
    const answer = await this.prompt.ask(this.#messages.question);
    if (answer !== DESTRUCTIVE_CONFIRMATION_PHRASE) {
      return { confirmed: false, canceled: true, batch: null, summary };
    }

    const now = this.#now();
    const batch: RunBatch = {
      id: this.#idFactory(),
      runId: run.id,
      requestedLimit,
      confirmedAt: now,
      status: "RUNNING",
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.runs.createBatch(batch);
    return { confirmed: true, canceled: false, batch, summary };
  }

  private summarize(interactionIds: readonly number[], handle: string): BatchConfirmationSummary {
    const countsByType = { POST: 0, REPLY: 0, REPOST: 0, LIKE: 0 } as Record<
      "POST" | "REPLY" | "REPOST" | "LIKE",
      number
    >;
    for (const interactionId of interactionIds) {
      const interaction = this.catalog.getInteraction(interactionId);
      if (interaction === null) {
        throw safetyError("PLAN_SNAPSHOT_INVALID");
      }
      countsByType[interaction.type] += 1;
    }
    return { countsByType, totalCount: interactionIds.length, handle };
  }
}

export async function confirmBatch(
  plans: PlanRepository,
  catalog: CatalogRepository,
  runs: RunRepository,
  prompt: Prompt,
  input: ConfirmBatchInput,
  options: ConfirmBatchOptions = {}
): Promise<ConfirmedBatchResult> {
  return new ConfirmBatch(plans, catalog, runs, prompt, options).execute(input);
}

function validateLimit(value: number | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw safetyError("INVALID_BATCH_LIMIT");
  }
  return value;
}

function normalizeHandleOrMismatch(value: string): string {
  try {
    return normalizeAccountHandle(value);
  } catch {
    throw safetyError("ACCOUNT_MISMATCH");
  }
}

const defaultMessages: ConfirmBatchMessages = {
  types: (summary) =>
    `Tipos selecionados: POST=${summary.countsByType.POST}, REPLY=${summary.countsByType.REPLY}, REPOST=${summary.countsByType.REPOST}, LIKE=${summary.countsByType.LIKE}`,
  total: (summary) => `Total: ${summary.totalCount}`,
  account: (summary) => `Conta vinculada: @${summary.handle}`,
  warning: "AVISO: esta ação é irreversível e altera sua conta no X.",
  instruction: `Digite exatamente ${DESTRUCTIVE_CONFIRMATION_PHRASE} para continuar.`,
  question: "Confirmação:"
};
