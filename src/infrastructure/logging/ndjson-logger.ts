import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type {
  AuditEvent as PortAuditEvent,
  AuditLogger as PortAuditLogger
} from "../../application/ports/audit-logger.js";
import { redact, type RedactedValue } from "./redactor.js";

export const auditEventNames = [
  "archive.import.started",
  "archive.import.completed",
  "archive.import.failed",
  "account.detected",
  "account.confirmed",
  "account.rejected",
  "plan.created",
  "plan.previewed",
  "run.confirmation.succeeded",
  "run.confirmation.failed",
  "interaction.attempted",
  "run.paused",
  "run.resumed",
  "run.completed",
  "run.interrupted",
  "run.failed",
  "session.cleared"
] as const;

export type AuditEventName = (typeof auditEventNames)[number];

export interface AuditEvent extends Omit<PortAuditEvent, "event"> {
  readonly event?: AuditEventName | string;
  readonly type?: AuditEventName | string;
  readonly timestamp?: string;
  readonly [key: string]: unknown;
}

export interface NdjsonLoggerOptions {
  readonly dataDirectory: string;
  readonly relativePath?: string;
}

export type AuditLogger = PortAuditLogger;

/** Appends privacy-safe audit objects to a local UTF-8 NDJSON file. */
export class NdjsonLogger implements AuditLogger {
  readonly #dataDirectory: string;
  readonly #relativePath: string;
  readonly #outputPath: string;
  #tail: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string, relativePath?: string);
  constructor(options: NdjsonLoggerOptions);
  constructor(
    dataDirectoryOrOptions: string | NdjsonLoggerOptions,
    relativePath = "logs/audit.ndjson"
  ) {
    const options =
      typeof dataDirectoryOrOptions === "string"
        ? { dataDirectory: dataDirectoryOrOptions, relativePath }
        : dataDirectoryOrOptions;
    this.#dataDirectory = path.resolve(options.dataDirectory);
    this.#relativePath = validateRelativePath(options.relativePath ?? "logs/audit.ndjson");
    this.#outputPath = resolveUnderDirectory(this.#dataDirectory, this.#relativePath);
  }

  get relativePath(): string {
    return this.#relativePath;
  }

  get outputPath(): string {
    return this.#outputPath;
  }

  append(event: AuditEvent): Promise<void>;
  append(
    eventName: AuditEventName | string,
    fields?: Readonly<Record<string, unknown>>
  ): Promise<void>;
  append(
    eventOrName: AuditEvent | AuditEventName | string,
    fields: Readonly<Record<string, unknown>> = {}
  ): Promise<void> {
    const event =
      typeof eventOrName === "string"
        ? { ...fields, event: eventOrName }
        : eventOrName.event === undefined && eventOrName.type !== undefined
          ? { ...eventOrName, event: eventOrName.type }
          : eventOrName;
    if (event.event === undefined || event.event.trim() === "") {
      return Promise.reject(new Error("AUDIT_EVENT_INVALID"));
    }
    const operation = this.#tail.then(async () => {
      const redacted = redact(event);
      if (redacted === undefined || typeof redacted !== "object" || Array.isArray(redacted)) {
        throw new Error("AUDIT_EVENT_INVALID");
      }
      const line = `${JSON.stringify(redacted satisfies RedactedValue)}\n`;
      await mkdir(path.dirname(this.#outputPath), { recursive: true });
      await appendFile(this.#outputPath, line, { encoding: "utf8" });
    });
    this.#tail = operation.catch(() => undefined);
    return operation;
  }

  log(event: AuditEvent): Promise<void>;
  log(
    eventName: AuditEventName | string,
    fields?: Readonly<Record<string, unknown>>
  ): Promise<void>;
  log(
    eventOrName: AuditEvent | AuditEventName | string,
    fields: Readonly<Record<string, unknown>> = {}
  ): Promise<void> {
    return typeof eventOrName === "string"
      ? this.append(eventOrName, fields)
      : this.append(eventOrName);
  }

  write(
    eventOrName: AuditEvent | AuditEventName | string,
    fields: Readonly<Record<string, unknown>> = {}
  ): Promise<void> {
    return typeof eventOrName === "string"
      ? this.append(eventOrName, fields)
      : this.append(eventOrName);
  }
}

export function validateRelativePath(relativePath: string): string {
  if (
    relativePath.trim() === "" ||
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    /^[A-Za-z]:/u.test(relativePath) ||
    relativePath.includes("\\")
  ) {
    throw new Error("INVALID_AUDIT_OUTPUT_PATH");
  }
  const normalized = path.posix.normalize(relativePath);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("INVALID_AUDIT_OUTPUT_PATH");
  }
  return normalized;
}

export function resolveUnderDirectory(dataDirectory: string, relativePath: string): string {
  const safeRelativePath = validateRelativePath(relativePath);
  const root = path.resolve(dataDirectory);
  const target = path.resolve(root, safeRelativePath);
  const relative = path.relative(root, target);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("INVALID_AUDIT_OUTPUT_PATH");
  }
  return target;
}
