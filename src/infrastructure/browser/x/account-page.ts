import type { BrowserPagePort } from "../../../application/ports/browser-session.js";
import {
  normalizeAccountHandle,
  type AccountDetection,
  type DetectedAccount
} from "../../../domain/account.js";
import { xUserId } from "../../../domain/interaction.js";

const HANDLE_EVIDENCE_SELECTORS = [
  '[data-testid="account-handle"]',
  '[data-testid="account-switcher"]',
  '[data-testid="AccountSwitcher_Button"]',
  '[data-testid="SideNav_AccountSwitcher_Button"]',
  '[data-testid="UserName"]',
  '[data-testid="profile-link"]',
  '[data-testid="AppTabBar_Profile_Link"]',
  'a[aria-label="Profile"]',
  "[data-x-handle]",
  "[data-handle]",
  'meta[name="x-account-handle"]',
  'meta[name="twitter:account-handle"]'
] as const;

const USER_ID_EVIDENCE_SELECTORS = [
  '[data-testid="account-id"]',
  '[data-testid="user-id"]',
  "[data-x-user-id]",
  "[data-user-id]",
  'meta[name="x-account-id"]',
  'meta[name="x-user-id"]'
] as const;

const LOGIN_SELECTORS = [
  '[data-testid="login"]',
  '[data-testid="login-button"]',
  '[data-testid="login-flow"]',
  '[data-testid="login-screen"]',
  '[data-authenticated="false"]',
  'meta[name="x-authenticated"][content="false"]',
  'a[href="/login"]',
  'button[aria-label="Log in"]'
] as const;

const CHALLENGE_SELECTORS = [
  '[data-testid="security-challenge"]',
  '[data-testid="challenge"]',
  "[data-security-challenge]",
  'meta[name="x-security-challenge"]'
] as const;

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
    for (const selector of HANDLE_EVIDENCE_SELECTORS) {
      const locator = this.page.locator(selector).first();
      if ((await locator.count()) === 0) {
        continue;
      }

      const profileLink =
        selector === '[data-testid="profile-link"]' ||
        selector === '[data-testid="AppTabBar_Profile_Link"]' ||
        selector === 'a[aria-label="Profile"]';
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
    for (const selector of USER_ID_EVIDENCE_SELECTORS) {
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
    if (/\/(?:challenge|account\/access|i\/flow\/verify)(?:\/|$)/u.test(this.page.url())) {
      return true;
    }
    if (await this.hasAnySelector(CHALLENGE_SELECTORS)) {
      return true;
    }
    const body = (await this.page.locator("body").textContent())?.toLowerCase() ?? "";
    return [
      "security challenge",
      "suspicious login",
      "captcha",
      "desafio de segurança",
      "verificação de segurança",
      "atividade suspeita"
    ].some((phrase) => body.includes(phrase));
  }

  private async hasLoginEvidence(): Promise<boolean> {
    if (/\/(?:i\/flow\/login|login)(?:\/|$)/u.test(this.page.url())) {
      return true;
    }
    if ((await this.hasAnySelector(LOGIN_SELECTORS)) || (await this.hasSessionExpiredEvidence())) {
      return true;
    }
    const body = (await this.page.locator("body").textContent())?.toLowerCase() ?? "";
    return body.includes("session expired") || body.includes("sessão expirada");
  }

  private async hasSessionExpiredEvidence(): Promise<boolean> {
    return (
      (await this.hasSelector('[data-session-expired="true"]')) ||
      (await this.hasSelector('meta[name="x-session-expired"][content="true"]'))
    );
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
