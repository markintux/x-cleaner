import type { BrowserLocatorPort, BrowserPagePort } from "../browser-session.js";
import { normalizeAccountHandle } from "../../../domain/account.js";
import { isDecimalString } from "../../../domain/interaction.js";
import { isXChallengeUrl, isXLoginUrl, X_SELECTORS, X_TEXT_KEYS } from "./selectors.js";

export type ReactionPageEvidenceKind =
  | "COMPLETED"
  | "ALREADY_REMOVED"
  | "NOT_FOUND"
  | "UNAVAILABLE"
  | "UNAUTHENTICATED"
  | "CHALLENGE"
  | "UNKNOWN";

export interface ReactionPageEvidence {
  readonly kind: ReactionPageEvidenceKind;
  readonly outcome: ReactionPageEvidenceKind;
  readonly reason?: string;
  readonly errorCode?: string;
}

export interface ReactionPageInput {
  readonly expectedHandle: string;
  readonly expectedInteractionId: string;
}

export interface ReactionPageOptions extends Partial<ReactionPageInput> {
  readonly confirmedHandle?: string;
  readonly expectedStatusId?: string;
  readonly interactionId?: string;
  readonly expectedAuthor?: string;
  readonly authorHandle?: string;
  readonly statusId?: string;
  readonly evidenceTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly requireOwnerRepostEvidence?: boolean;
  readonly confirmRepostMenu?: boolean;
  readonly expectedOrigin?: string;
}

export interface ReactionPageActionConfig {
  readonly targetSelectors: readonly string[];
  readonly idAttributes: readonly string[];
  readonly actionSelectors: readonly string[];
  readonly actionNames: readonly string[];
  readonly removedStateSelectors: readonly string[];
  readonly missingActionCode: string;
  readonly notConfirmedCode: string;
  readonly requireUrlHandle?: boolean;
}

/**
 * Shared evidence-only mechanics for reactions. It deliberately knows only
 * about semantic selector candidates supplied by the operation page object.
 */
export class ReactionPageSupport {
  private readonly evidenceTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly page: BrowserPagePort,
    private readonly options: ReactionPageOptions,
    private readonly config: ReactionPageActionConfig
  ) {
    this.evidenceTimeoutMs = options.evidenceTimeoutMs ?? 0;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async execute(input?: ReactionPageInput): Promise<ReactionPageEvidence> {
    const expected = this.resolveExpected(input);
    if (expected === null) {
      return unknown("INVALID_EXPECTED_IDENTITY");
    }

    const initial = await this.waitForTarget(expected.expectedInteractionId);
    if (initial.state !== null) return initial.state;
    const target = initial.target;
    if (target === null) {
      return unknown("TARGET_EVIDENCE_MISSING");
    }

    const identity = await this.proveIdentity(target, expected);
    if (identity !== null) {
      return identity;
    }
    if (this.options.requireOwnerRepostEvidence) {
      const targetText =
        (await (target.innerText?.() ?? target.textContent()))?.toLowerCase() ?? "";
      if (!containsAny(targetText, X_TEXT_KEYS.repostedByYou)) {
        return unknown("REPOST_OWNER_EVIDENCE_MISSING");
      }
    }

    const action = await this.findAction(target);
    if (action === null) {
      return unknown(this.config.missingActionCode);
    }

    await action.click();
    const afterAction = await this.readAfterAction(target);
    if (afterAction !== null) return afterAction;
    if (this.options.confirmRepostMenu) {
      const confirmation = await this.findUndoRepostConfirmation();
      if (confirmation === null) return unknown("UNDO_REPOST_CONFIRMATION_MISSING");
      await confirmation.click();
      return (await this.waitForRemoved(target)) ?? unknown(this.config.notConfirmedCode);
    }
    return unknown(this.config.notConfirmedCode);
  }

  private resolveExpected(input?: ReactionPageInput): ReactionPageInput | null {
    const expectedHandle =
      input?.expectedHandle ??
      this.options.expectedHandle ??
      this.options.confirmedHandle ??
      this.options.expectedAuthor ??
      this.options.authorHandle;
    const expectedInteractionId =
      input?.expectedInteractionId ??
      this.options.expectedInteractionId ??
      this.options.expectedStatusId ??
      this.options.interactionId ??
      this.options.statusId;
    if (expectedHandle === undefined || expectedInteractionId === undefined) {
      return null;
    }

    try {
      return {
        expectedHandle: normalizeAccountHandle(expectedHandle),
        expectedInteractionId: validateInteractionId(expectedInteractionId)
      };
    } catch {
      return null;
    }
  }

  private async readNonInteractiveState(): Promise<ReactionPageEvidence | null> {
    if (await this.hasChallengeEvidence()) {
      return evidence("CHALLENGE", "SECURITY_CHALLENGE");
    }
    if (await this.hasUnauthenticatedEvidence()) {
      const reason = (await this.hasSessionExpiredEvidence())
        ? "SESSION_EXPIRED"
        : "LOGIN_REQUIRED";
      return evidence("UNAUTHENTICATED", reason);
    }
    if (await this.hasAnySelector(this.config.removedStateSelectors)) {
      return evidence("ALREADY_REMOVED", "REACTION_REMOVED_STATE");
    }
    if (await this.hasAnySelector(X_SELECTORS.post.deletedState)) {
      return evidence("ALREADY_REMOVED", "DELETED_STATE");
    }
    if (await this.hasAnySelector(X_SELECTORS.post.missingState)) {
      return evidence("NOT_FOUND", "NOT_FOUND_STATE");
    }
    if (await this.hasAnySelector(X_SELECTORS.post.unavailableState)) {
      return evidence("UNAVAILABLE", "UNAVAILABLE_STATE");
    }

    const body = await this.bodyText();
    if (containsAny(body, X_TEXT_KEYS.reactionRemoved)) {
      return evidence("ALREADY_REMOVED", "REACTION_REMOVED_TEXT");
    }
    if (containsAny(body, X_TEXT_KEYS.deleted)) {
      return evidence("ALREADY_REMOVED", "DELETED_TEXT");
    }
    if (containsAny(body, X_TEXT_KEYS.notFound)) {
      return evidence("NOT_FOUND", "NOT_FOUND_TEXT");
    }
    if (containsAny(body, X_TEXT_KEYS.unavailable)) {
      return evidence("UNAVAILABLE", "UNAVAILABLE_TEXT");
    }
    return null;
  }

  private async readAfterAction(target: BrowserLocatorPort): Promise<ReactionPageEvidence | null> {
    if (await this.hasAnySelector(this.config.removedStateSelectors)) {
      return evidence("COMPLETED", "REACTION_REMOVED_CONFIRMED");
    }
    const body = await this.bodyText();
    if (containsAny(body, X_TEXT_KEYS.reactionRemoved)) {
      return evidence("COMPLETED", "REACTION_REMOVED_TEXT");
    }
    if ((await target.count()) === 0) {
      return evidence("COMPLETED", "TARGET_NO_LONGER_ACCESSIBLE");
    }
    if ((await this.findAction(target)) === null) {
      return evidence("COMPLETED", "ACTION_NO_LONGER_PRESENT");
    }
    return null;
  }

  private async waitForRemoved(target: BrowserLocatorPort): Promise<ReactionPageEvidence | null> {
    const startedAt = Date.now();
    while (true) {
      const result = await this.readAfterAction(target);
      if (result !== null) return result;
      const remaining = 5_000 - (Date.now() - startedAt);
      if (remaining <= 0) return null;
      await this.sleep(Math.min(this.pollIntervalMs, remaining));
    }
  }

  private async proveIdentity(
    target: BrowserLocatorPort,
    expected: ReactionPageInput
  ): Promise<ReactionPageEvidence | null> {
    if (this.options.expectedOrigin !== undefined) {
      const urlIdentity = readStatusUrlIdentity(this.page.url());
      if (new URL(this.page.url()).origin !== this.options.expectedOrigin || urlIdentity === null) {
        return unknown("STATUS_ID_EVIDENCE_MISSING");
      }
      if (urlIdentity.interactionId !== expected.expectedInteractionId) {
        return unknown("STATUS_IDENTITY_MISMATCH");
      }
      if (
        this.config.requireUrlHandle !== false &&
        urlIdentity.handle !== expected.expectedHandle
      ) {
        return unknown("AUTHOR_IDENTITY_MISMATCH");
      }
    }
    const observedIds = await this.readTargetValues(target, this.config.idAttributes);
    if (observedIds.length === 0) {
      const urlIdentity = readStatusUrlIdentity(this.page.url());
      if (urlIdentity === null) {
        return unknown("STATUS_ID_EVIDENCE_MISSING");
      }
      if (urlIdentity.interactionId !== expected.expectedInteractionId) {
        return unknown("STATUS_IDENTITY_MISMATCH");
      }
      if (
        this.config.requireUrlHandle !== false &&
        urlIdentity.handle !== expected.expectedHandle
      ) {
        return unknown("AUTHOR_IDENTITY_MISMATCH");
      }
      return null;
    }
    if (observedIds.length !== 1 || !isDecimalString(observedIds[0] ?? "")) {
      return unknown("STATUS_ID_EVIDENCE_MISSING");
    }
    if (observedIds[0] !== expected.expectedInteractionId) {
      return unknown("STATUS_IDENTITY_MISMATCH");
    }
    return null;
  }

  private async readTargetValues(
    target: BrowserLocatorPort,
    attributes: readonly string[]
  ): Promise<readonly string[]> {
    const values: string[] = [];
    for (const attribute of attributes) {
      const raw = await target.getAttribute(attribute);
      if (raw !== null && raw.trim() !== "" && !values.includes(raw.trim())) {
        values.push(raw.trim());
      }
      const nested = this.scopedLocator(target, `[${attribute}]`);
      if (nested !== null && (await nested.count()) === 1) {
        const nestedValue = await nested.getAttribute(attribute);
        if (
          nestedValue !== null &&
          nestedValue.trim() !== "" &&
          !values.includes(nestedValue.trim())
        ) {
          values.push(nestedValue.trim());
        }
      }
    }
    return values;
  }

  private async waitForTarget(interactionId: string): Promise<{
    target: BrowserLocatorPort | null;
    state: ReactionPageEvidence | null;
  }> {
    const startedAt = Date.now();
    while (true) {
      const state = await this.readNonInteractiveState();
      if (state !== null) return { target: null, state };
      const target = await this.findTarget(interactionId);
      if (target !== null) return { target, state: null };
      const remaining = this.evidenceTimeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) return { target: null, state: null };
      await this.sleep(Math.min(this.pollIntervalMs, remaining));
    }
  }

  private async findTarget(interactionId: string): Promise<BrowserLocatorPort | null> {
    for (const selector of this.config.targetSelectors) {
      const locator = this.page.locator(selector);
      const count = await locator.count();
      if (count === 1) {
        const first = locator.first();
        if (await this.isUsable(first)) {
          return first;
        }
      }
    }
    const articles = this.page.locator("article");
    let exact: BrowserLocatorPort | null = null;
    for (let index = 0; index < (await articles.count()); index += 1) {
      const article = articles.nth?.(index) ?? (index === 0 ? articles.first() : null);
      if (article === null) continue;
      const links = this.scopedLocator(article, 'a[href*="/status/"]');
      if (links === null) continue;
      for (let linkIndex = 0; linkIndex < (await links.count()); linkIndex += 1) {
        const link = links.nth?.(linkIndex) ?? (linkIndex === 0 ? links.first() : null);
        if (link === null) continue;
        const href = await link.getAttribute("href");
        if (href === null || !hasExactStatusId(href, interactionId)) continue;
        if (exact !== null) return null;
        exact = article;
        break;
      }
    }
    if (exact !== null && (await this.isUsable(exact))) return exact;
    return null;
  }

  private async findAction(target: BrowserLocatorPort): Promise<BrowserLocatorPort | null> {
    const stable = await this.findOne(target, this.config.actionSelectors);
    if (stable !== null) {
      return stable;
    }
    return this.findByAccessibleText(target, "button", this.config.actionNames);
  }

  private async findUndoRepostConfirmation(): Promise<BrowserLocatorPort | null> {
    const startedAt = Date.now();
    while (true) {
      const menus = this.page.locator('[role="menuitem"]');
      let match: BrowserLocatorPort | null = null;
      for (let index = 0; index < (await menus.count()); index += 1) {
        const menu = menus.nth?.(index) ?? (index === 0 ? menus.first() : null);
        if (menu === null) continue;
        const label = ((await (menu.innerText?.() ?? menu.textContent())) ?? "")
          .trim()
          .toLowerCase();
        if (!X_TEXT_KEYS.undoRepost.some((candidate) => candidate === label)) continue;
        if (match !== null) return null;
        match = menu;
      }
      if (match !== null && (await this.isUsable(match))) return match;
      const remaining = 3_000 - (Date.now() - startedAt);
      if (remaining <= 0) return null;
      await this.sleep(Math.min(this.pollIntervalMs, remaining));
    }
  }

  private async findOne(
    scope: BrowserPagePort | BrowserLocatorPort,
    selectors: readonly string[]
  ): Promise<BrowserLocatorPort | null> {
    for (const selector of selectors) {
      const locator = this.scopedLocator(scope, selector);
      if (locator === null) {
        continue;
      }
      const count = await locator.count();
      if (count === 1) {
        const first = locator.first();
        if (await this.isUsable(first)) {
          return first;
        }
      }
      if (count > 1) {
        return null;
      }
    }
    return null;
  }

  private findByAccessibleText(
    scope: BrowserPagePort | BrowserLocatorPort,
    role: string,
    names: readonly string[]
  ): Promise<BrowserLocatorPort | null> {
    return this.findByAccessibleTextAsync(scope, role, names);
  }

  private async findByAccessibleTextAsync(
    scope: BrowserPagePort | BrowserLocatorPort,
    role: string,
    names: readonly string[]
  ): Promise<BrowserLocatorPort | null> {
    if (!("getByRole" in scope) || typeof scope.getByRole !== "function") {
      return null;
    }
    for (const name of names) {
      const locator = scope.getByRole(role, { name: new RegExp(`^${escapeRegExp(name)}$`, "iu") });
      if ((await locator.count()) === 1) {
        const first = locator.first();
        if (await this.isUsable(first)) {
          return first;
        }
      }
    }
    return null;
  }

  private scopedLocator(
    scope: BrowserPagePort | BrowserLocatorPort,
    selector: string
  ): BrowserLocatorPort | null {
    if ("locator" in scope && typeof scope.locator === "function") {
      return scope.locator(selector);
    }
    return null;
  }

  private async hasUnauthenticatedEvidence(): Promise<boolean> {
    if (isXLoginUrl(this.page.url())) {
      return true;
    }
    if (
      (await this.hasAnySelector(X_SELECTORS.account.login)) ||
      (await this.hasSessionExpiredEvidence())
    ) {
      return true;
    }
    const body = await this.bodyText();
    return containsAny(body, X_TEXT_KEYS.login) || containsAny(body, X_TEXT_KEYS.sessionExpired);
  }

  private async hasSessionExpiredEvidence(): Promise<boolean> {
    if (await this.hasAnySelector(X_SELECTORS.account.sessionExpired)) {
      return true;
    }
    return containsAny(await this.bodyText(), X_TEXT_KEYS.sessionExpired);
  }

  private async hasChallengeEvidence(): Promise<boolean> {
    if (isXChallengeUrl(this.page.url())) {
      return true;
    }
    if (await this.hasAnySelector(X_SELECTORS.account.challenge)) {
      return true;
    }
    return containsAny(await this.bodyText(), X_TEXT_KEYS.challenge);
  }

  private async hasAnySelector(selectors: readonly string[]): Promise<boolean> {
    for (const selector of selectors) {
      if ((await this.page.locator(selector).first().count()) > 0) {
        return true;
      }
    }
    return false;
  }

  private async isUsable(locator: BrowserLocatorPort): Promise<boolean> {
    return typeof locator.isVisible !== "function" || (await locator.isVisible());
  }

  private async bodyText(): Promise<string> {
    const body = this.page.locator("body");
    const content =
      typeof body.innerText === "function"
        ? await body.innerText()
        : ((await body.textContent()) ?? "");
    return content.trim().toLowerCase();
  }
}

function hasExactStatusId(value: string, interactionId: string): boolean {
  try {
    const pathname = new URL(value, "https://x.com").pathname;
    return (
      pathname.split("/").filter(Boolean).at(-1) === interactionId && pathname.includes("/status/")
    );
  } catch {
    return false;
  }
}

export function reactionConfig(
  actionSelectors: readonly string[],
  actionNames: readonly string[],
  removedStateSelectors: readonly string[],
  missingActionCode: string,
  notConfirmedCode: string,
  targetSelectors: readonly string[],
  idAttributes: readonly string[],
  requireUrlHandle = true
): ReactionPageActionConfig {
  return {
    actionSelectors,
    actionNames,
    removedStateSelectors,
    missingActionCode,
    notConfirmedCode,
    targetSelectors,
    idAttributes,
    requireUrlHandle
  };
}

function validateInteractionId(value: string): string {
  if (!isDecimalString(value)) {
    throw new Error("INVALID_INTERACTION_ID");
  }
  return value;
}

function readStatusUrlIdentity(
  value: string
): { readonly handle: string; readonly interactionId: string } | null {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter((segment) => segment !== "");
    const statusIndex = segments.findIndex((segment) => segment.toLowerCase() === "status");
    const handle = segments[statusIndex - 1];
    const interactionId = segments[statusIndex + 1];
    if (
      statusIndex < 1 ||
      handle === undefined ||
      interactionId === undefined ||
      !isDecimalString(interactionId)
    ) {
      return null;
    }
    return { handle: normalizeAccountHandle(handle), interactionId };
  } catch {
    return null;
  }
}

function containsAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}

function evidence(kind: ReactionPageEvidenceKind, reason: string): ReactionPageEvidence {
  return { kind, outcome: kind, reason };
}

function unknown(errorCode: string): ReactionPageEvidence {
  return { kind: "UNKNOWN", outcome: "UNKNOWN", reason: errorCode, errorCode };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
