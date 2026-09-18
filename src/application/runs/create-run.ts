import { randomUUID } from "node:crypto";

import type { CatalogRepository } from "../ports/catalog-repository.js";
import type { PlanRepository } from "../ports/plan-repository.js";
import type { RunRepository } from "../ports/run-repository.js";
import type { DetectedAccount } from "../../domain/account.js";
import { normalizeAccountHandle } from "../../domain/account.js";
import type { CleaningRun } from "../../domain/run.js";
import { safetyError } from "./safety-error.js";

export interface CreateRunInput {
  readonly planId: string;
  readonly account?: DetectedAccount;
  readonly detectedAccount?: DetectedAccount;
  readonly currentAccount?: DetectedAccount;
}

export interface CreateRunOptions {
  readonly now?: () => string;
  readonly idFactory?: () => string;
}

export interface CreatedRun {
  readonly run: CleaningRun;
}

/** Creates the one durable run materialized from one immutable reviewed plan. */
export class CreateRun {
  readonly #now: () => string;
  readonly #idFactory: () => string;

  constructor(
    private readonly plans: PlanRepository,
    private readonly catalog: CatalogRepository,
    private readonly runs: RunRepository,
    options: CreateRunOptions = {}
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? randomUUID;
  }

  execute(input: CreateRunInput): CreatedRun {
    const snapshot = this.plans.getSnapshot(input.planId);
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

    const storedAccount = this.catalog.getManagedAccount();
    if (
      storedAccount === null ||
      storedAccount.confirmedHandle === null ||
      storedAccount.confirmedAt === null
    ) {
      throw safetyError("CONFIRMED_ACCOUNT_REQUIRED");
    }
    if (snapshot.plan.accountId !== storedAccount.id) {
      throw safetyError("ACCOUNT_MISMATCH");
    }

    const account = input.account ?? input.detectedAccount ?? input.currentAccount;
    if (account === undefined) {
      throw safetyError("CURRENT_ACCOUNT_REQUIRED");
    }
    const currentHandle = normalizeHandleOrMismatch(account.handle);
    const boundHandle = normalizeHandleOrMismatch(storedAccount.confirmedHandle);
    if (currentHandle !== boundHandle) {
      throw safetyError("ACCOUNT_MISMATCH");
    }
    if (
      storedAccount.xUserId !== null &&
      account.xUserId !== null &&
      storedAccount.xUserId !== account.xUserId
    ) {
      throw safetyError("ACCOUNT_MISMATCH");
    }

    if (this.runs.getRunForPlan(input.planId) !== null) {
      throw safetyError("RUN_ALREADY_EXISTS");
    }

    const now = this.#now();
    const run: CleaningRun = {
      id: this.#idFactory(),
      planId: snapshot.plan.id,
      accountId: storedAccount.id,
      boundHandle,
      status: "PENDING",
      pauseReason: null,
      startedAt: null,
      pausedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now
    };

    // SqliteRunRepository creates the header and ordered child rows in one
    // repository transaction. Other adapters must preserve that same port
    // contract.
    this.runs.createRun(run);
    return { run };
  }
}

export function createRun(
  plans: PlanRepository,
  catalog: CatalogRepository,
  runs: RunRepository,
  input: CreateRunInput,
  options: CreateRunOptions = {}
): CreatedRun {
  return new CreateRun(plans, catalog, runs, options).execute(input);
}

function normalizeHandleOrMismatch(value: string): string {
  try {
    return normalizeAccountHandle(value);
  } catch {
    throw safetyError("ACCOUNT_MISMATCH");
  }
}
