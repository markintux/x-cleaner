import type {
  BrowserLocatorPort,
  BrowserPagePort
} from "../../../application/ports/browser-session.js";
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
}

export interface ReactionPageActionConfig {
  readonly targetSelectors: readonly string[];
  readonly idAttributes: readonly string[];
  readonly actionSelectors: readonly string[];
  readonly actionNames: readonly string[];
  readonly removedStateSelectors: readonly string[];
  readonly missingActionCode: string;
  readonly notConfirmedCode: string;
}

/**
 * Shared evidence-only mechanics for reactions. It deliberately knows only
 * about semantic selector candidates supplied by the operation page object.
 */
export class ReactionPageSupport {
  constructor(
    private readonly page: BrowserPagePort,
    private readonly options: ReactionPageOptions,
    private readonly config: ReactionPageActionConfig
  ) {}

  async execute(input?: ReactionPageInput): Promise<ReactionPageEvidence> {
    const expected = this.resolveExpected(input);
    if (expected === null) {
      return unknown("INVALID_EXPECTED_IDENTITY");
    }

    const initialState = await this.readNonInteractiveState();
    if (initialState !== null) {
      return initialState;
    }

    const target = await this.findTarget();
    if (target === null) {
      return unknown("TARGET_EVIDENCE_MISSING");
    }

    const identity = await this.proveIdentity(target, expected);
    if (identity !== null) {
      return identity;
    }

    const action = await this.findAction(target);
    if (action === null) {
      return unknown(this.config.missingActionCode);
    }

    await action.click();
    return (await this.readAfterAction(target)) ?? unknown(this.config.notConfirmedCode);
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

  private async proveIdentity(
    target: BrowserLocatorPort,
    expected: ReactionPageInput
  ): Promise<ReactionPageEvidence | null> {
    const observedIds = await this.readTargetValues(target, this.config.idAttributes);
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

  private async findTarget(): Promise<BrowserLocatorPort | null> {
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
    return null;
  }

  private async findAction(target: BrowserLocatorPort): Promise<BrowserLocatorPort | null> {
    const stable = await this.findOne(target, this.config.actionSelectors);
    if (stable !== null) {
      return stable;
    }
    return this.findByAccessibleText(target, "button", this.config.actionNames);
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

export function reactionConfig(
  actionSelectors: readonly string[],
  actionNames: readonly string[],
  removedStateSelectors: readonly string[],
  missingActionCode: string,
  notConfirmedCode: string,
  targetSelectors: readonly string[],
  idAttributes: readonly string[]
): ReactionPageActionConfig {
  return {
    actionSelectors,
    actionNames,
    removedStateSelectors,
    missingActionCode,
    notConfirmedCode,
    targetSelectors,
    idAttributes
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
