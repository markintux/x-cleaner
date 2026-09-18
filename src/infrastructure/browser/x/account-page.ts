import type { BrowserPagePort } from "../../../application/ports/browser-session.js";
import {
  normalizeAccountHandle,
  type AccountDetection,
  type DetectedAccount
} from "../../../domain/account.js";
import { xUserId } from "../../../domain/interaction.js";
import { isXChallengeUrl, isXLoginUrl, X_SELECTORS, X_TEXT_KEYS } from "./selectors.js";

/** Page object containing all supported evidence for the authenticated X account. */
export class AccountPage {
  constructor(private readonly page: BrowserPagePort) {}

  async detect(): Promise<AccountDetection> {
    if (await this.hasChallengeEvidence()) {
      return challengeDetection();
    }

    if (await this.hasLoginEvidence()) {
      return {
        status: "UNAUTHENTICATED",
        outcome: "UNAUTHENTICATED",
        state: "UNAUTHENTICATED",
        reason: (await this.hasSessionExpiredEvidence()) ? "SESSION_EXPIRED" : "LOGIN_REQUIRED"
      };
    }

    const handles = await this.readHandles();
    const userIds = await this.readUserIds();
    if (userIds.invalid) {
      return unknownDetection("INVALID_ACCOUNT_EVIDENCE");
    }
    if (handles.length > 1 || userIds.values.length > 1) {
      return unknownDetection("CONFLICTING_ACCOUNT_EVIDENCE");
    }

    const handle = handles[0];
    if (handle === undefined) {
      return unknownDetection("NO_SUPPORTED_ACCOUNT_EVIDENCE");
    }

    const userId = userIds.values[0];
    const account: DetectedAccount = {
      handle,
      xUserId: userId === undefined ? null : xUserId(userId)
    };
    return {
      status: "AUTHENTICATED",
      outcome: "AUTHENTICATED",
      state: "AUTHENTICATED",
      account
    };
  }

  detectAccount(): Promise<AccountDetection> {
    return this.detect();
  }

  private async readHandles(): Promise<readonly string[]> {
    const values: string[] = [];
    for (const selector of X_SELECTORS.account.handle) {
      const locator = this.page.locator(selector).first();
      if ((await locator.count()) === 0) {
        continue;
      }

      const profileLink = X_SELECTORS.account.profileLink.some(
        (profileSelector) => profileSelector === selector
      );
      if (profileLink) {
        const handle = extractHandle(await locator.getAttribute("href"), false, true);
        if (handle !== null && !values.includes(handle)) {
          values.push(handle);
        }
        continue;
      }

      const raw =
        (await locator.getAttribute("data-x-handle")) ??
        (await locator.getAttribute("data-handle")) ??
        (await locator.getAttribute("content")) ??
        (await locator.getAttribute("aria-label")) ??
        (await locator.getAttribute("href")) ??
        (await locator.textContent());
      const handle = extractHandle(raw, selector === '[data-testid="UserName"]', false);
      if (handle !== null && !values.includes(handle)) {
        values.push(handle);
      }
    }
    return values;
  }

  private async readUserIds(): Promise<{
    readonly values: readonly string[];
    readonly invalid: boolean;
  }> {
    const values: string[] = [];
    for (const selector of X_SELECTORS.account.userId) {
      const locator = this.page.locator(selector).first();
      if ((await locator.count()) === 0) {
        continue;
      }

      const raw =
        (await locator.getAttribute("data-x-user-id")) ??
        (await locator.getAttribute("data-user-id")) ??
        (await locator.getAttribute("content")) ??
        (await locator.textContent());
      if (raw === null || raw.trim().length === 0) {
        continue;
      }
      if (!/^\d+$/u.test(raw.trim())) {
        return { values: [], invalid: true };
      }
      const userId = raw.trim();
      if (!values.includes(userId)) {
        values.push(userId);
      }
    }
    return { values, invalid: false };
  }

  private async hasChallengeEvidence(): Promise<boolean> {
    if (isXChallengeUrl(this.page.url())) {
      return true;
    }
    if (await this.hasAnySelector(X_SELECTORS.account.challenge)) {
      return true;
    }
    const body = (await this.page.locator("body").textContent())?.toLowerCase() ?? "";
    return X_TEXT_KEYS.challenge.some((phrase) => body.includes(phrase));
  }

  private async hasLoginEvidence(): Promise<boolean> {
    if (isXLoginUrl(this.page.url())) {
      return true;
    }
    if (
      (await this.hasAnySelector(X_SELECTORS.account.login)) ||
      (await this.hasSessionExpiredEvidence())
    ) {
      return true;
    }
    const body = (await this.page.locator("body").textContent())?.toLowerCase() ?? "";
    return X_TEXT_KEYS.sessionExpired.some((phrase) => body.includes(phrase));
  }

  private async hasSessionExpiredEvidence(): Promise<boolean> {
    return await this.hasAnySelector(X_SELECTORS.account.sessionExpired);
  }

  private async hasAnySelector(selectors: readonly string[]): Promise<boolean> {
    for (const selector of selectors) {
      if (await this.hasSelector(selector)) {
        return true;
      }
    }
    return false;
  }

  private async hasSelector(selector: string): Promise<boolean> {
    return (await this.page.locator(selector).first().count()) > 0;
  }
}

export function detectAccount(page: BrowserPagePort): Promise<AccountDetection> {
  return new AccountPage(page).detect();
}

function extractHandle(
  raw: string | null,
  requireAtSign: boolean,
  profileLink = false
): string | null {
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  const candidate =
    profileLink && /^\/[a-z0-9_][a-z0-9_-]{0,63}(?:[/?#]|$)/iu.test(trimmed)
      ? trimmed.slice(1).split(/[/?#]/u)[0]
      : requireAtSign
        ? trimmed.match(/@([a-z0-9_][a-z0-9_-]{0,63})(?=$|[^a-z0-9_-])/iu)?.[1]
        : (trimmed.match(/@([a-z0-9_][a-z0-9_-]{0,63})(?=$|[^a-z0-9_-])/iu)?.[1] ?? trimmed);
  if (candidate === undefined) {
    return null;
  }
  try {
    return normalizeAccountHandle(candidate);
  } catch {
    return null;
  }
}

function challengeDetection(): AccountDetection {
  return {
    status: "SECURITY_CHALLENGE",
    outcome: "SECURITY_CHALLENGE",
    state: "SECURITY_CHALLENGE",
    reason: "SECURITY_CHALLENGE"
  };
}

function unknownDetection(
  reason:
    "NO_SUPPORTED_ACCOUNT_EVIDENCE" | "CONFLICTING_ACCOUNT_EVIDENCE" | "INVALID_ACCOUNT_EVIDENCE"
): AccountDetection {
  return {
    status: "UNKNOWN_STATE",
    outcome: "UNKNOWN_STATE",
    state: "UNKNOWN_STATE",
    reason
  };
}
