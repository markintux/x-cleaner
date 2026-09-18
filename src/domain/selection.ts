import { interactionTypes, isInteractionType, type InteractionType } from "./interaction.js";

export const selectionErrorCodes = [
  "SELECTION_EMPTY",
  "SELECTION_TYPE_UNSUPPORTED",
  "SELECTION_DATE_INVALID",
  "SELECTION_DATE_RANGE_INVERTED"
] as const;

export type SelectionErrorCode = (typeof selectionErrorCodes)[number];

export interface SelectionInput {
  readonly types?: readonly string[];
  readonly from?: string | null;
  readonly to?: string | null;
  readonly fromAt?: string | null;
  readonly toAt?: string | null;
}

/** Normalized, language-neutral criteria shared by dry-run and execution. */
export interface SelectionFilters {
  readonly types: readonly InteractionType[];
  readonly fromAt: string | null;
  readonly toAt: string | null;
}

export class SelectionValidationError extends Error {
  constructor(
    readonly code: SelectionErrorCode,
    readonly details?: Readonly<Record<string, string>>
  ) {
    super(code);
    this.name = "SelectionValidationError";
  }
}

/**
 * Validates CLI/application selection input and normalizes all dates to UTC.
 * Date-only `from` values cover the start of that day and date-only `to`
 * values cover its end, making both boundaries inclusive.
 */
export function validateSelection(input: SelectionInput): SelectionFilters {
  const types = normalizeTypes(input.types);
  const fromAt = normalizeBoundary(input.fromAt ?? input.from ?? null, "from");
  const toAt = normalizeBoundary(input.toAt ?? input.to ?? null, "to");

  if (fromAt !== null && toAt !== null && fromAt > toAt) {
    throw new SelectionValidationError("SELECTION_DATE_RANGE_INVERTED", {
      from: fromAt,
      to: toAt
    });
  }

  return { types, fromAt, toAt };
}

export const parseSelection = validateSelection;

/** Rejects a valid filter which resolved to no catalog items. */
export function assertNonEmptySelection(items: readonly unknown[]): void {
  if (items.length === 0) {
    throw new SelectionValidationError("SELECTION_EMPTY");
  }
}

function normalizeTypes(values: readonly string[] | undefined): readonly InteractionType[] {
  if (values === undefined || values.length === 0) {
    throw new SelectionValidationError("SELECTION_EMPTY");
  }

  const normalized: InteractionType[] = [];
  for (const value of values) {
    const candidate = value.trim().toUpperCase();
    if (!isInteractionType(candidate)) {
      throw new SelectionValidationError("SELECTION_TYPE_UNSUPPORTED", { type: value });
    }
    if (!normalized.includes(candidate)) {
      normalized.push(candidate);
    }
  }

  return normalized;
}

function normalizeBoundary(value: string | null, side: "from" | "to"): string | null {
  if (value === null) {
    return null;
  }

  const candidate = value.trim();
  if (candidate.length === 0) {
    throw new SelectionValidationError("SELECTION_DATE_INVALID", { field: side });
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(candidate);
  if (dateOnly !== null) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new SelectionValidationError("SELECTION_DATE_INVALID", { field: side });
    }
    if (side === "from") {
      return date.toISOString();
    }
    date.setUTCHours(23, 59, 59, 999);
    return date.toISOString();
  }

  // Require an ISO timestamp with an explicit timezone. This avoids silently
  // interpreting a user's local timezone differently on another machine.
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u.test(candidate)
  ) {
    throw new SelectionValidationError("SELECTION_DATE_INVALID", { field: side });
  }

  const timestampDate = /^(\d{4})-(\d{2})-(\d{2})T/u.exec(candidate);
  if (timestampDate === null || !isValidCalendarDate(timestampDate)) {
    throw new SelectionValidationError("SELECTION_DATE_INVALID", { field: side });
  }

  const timestamp = new Date(candidate);
  if (Number.isNaN(timestamp.getTime())) {
    throw new SelectionValidationError("SELECTION_DATE_INVALID", { field: side });
  }
  return timestamp.toISOString();
}

function isValidCalendarDate(parts: RegExpExecArray): boolean {
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function supportedSelectionTypes(): readonly InteractionType[] {
  return interactionTypes;
}
