import type { Interaction } from "../../domain/interaction.js";

/** The Core-facing input for one known archive interaction. */
export interface CleanerEngineInteraction {
  readonly runId: string;
  readonly runItemId: number;
  readonly interaction: Interaction;
}

export interface CompletedCleanerOutcome {
  readonly kind: "COMPLETED";
  readonly outcome: "COMPLETED";
  readonly durationMs?: number;
}

export type TerminalCleanerOutcomeKind = "NOT_FOUND" | "ALREADY_REMOVED" | "UNAVAILABLE";

export interface TerminalCleanerOutcome {
  readonly kind: "TERMINAL_NON_ERROR";
  readonly outcome: TerminalCleanerOutcomeKind;
  readonly durationMs?: number;
}

export interface RetryableCleanerOutcome {
  readonly kind: "RETRYABLE_FAILURE";
  readonly outcome: "RETRYABLE_FAILURE";
  readonly errorCode: string;
  readonly nextRetryAt?: string | null;
  readonly durationMs?: number;
}

export interface PermanentCleanerOutcome {
  readonly kind: "PERMANENT_FAILURE";
  readonly outcome: "FAILED";
  readonly errorCode: string;
  readonly durationMs?: number;
}

export interface SessionExpiredCleanerOutcome {
  readonly kind: "SESSION_EXPIRED";
  readonly outcome: "PAUSED";
  readonly pauseReason: "SESSION_EXPIRED";
  readonly errorCode?: string;
  readonly durationMs?: number;
}

export interface ChallengeOrRateLimitCleanerOutcome {
  readonly kind: "CHALLENGE_OR_RATE_LIMIT";
  readonly outcome: "PAUSED";
  readonly pauseReason: "SECURITY_CHALLENGE" | "RATE_LIMIT";
  readonly errorCode?: string;
  readonly durationMs?: number;
}

export interface UnknownUiCleanerOutcome {
  readonly kind: "UNKNOWN_UI";
  readonly outcome: "PAUSED";
  readonly pauseReason: "UNKNOWN_UI";
  readonly errorCode?: string;
  readonly durationMs?: number;
}

export type CleanerEngineOutcome =
  | CompletedCleanerOutcome
  | TerminalCleanerOutcome
  | RetryableCleanerOutcome
  | PermanentCleanerOutcome
  | SessionExpiredCleanerOutcome
  | ChallengeOrRateLimitCleanerOutcome
  | UnknownUiCleanerOutcome;

/**
 * Core does not know how X renders an interaction. Implementations may use a
 * browser, but the port intentionally has no Playwright dependency.
 */
export interface CleanerEngine {
  execute(input: CleanerEngineInteraction): Promise<CleanerEngineOutcome>;
}

export type CleanerEngineResult = CleanerEngineOutcome;

export type CleanerEngineSuccess = CompletedCleanerOutcome;
export type CleanerEngineTerminalNonError = TerminalCleanerOutcome;
export type CleanerEngineRetryableFailure = RetryableCleanerOutcome;
export type CleanerEnginePermanentFailure = PermanentCleanerOutcome;
export type CleanerEngineSessionExpired = SessionExpiredCleanerOutcome;
export type CleanerEngineChallengeOrRateLimit = ChallengeOrRateLimitCleanerOutcome;
export type CleanerEngineUnknownUi = UnknownUiCleanerOutcome;
