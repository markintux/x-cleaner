export { archiveImportStatuses, isArchiveImportStatus } from "./interaction.js";
export type { ArchiveImportStatus } from "./interaction.js";

export const attemptOutcomes = [
  "COMPLETED",
  "RETRYABLE_FAILURE",
  "FAILED",
  "NOT_FOUND",
  "ALREADY_REMOVED",
  "UNAVAILABLE",
  "PAUSED"
] as const;

export type AttemptOutcome = (typeof attemptOutcomes)[number];

/** Privacy-safe metadata for the one report associated with a cleaning run. */
export interface GeneratedReport {
  readonly id: string;
  readonly runId: string;
  readonly relativePath: string;
  readonly sha256: string;
  readonly summaryJson: string;
  readonly generatedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isAttemptOutcome(value: string): value is AttemptOutcome {
  return (attemptOutcomes as readonly string[]).includes(value);
}
