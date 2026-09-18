import {
  decimalString,
  type XInteractionId,
  type XUserId,
  xInteractionId,
  xUserId
} from "../../../domain/interaction.js";

export class YtdParserError extends Error {
  constructor(readonly code: "MALFORMED_ARCHIVE_RECORD" | "UNSUPPORTED_ARCHIVE_IDENTIFIER") {
    super(code);
    this.name = "YtdParserError";
  }
}

export function unwrapRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new YtdParserError("MALFORMED_ARCHIVE_RECORD");
  }
  const nested = value[key];
  if (nested === undefined) {
    return value;
  }
  if (!isRecord(nested)) {
    throw new YtdParserError("MALFORMED_ARCHIVE_RECORD");
  }
  return nested;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function firstString(
  record: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export function decimalId(
  record: Record<string, unknown>,
  keys: readonly string[],
  required = true
): XInteractionId | XUserId | null {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (typeof value !== "string" || !/^\d+$/u.test(value)) {
      throw new YtdParserError("UNSUPPORTED_ARCHIVE_IDENTIFIER");
    }
    return value as XInteractionId;
  }
  if (required) {
    throw new YtdParserError("MALFORMED_ARCHIVE_RECORD");
  }
  return null;
}

export function interactionId(
  record: Record<string, unknown>,
  keys: readonly string[],
  required = true
): XInteractionId | null {
  const value = decimalId(record, keys, required);
  return value === null ? null : xInteractionId(value);
}

export function userId(
  record: Record<string, unknown>,
  keys: readonly string[],
  required = false
): XUserId | null {
  const value = decimalId(record, keys, required);
  return value === null ? null : xUserId(value);
}

export function normalizeHandle(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const handle = value.trim().replace(/^@/u, "");
  return handle.length === 0 ? null : handle;
}

export function normalizeDate(
  record: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  const value = firstString(record, keys);
  if (value === null) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function preview(record: Record<string, unknown>, keys: readonly string[]): string | null {
  const value = firstString(record, keys);
  if (value === null) {
    return null;
  }
  return Array.from(value).slice(0, 280).join("");
}

export function booleanEvidence(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => record[key] === true);
}

export function hasPresentValue(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => {
    const value = record[key];
    return value !== undefined && value !== null && value !== "";
  });
}

export function assertDecimalString(value: string): string {
  return decimalString(value);
}
