import { describe, expect, it } from "vitest";

import {
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
  RetryPolicy,
  calculateBackoff
} from "../../../src/domain/retry-policy.js";

describe("RetryPolicy", () => {
  it("limita tentativas e usa backoff progressivo limitado", () => {
    const policy = new RetryPolicy({ maxAttempts: 4, baseDelayMs: 1000, maxDelayMs: 2500 });

    expect(policy.maxAttempts).toBe(4);
    expect([1, 2, 3, 4].map((attempt) => policy.delayFor(attempt))).toEqual([
      1000, 2000, 2500, 2500
    ]);
    expect(policy.shouldRetry({ attemptNumber: 1, category: "TRANSIENT_FAILURE" })).toBe(true);
    expect(policy.shouldRetry({ attemptNumber: 4, category: "TRANSIENT_FAILURE" })).toBe(false);
    expect(calculateBackoff(1)).toBe(DEFAULT_BASE_DELAY_MS);
    expect(new RetryPolicy().maxAttempts).toBe(DEFAULT_MAX_ATTEMPTS);
  });

  it.each([
    "PERMANENT_FAILURE",
    "UNKNOWN_UI",
    "RATE_LIMIT_WITHOUT_SAFE_RETRY_TIME",
    "CAPTCHA",
    "SUSPICIOUS_LOGIN",
    "SESSION_EXPIRED"
  ] as const)("nunca repete automaticamente %s", (category) => {
    const policy = new RetryPolicy({ maxAttempts: 5 });
    expect(policy.shouldRetry({ attemptNumber: 1, category })).toBe(false);
  });

  it("só considera rate limit quando existe um horário seguro informado", () => {
    const policy = new RetryPolicy({ maxAttempts: 3 });
    expect(
      policy.shouldRetry({ attemptNumber: 1, category: "RATE_LIMIT", safeRetryAt: null })
    ).toBe(false);
    expect(
      policy.shouldRetry({
        attemptNumber: 1,
        category: "RATE_LIMIT",
        safeRetryAt: "2026-03-04T05:06:07.000Z"
      })
    ).toBe(true);
  });
});
