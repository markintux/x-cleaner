export type SafetyErrorCode =
  | "REVIEWED_PLAN_REQUIRED"
  | "PLAN_EMPTY"
  | "PLAN_SNAPSHOT_INVALID"
  | "CONFIRMED_ACCOUNT_REQUIRED"
  | "CURRENT_ACCOUNT_REQUIRED"
  | "ACCOUNT_MISMATCH"
  | "RUN_ALREADY_EXISTS"
  | "RUN_NOT_FOUND"
  | "RUN_NOT_RESUMABLE"
  | "NO_ELIGIBLE_ITEMS"
  | "BATCH_NOT_FOUND"
  | "BATCH_ALREADY_FINISHED"
  | "CONFIRMATION_CANCELED"
  | "CONFIRMATION_REQUIRED"
  | "EXECUTOR_LOCK_REQUIRED"
  | "INVALID_BATCH_LIMIT"
  | "ENGINE_NOT_CONFIGURED";

export class RunSafetyError extends Error {
  constructor(readonly code: SafetyErrorCode) {
    super(code);
    this.name = "RunSafetyError";
  }
}

export function safetyError(code: SafetyErrorCode): RunSafetyError {
  return new RunSafetyError(code);
}
