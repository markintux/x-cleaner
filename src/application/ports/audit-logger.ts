export interface AuditEvent {
  readonly event: string;
  readonly timestamp?: string;
  readonly [key: string]: unknown;
}

export interface AuditLogger {
  append(event: AuditEvent): Promise<void>;
  log(event: AuditEvent): Promise<void>;
}

/** Audit I/O must never turn a safe domain transition into a failed run. */
export async function recordAudit(
  logger: AuditLogger | undefined,
  event: AuditEvent
): Promise<void> {
  if (logger === undefined) return;
  try {
    await logger.append(event);
  } catch {
    // The durable SQLite state remains authoritative when local log storage is unavailable.
  }
}
