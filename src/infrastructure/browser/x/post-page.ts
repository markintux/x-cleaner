import type { BrowserLocatorPort, BrowserPagePort } from "../browser-session.js";
import { normalizeAccountHandle } from "../../../domain/account.js";
import { isDecimalString } from "../../../domain/interaction.js";
import { isXChallengeUrl, isXLoginUrl, X_SELECTORS, X_TEXT_KEYS } from "./selectors.js";

export type PostPageEvidenceKind =
  | "DELETED"
  | "ALREADY_REMOVED"
  | "NOT_FOUND"
  | "UNAVAILABLE"
  | "UNAUTHENTICATED"
  | "CHALLENGE"
  | "UNKNOWN";

export interface PostPageEvidence {
  readonly kind: PostPageEvidenceKind;
  readonly outcome: PostPageEvidenceKind;
  readonly reason?: string;
  readonly errorCode?: string;
}

export interface PostPageInput {
  readonly expectedHandle: string;
  readonly expectedInteractionId: string;
}

export interface PostPageOptions extends Partial<PostPageInput> {
  /** Alias accepted by callers that name the archive field explicitly. */
  readonly confirmedHandle?: string;
  /** Alias accepted by callers that name the X status field explicitly. */
  readonly expectedStatusId?: string;
  readonly interactionId?: string;
  readonly expectedAuthor?: string;
  readonly authorHandle?: string;
  readonly statusId?: string;
  readonly evidenceTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export type PostPageResult = PostPageEvidence;

/**
 * Evidence-only page object for one status. It never decides Core outcomes and
 * it never clicks until both target identity and author have been proven.
 */
export class PostPage {
  private readonly page: BrowserPagePort;
  private readonly options: PostPageOptions;
  private readonly evidenceTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(page: BrowserPagePort, options?: PostPageOptions);
  constructor(page: BrowserPagePort, expectedHandle: string, expectedInteractionId: string);
  constructor(
    page: BrowserPagePort,
    optionsOrHandle: PostPageOptions | string = {},
    expectedInteractionId?: string
  ) {
    this.page = page;
    this.options =
      typeof optionsOrHandle === "string"
        ? {
            expectedHandle: optionsOrHandle,
            ...(expectedInteractionId === undefined ? {} : { expectedInteractionId })
          }
        : optionsOrHandle;
    this.evidenceTimeoutMs = this.options.evidenceTimeoutMs ?? 15_000;
    this.pollIntervalMs = this.options.pollIntervalMs ?? 250;
    this.sleep =
      this.options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async execute(input?: PostPageInput): Promise<PostPageEvidence> {
    return this.deletePost(input);
  }

  async delete(input?: PostPageInput): Promise<PostPageEvidence> {
    return this.deletePost(input);
  }

  async remove(input?: PostPageInput): Promise<PostPageEvidence> {
    return this.deletePost(input);
  }

  async deleteStatus(input?: PostPageInput): Promise<PostPageEvidence> {
    return this.deletePost(input);
  }

  async deleteInteraction(input?: PostPageInput): Promise<PostPageEvidence> {
    return this.deletePost(input);
  }

  async deletePost(input?: PostPageInput): Promise<PostPageEvidence> {
    const expected = this.resolveExpected(input);
    if (expected === null) {
      return unknown("INVALID_EXPECTED_IDENTITY");
    }

    const initial = await this.waitForInitialEvidence(expected.expectedInteractionId);
    if (initial.state !== null) {
      return initial.state;
    }

    const target = initial.target;
    if (target === null) {
      return unknown("TARGET_EVIDENCE_MISSING");
    }

    const identity = await this.proveIdentity(target, expected);
    if (identity !== null) {
      return identity;
    }

    const menu = await this.waitForOne(target, X_SELECTORS.post.menu);
    let action: BrowserLocatorPort | null = null;
    if (menu !== null) {
      await menu.click();
      const afterMenuState = await this.readNonInteractiveState();
      if (afterMenuState !== null) {
        return afterMenuState;
      }
      action = await this.waitForDeleteAction(this.page);
    } else {
      action = await this.waitForOne(target, X_SELECTORS.post.directDelete);
    }

    if (action === null) {
      return unknown(menu === null ? "DELETE_CONTROL_MISSING" : "DELETE_ACTION_MISSING");
    }

    await action.click();
    const dialog = await this.waitForOne(this.page, X_SELECTORS.post.dialog);
    if (dialog === null) {
      const afterAction = await this.readAfterDeleteAction(target);
      return afterAction ?? unknown("DELETE_CONFIRMATION_MISSING");
    }

    const confirmation = await this.waitForConfirmation(dialog);
    if (confirmation === null) {
      return unknown("DELETE_CONFIRMATION_CONTROL_MISSING");
    }

    await confirmation.click();
    return (await this.readAfterDeleteAction(target)) ?? unknown("DELETE_NOT_CONFIRMED");
  }

  private resolveExpected(input?: PostPageInput): PostPageInput | null {
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

  private async readNonInteractiveState(): Promise<PostPageEvidence | null> {
    if (await this.hasChallengeEvidence()) {
      return evidence("CHALLENGE", "SECURITY_CHALLENGE");
    }
    if (await this.hasUnauthenticatedEvidence()) {
      const reason = (await this.hasSessionExpiredEvidence())
        ? "SESSION_EXPIRED"
        : "LOGIN_REQUIRED";
      return evidence("UNAUTHENTICATED", reason);
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

  private async readAfterDeleteAction(
    target: BrowserLocatorPort
  ): Promise<PostPageEvidence | null> {
    if (await this.hasAnySelector(X_SELECTORS.post.deletedState)) {
      return evidence("DELETED", "DELETED_CONFIRMED");
    }
    const body = await this.bodyText();
    if (containsAny(body, X_TEXT_KEYS.deleted)) {
      return evidence("DELETED", "DELETED_TEXT");
    }
    if ((await target.count()) === 0) {
      return evidence("DELETED", "TARGET_NO_LONGER_ACCESSIBLE");
    }
    return null;
  }

  private async proveIdentity(
    target: BrowserLocatorPort,
    expected: PostPageInput
  ): Promise<PostPageEvidence | null> {
    let observedIds = await this.readTargetValues(target, X_SELECTORS.post.idAttributes);
    if (observedIds.length === 0) {
      const exactStatusLink = this.scopedLocator(
        target,
        `a[href*="/status/${expected.expectedInteractionId}"]`
      );
      if (exactStatusLink !== null && (await exactStatusLink.count()) > 0) {
        observedIds = [expected.expectedInteractionId];
      }
    }
    if (observedIds.length === 0) {
      const urlIdentity = readStatusUrlIdentity(this.page.url());
      if (urlIdentity === null) {
        return unknown("STATUS_ID_EVIDENCE_MISSING");
      }
      if (urlIdentity.interactionId !== expected.expectedInteractionId) {
        return unknown("STATUS_IDENTITY_MISMATCH");
      }
      if (urlIdentity.handle !== expected.expectedHandle) {
        return unknown("AUTHOR_IDENTITY_MISMATCH");
      }
      observedIds = [expected.expectedInteractionId];
    }
    if (observedIds.length !== 1) {
      return unknown("STATUS_ID_EVIDENCE_MISSING");
    }
    if (observedIds[0] !== expected.expectedInteractionId) {
      return unknown("STATUS_IDENTITY_MISMATCH");
    }

    const observedAuthors = [...(await this.readAuthorEvidence(target))];
    const exactAuthorLink = this.scopedLocator(target, `a[href="/${expected.expectedHandle}"]`);
    if (
      observedAuthors.length === 0 &&
      exactAuthorLink !== null &&
      (await exactAuthorLink.count()) > 0
    ) {
      observedAuthors.push(expected.expectedHandle);
    }
    if (observedAuthors.length !== 1) {
      return unknown("AUTHOR_EVIDENCE_MISSING");
    }
    if (observedAuthors[0] !== expected.expectedHandle) {
      return unknown("AUTHOR_IDENTITY_MISMATCH");
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

  private async readAuthorEvidence(target: BrowserLocatorPort): Promise<readonly string[]> {
    const values: string[] = [];
    for (const attribute of X_SELECTORS.post.authorAttributes) {
      const raw = await target.getAttribute(attribute);
      const normalized = normalizeAuthor(raw);
      if (normalized !== null && !values.includes(normalized)) {
        values.push(normalized);
      }
    }
    for (const selector of X_SELECTORS.post.author) {
      const locator = this.scopedLocator(target, selector);
      if (locator === null || (await locator.count()) !== 1) {
        continue;
      }
      const raw =
        (await locator.getAttribute("data-author-handle")) ??
        (await locator.getAttribute("data-x-author-handle")) ??
        (await locator.getAttribute("href")) ??
        (await locator.textContent());
      const normalized = normalizeAuthor(raw);
      if (normalized !== null && !values.includes(normalized)) {
        values.push(normalized);
      }
    }
    return values;
  }

  private async findTarget(expectedInteractionId: string): Promise<BrowserLocatorPort | null> {
    const exactLinkTarget = this.page.locator(
      `article:has(a[href*="/status/${expectedInteractionId}"])`
    );
    if ((await exactLinkTarget.count()) === 1) {
      const first = exactLinkTarget.first();
      if (await this.isUsable(first)) {
        return first;
      }
    }
    for (const selector of X_SELECTORS.post.target) {
      const locator = this.page.locator(selector);
      const count = await locator.count();
      if (count === 1) {
        const first = locator.first();
        const structuralIds = await this.readTargetValues(first, X_SELECTORS.post.idAttributes);
        if (structuralIds.length > 0 && (await this.isUsable(first))) {
          return first;
        }
      }
    }
    return null;
  }

  private async waitForInitialEvidence(expectedInteractionId: string): Promise<{
    readonly state: PostPageEvidence | null;
    readonly target: BrowserLocatorPort | null;
  }> {
    const startedAt = Date.now();
    while (true) {
      const state = await this.readNonInteractiveState();
      if (state !== null) return { state, target: null };
      const target = await this.findTarget(expectedInteractionId);
      if (target !== null) return { state: null, target };
      const elapsed = Date.now() - startedAt;
      if (elapsed >= this.evidenceTimeoutMs) return { state: null, target: null };
      await this.sleep(Math.min(this.pollIntervalMs, this.evidenceTimeoutMs - elapsed));
    }
  }

  private async findDeleteAction(
    scope: BrowserPagePort | BrowserLocatorPort
  ): Promise<BrowserLocatorPort | null> {
    const stable = await this.findOne(scope, X_SELECTORS.post.deleteAction);
    if (stable !== null) {
      return stable;
    }
    return this.findByAccessibleText(scope, "menuitem", X_TEXT_KEYS.deleteAction);
  }

  private async findConfirmation(dialog: BrowserLocatorPort): Promise<BrowserLocatorPort | null> {
    const stable = await this.findOneInTarget(dialog, X_SELECTORS.post.confirmDelete);
    if (stable !== null) {
      return stable;
    }
    return (
      (await this.findByAccessibleText(dialog, "button", X_TEXT_KEYS.confirmDelete)) ??
      this.findByAccessibleText(dialog, "menuitem", X_TEXT_KEYS.confirmDelete)
    );
  }

  private async waitForDeleteAction(
    scope: BrowserPagePort | BrowserLocatorPort
  ): Promise<BrowserLocatorPort | null> {
    return this.waitFor(() => this.findDeleteAction(scope));
  }

  private async waitForConfirmation(
    dialog: BrowserLocatorPort
  ): Promise<BrowserLocatorPort | null> {
    return this.waitFor(() => this.findConfirmation(dialog));
  }

  private async waitForOne(
    scope: BrowserPagePort | BrowserLocatorPort,
    selectors: readonly string[]
  ): Promise<BrowserLocatorPort | null> {
    return this.waitFor(() => this.findOne(scope, selectors));
  }

  private async waitFor(
    find: () => Promise<BrowserLocatorPort | null>
  ): Promise<BrowserLocatorPort | null> {
    const startedAt = Date.now();
    while (true) {
      const found = await find();
      if (found !== null) return found;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= this.evidenceTimeoutMs) return null;
      await this.sleep(Math.min(this.pollIntervalMs, this.evidenceTimeoutMs - elapsed));
    }
  }

  private async findOneInTarget(
    target: BrowserLocatorPort,
    selectors: readonly string[]
  ): Promise<BrowserLocatorPort | null> {
    return this.findOne(target, selectors);
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

  private scopedLocator(
    scope: BrowserPagePort | BrowserLocatorPort,
    selector: string
  ): BrowserLocatorPort | null {
    if ("locator" in scope && typeof scope.locator === "function") {
      return scope.locator(selector);
    }
    return null;
  }

  private async findByAccessibleText(
    scope: BrowserPagePort | BrowserLocatorPort,
    role: string,
    texts: readonly string[]
  ): Promise<BrowserLocatorPort | null> {
    if (!("getByRole" in scope) || typeof scope.getByRole !== "function") {
      return null;
    }
    for (const text of texts) {
      const locator = scope.getByRole(role, {
        name: new RegExp(`^${escapeRegex(text)}$`, "iu"),
        exact: true
      });
      if ((await locator.count()) === 1) {
        const first = locator.first();
        if (await this.isUsable(first)) {
          return first;
        }
      }
    }
    return null;
  }

  private async hasUnauthenticatedEvidence(): Promise<boolean> {
    if (isXLoginUrl(this.page.url())) {
      return true;
    }
    if (await this.hasAnySelector(X_SELECTORS.account.login)) {
      return true;
    }
    const body = await this.bodyText();
    return X_TEXT_KEYS.login.some((phrase) => body.includes(phrase));
  }

  private async hasSessionExpiredEvidence(): Promise<boolean> {
    return this.hasAnySelector(X_SELECTORS.account.sessionExpired);
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
      const locator = this.page.locator(selector).first();
      if ((await locator.count()) > 0) {
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

export function deletePost(page: BrowserPagePort, input: PostPageInput): Promise<PostPageEvidence> {
  return new PostPage(page, input).deletePost();
}

function validateInteractionId(value: string): string {
  if (!isDecimalString(value)) {
    throw new Error("INVALID_INTERACTION_ID");
  }
  return value;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizeAuthor(raw: string | null): string | null {
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const value = raw.trim();
  const fromPath = value.match(/^\/[a-z0-9_][a-z0-9_-]{0,63}(?:[/?#]|$)/iu)?.[0];
  const candidate = fromPath === undefined ? value : fromPath.slice(1).split(/[/?#]/u)[0];
  if (candidate === undefined) {
    return null;
  }
  try {
    return normalizeAccountHandle(candidate);
  } catch {
    return null;
  }
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

function evidence(kind: PostPageEvidenceKind, reason: string): PostPageEvidence {
  return { kind, outcome: kind, reason };
}

function unknown(errorCode: string): PostPageEvidence {
  return { kind: "UNKNOWN", outcome: "UNKNOWN", reason: errorCode, errorCode };
}
