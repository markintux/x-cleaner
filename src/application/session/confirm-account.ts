import { randomUUID } from "node:crypto";

import type { CatalogRepository } from "../ports/catalog-repository.js";
import { normalizeAccountHandle, type DetectedAccount } from "../../domain/account.js";
import type { ManagedAccount } from "../../domain/interaction.js";

export interface ConfirmAccountInput {
  readonly account: DetectedAccount;
  readonly confirmed: boolean;
}

export interface ConfirmedAccountResult {
  readonly confirmed: boolean;
  readonly account: ManagedAccount | null;
}

export interface ConfirmAccountOptions {
  readonly now?: () => string;
  readonly idFactory?: () => string;
}

export class AccountConfirmationError extends Error {
  constructor(
    readonly code:
      "ACCOUNT_CONFIRMATION_REQUIRED" | "INVALID_ACCOUNT_HANDLE" | "ACCOUNT_IDENTITY_MISMATCH"
  ) {
    super(code);
    this.name = "AccountConfirmationError";
  }
}

/** Binds one explicitly confirmed browser identity to the singleton local account. */
export class ConfirmAccount {
  readonly #now: () => string;
  readonly #idFactory: () => string;

  constructor(
    private readonly catalog: CatalogRepository,
    options: ConfirmAccountOptions = {}
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? randomUUID;
  }

  execute(input: ConfirmAccountInput): ConfirmedAccountResult {
    const handle = this.normalizeHandle(input.account.handle);
    const current = this.catalog.getManagedAccount();
    if (!input.confirmed) {
      return { confirmed: false, account: current };
    }

    assertIdentityMatches(current, handle, input.account.xUserId);
    const now = this.#now();
    const account = this.catalog.upsertManagedAccount({
      id: current?.id ?? this.#idFactory(),
      xUserId: input.account.xUserId ?? current?.xUserId ?? null,
      archiveHandle: current?.archiveHandle ?? handle,
      confirmedHandle: handle,
      confirmedAt: now
    });
    return { confirmed: true, account };
  }

  confirm(input: ConfirmAccountInput): ConfirmedAccountResult {
    return this.execute(input);
  }

  private normalizeHandle(value: string): string {
    try {
      return normalizeAccountHandle(value);
    } catch {
      throw new AccountConfirmationError("INVALID_ACCOUNT_HANDLE");
    }
  }
}

export function confirmAccount(
  catalog: CatalogRepository,
  input: ConfirmAccountInput,
  options: ConfirmAccountOptions = {}
): ConfirmedAccountResult {
  return new ConfirmAccount(catalog, options).execute(input);
}

function assertIdentityMatches(
  current: ManagedAccount | null,
  browserHandle: string,
  browserUserId: DetectedAccount["xUserId"]
): void {
  if (current === null) {
    return;
  }
  if (current.xUserId !== null && browserUserId !== null && current.xUserId !== browserUserId) {
    throw new AccountConfirmationError("ACCOUNT_IDENTITY_MISMATCH");
  }

  // A matching stable X user ID is stronger evidence than a stale handle from
  // an archive or a previous confirmation (handles can be renamed on X).
  if (current.xUserId !== null && browserUserId === current.xUserId) {
    return;
  }

  const archiveHandle =
    current.archiveHandle === null ? null : normalizeForComparison(current.archiveHandle);
  const confirmedHandle =
    current.confirmedHandle === null ? null : normalizeForComparison(current.confirmedHandle);
  if (
    (archiveHandle !== null && archiveHandle !== browserHandle) ||
    (confirmedHandle !== null && confirmedHandle !== browserHandle)
  ) {
    throw new AccountConfirmationError("ACCOUNT_IDENTITY_MISMATCH");
  }
}

function normalizeForComparison(value: string): string {
  try {
    return normalizeAccountHandle(value);
  } catch {
    return value.trim().replace(/^@+/u, "").toLowerCase();
  }
}
