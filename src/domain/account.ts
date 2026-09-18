import type { XUserId } from "./interaction.js";

export interface DetectedAccount {
  readonly handle: string;
  readonly xUserId: XUserId | null;
}

export type AccountDetection =
  | AuthenticatedAccountDetection
  | UnauthenticatedAccountDetection
  | SecurityChallengeAccountDetection
  | UnknownAccountDetection;

export interface AuthenticatedAccountDetection {
  readonly status: "AUTHENTICATED";
  readonly outcome: "AUTHENTICATED";
  readonly state: "AUTHENTICATED";
  readonly account: DetectedAccount;
}

export interface UnauthenticatedAccountDetection {
  readonly status: "UNAUTHENTICATED";
  readonly outcome: "UNAUTHENTICATED";
  readonly state: "UNAUTHENTICATED";
  readonly reason: "LOGIN_REQUIRED" | "SESSION_EXPIRED";
}

export interface SecurityChallengeAccountDetection {
  readonly status: "SECURITY_CHALLENGE";
  readonly outcome: "SECURITY_CHALLENGE";
  readonly state: "SECURITY_CHALLENGE";
  readonly reason: "SECURITY_CHALLENGE";
}

export interface UnknownAccountDetection {
  readonly status: "UNKNOWN_STATE";
  readonly outcome: "UNKNOWN_STATE";
  readonly state: "UNKNOWN_STATE";
  readonly reason:
    "NO_SUPPORTED_ACCOUNT_EVIDENCE" | "CONFLICTING_ACCOUNT_EVIDENCE" | "INVALID_ACCOUNT_EVIDENCE";
}

/** X handles are stored without @ and compared case-insensitively. */
export function normalizeAccountHandle(value: string): string {
  const normalized = value.trim().replace(/^@+/u, "").toLowerCase();
  if (!/^[a-z0-9_][a-z0-9_-]{0,63}$/u.test(normalized)) {
    throw new Error("INVALID_ACCOUNT_HANDLE");
  }
  return normalized;
}
