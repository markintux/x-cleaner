/**
 * Failure categories understood by the retry policy.  The policy deliberately
 * does not know about BrowserEngine or persistence; callers translate their
 * normalized outcomes into one of these values.
 */
export const retryFailureCategories = [
  "TRANSIENT_FAILURE",
  "RETRYABLE_FAILURE",
  "PERMANENT_FAILURE",
  "UNKNOWN_UI",
  "RATE_LIMIT",
  "RATE_LIMIT_WITHOUT_SAFE_RETRY_TIME",
  "CAPTCHA",
  "SUSPICIOUS_LOGIN",
  "SESSION_EXPIRED"
] as const;

export type RetryFailureCategory = (typeof retryFailureCategories)[number];
export type RetryCategory = RetryFailureCategory;

export interface RetryPolicyOptions {
  /** Maximum number of engine attempts for one interaction, including the first. */
  readonly maxAttempts?: number;
  /** Alias accepted at the boundary for callers that use the domain wording. */
  readonly maximumAttempts?: number;
  /** Delay after the first failed attempt. */
  readonly baseDelayMs?: number;
  /** Upper bound for all calculated delays. */
  readonly maxDelayMs?: number;
  /** Alias accepted for the upper bound. */
  readonly maximumDelayMs?: number;
  /** Progressive multiplier; the default is a conservative doubling. */
  readonly multiplier?: number;
}

export type RetryPolicyConfig = RetryPolicyOptions;

export interface RetryDecisionInput {
  readonly attemptNumber: number;
  readonly category: RetryFailureCategory;
  /** A rate-limit result is eligible only when X supplied a safe retry time. */
  readonly safeRetryAt?: string | null;
}

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 5_000;
export const DEFAULT_MAX_DELAY_MS = 60_000;
export const DEFAULT_BACKOFF_MULTIPLIER = 2;
export const MAX_ATTEMPTS = DEFAULT_MAX_ATTEMPTS;
export const BASE_DELAY_MS = DEFAULT_BASE_DELAY_MS;
export const MAX_DELAY_MS = DEFAULT_MAX_DELAY_MS;

const retryableCategories = new Set<RetryFailureCategory>([
  "TRANSIENT_FAILURE",
  "RETRYABLE_FAILURE"
]);

/** Pure, deterministic bounded retry policy. */
export class RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly multiplier: number;

  constructor(options: RetryPolicyOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? options.maximumAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? options.maximumDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.multiplier = options.multiplier ?? DEFAULT_BACKOFF_MULTIPLIER;
    validatePositiveInteger(this.maxAttempts, "INVALID_MAX_ATTEMPTS");
    validateNonNegativeFinite(this.baseDelayMs, "INVALID_BASE_DELAY");
    validateNonNegativeFinite(this.maxDelayMs, "INVALID_MAX_DELAY");
    if (this.maxDelayMs < this.baseDelayMs) {
      throw new Error("MAX_DELAY_BELOW_BASE_DELAY");
    }
    if (!Number.isFinite(this.multiplier) || this.multiplier < 1) {
      throw new Error("INVALID_BACKOFF_MULTIPLIER");
    }
  }

  get maximumAttempts(): number {
    return this.maxAttempts;
  }

  get maximumDelayMs(): number {
    return this.maxDelayMs;
  }

  shouldRetry(input: RetryDecisionInput): boolean {
    validateAttemptNumber(input.attemptNumber);
    if (input.attemptNumber >= this.maxAttempts) {
      return false;
    }
    if (input.category === "RATE_LIMIT") {
      return input.safeRetryAt !== undefined && input.safeRetryAt !== null;
    }
    return retryableCategories.has(input.category);
  }

  canRetry(input: RetryDecisionInput): boolean {
    return this.shouldRetry(input);
  }

  /** Returns the delay before the next attempt after `attemptNumber` failed. */
  delayFor(attemptNumber: number): number {
    validateAttemptNumber(attemptNumber);
    const exponent = attemptNumber - 1;
    const value = this.baseDelayMs * this.multiplier ** exponent;
    return Math.min(this.maxDelayMs, Math.floor(value));
  }

  backoffFor(attemptNumber: number): number {
    return this.delayFor(attemptNumber);
  }

  isExhausted(attemptNumber: number): boolean {
    validateAttemptNumber(attemptNumber);
    return attemptNumber >= this.maxAttempts;
  }
}

export function createRetryPolicy(options: RetryPolicyOptions = {}): RetryPolicy {
  return new RetryPolicy(options);
}

export function shouldRetry(input: RetryDecisionInput, options: RetryPolicyOptions = {}): boolean {
  return new RetryPolicy(options).shouldRetry(input);
}

export function calculateBackoff(attemptNumber: number, options: RetryPolicyOptions = {}): number {
  return new RetryPolicy(options).delayFor(attemptNumber);
}

export function computeBackoff(attemptNumber: number, options: RetryPolicyOptions = {}): number {
  return calculateBackoff(attemptNumber, options);
}

export function isRetryableCategory(category: RetryFailureCategory): boolean {
  return retryableCategories.has(category);
}

function validateAttemptNumber(value: number): void {
  validatePositiveInteger(value, "INVALID_ATTEMPT_NUMBER");
}

function validatePositiveInteger(value: number, code: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(code);
  }
}

function validateNonNegativeFinite(value: number, code: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(code);
  }
}
