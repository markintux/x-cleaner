/**
 * Values that are safe to put in an audit event. The redactor intentionally
 * removes sensitive fields instead of replacing their values: a marker would
 * still make it too easy to accidentally retain a credential in a nested
 * diagnostic object.
 */
const sensitiveKeyParts = [
  "password",
  "passwd",
  "passphrase",
  "cookie",
  "authorization",
  "csrf",
  "session",
  "email",
  "token",
  "secret",
  "credential",
  "rawhtml",
  "html",
  "fullcontent",
  "content",
  "contentpreview",
  "posttext",
  "replytext",
  "text",
  "body",
  "archivepath",
  "absolutepath",
  "sourcepath",
  "stack"
] as const;

const handleKeyParts = ["handle", "username"] as const;

export type RedactedValue =
  null | boolean | number | string | RedactedValue[] | { readonly [key: string]: RedactedValue };

/** Redacts a JSON-compatible value without mutating the input. */
export function redact(value: unknown): RedactedValue | undefined {
  return redactValue(value, null);
}

/** Alias used by adapters that make the serialization boundary explicit. */
export const redactForSerialization = redact;

/** Masks a local account handle according to the audit contract. */
export function maskHandle(value: string): string {
  const handle = value.trim().replace(/^@+/u, "");
  if (handle.length < 6) {
    return "@[redacted]";
  }
  return `@${handle.slice(0, 2)}***${handle.slice(-2)}`;
}

function redactValue(value: unknown, key: string | null): RedactedValue | undefined {
  if (key !== null && isSensitiveKey(key)) {
    return undefined;
  }

  if (typeof value === "string") {
    if (/^(?:\/|[A-Za-z]:[\\/])/u.test(value)) {
      return undefined;
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
      return undefined;
    }
    return key !== null && isHandleKey(key) ? maskHandle(value) : value;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => redactValue(entry, null))
      .filter((entry): entry is RedactedValue => entry !== undefined);
  }
  if (typeof value !== "object") {
    return undefined;
  }

  const result: Record<string, RedactedValue> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const redacted = redactValue(childValue, childKey);
    if (redacted !== undefined) {
      result[childKey] = redacted;
    }
  }
  return result;
}

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return sensitiveKeyParts.some((part) => normalized.includes(part));
}

function isHandleKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return handleKeyParts.some((part) => normalized === part || normalized.endsWith(part));
}
