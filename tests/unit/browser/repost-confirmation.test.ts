import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BrowserLocatorPort,
  BrowserPagePort,
  BrowserResponsePort
} from "../../../src/infrastructure/browser/browser-session.js";
import { RepostPage } from "../../../src/infrastructure/browser/x/repost-page.js";
import { BrowserCleanerEngine } from "../../../src/infrastructure/browser/browser-cleaner-engine.js";
import type { XInteractionId } from "../../../src/domain/interaction.js";

type Scenario = "persisted" | "menu-missing" | "reverted" | "rejected" | "timeout" | "unfinished";

describe("confirmação durável de repost", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ["persisted", "COMPLETED", "REPOST_INACTIVE_AFTER_RELOAD"],
    ["menu-missing", "UNKNOWN", "UNDO_REPOST_CONFIRMATION_MISSING"],
    ["reverted", "UNKNOWN", "UNDO_REPOST_NOT_CONFIRMED"],
    ["rejected", "UNKNOWN", "UNDO_REPOST_RESPONSE_NOT_CONFIRMED"],
    ["timeout", "UNKNOWN", "UNDO_REPOST_RESPONSE_NOT_CONFIRMED"],
    ["unfinished", "UNKNOWN", "UNDO_REPOST_RESPONSE_NOT_CONFIRMED"]
  ] as const)("trata %s sem assumir sucesso visual", async (scenario, kind, reason) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fixture = syntheticPage(scenario);
    const result = await new RepostPage(fixture.page, {
      expectedHandle: "author",
      expectedInteractionId: "999",
      expectedOrigin: "https://x.com",
      requireOwnerRepostEvidence: true,
      confirmRepostMenu: true,
      sleep: async (milliseconds) => {
        vi.setSystemTime(Date.now() + milliseconds);
      }
    }).undoRepost();

    expect(result).toMatchObject({ kind, reason });
    expect(fixture.openClicks()).toBe(1);
    expect(fixture.undoClicks()).toBe(scenario === "menu-missing" ? 0 : 1);
    expect(fixture.reloads()).toBe(["persisted", "reverted"].includes(scenario) ? 1 : 0);
  });

  it.each([
    "Hmm...this page doesn’t exist. Try searching for something else.",
    "Hmm...this page doesn't exist. Try searching for something else.",
    "Esta página não existe."
  ])("trata URL do repost inexistente sem tentar remover novamente: %s", async (message) => {
    const click = vi.fn();
    const empty: BrowserLocatorPort = {
      first: () => empty,
      count: async () => 0,
      getAttribute: async () => null,
      textContent: async () => message,
      innerText: async () => message,
      click
    };
    const page: BrowserPagePort = {
      goto: async () => {},
      url: () => "https://x.com/owner/status/123",
      locator: () => empty
    };
    const engine = new BrowserCleanerEngine({
      confirmedHandle: "owner",
      contextFactory: {
        profileDirectory: "synthetic",
        launch: async () => ({ newPage: async () => page, close: async () => {} })
      }
    });
    try {
      const state = await engine.execute({
        runId: "synthetic-run",
        runItemId: 1,
        interaction: {
          id: 1,
          accountId: "synthetic-account",
          xInteractionId: "123" as XInteractionId,
          type: "REPOST",
          interactionCreatedAt: null,
          contentPreview: null,
          sourceRelativePath: "data/records.js",
          sourceRecordKey: "0",
          firstSeenImportId: "synthetic-import",
          lastSeenImportId: "synthetic-import",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      });
      expect(state).toMatchObject({ kind: "TERMINAL_NON_ERROR", outcome: "NOT_FOUND" });
      expect(click).not.toHaveBeenCalled();
    } finally {
      await engine.close();
    }
  });
});

function syntheticPage(scenario: Scenario) {
  let menuOpened = false;
  let active = true;
  let reloaded = false;
  let responseRegistered = false;
  let responseFinished = false;
  let openClicks = 0;
  let undoClicks = 0;
  let reloads = 0;
  let resolveResponse: ((response: BrowserResponsePort) => void) | undefined;
  let rejectResponse: ((error: Error) => void) | undefined;
  const response: BrowserResponsePort = {
    url: () => "https://x.com/i/api/graphql/synthetic/DeleteRetweet",
    request: () => ({ method: () => "POST" }),
    ok: () => scenario !== "rejected",
    finished: async () => {
      responseFinished = true;
      return scenario === "unfinished" ? new Error("synthetic response failure") : null;
    }
  };

  const locator = (selector: string, nested = false): BrowserLocatorPort => {
    const isTarget = !nested && selector === '[data-testid="tweet"]';
    const isAction = nested && selector === '[data-testid="unretweet"]';
    const isInactive = nested && selector === '[data-testid="retweet"]';
    const isMenu = selector === '[role="menuitem"]' && menuOpened && scenario !== "menu-missing";
    const matches = () =>
      isTarget ||
      (isAction && active) ||
      (isInactive && reloaded && !active) ||
      isMenu ||
      selector === "body";
    const result: BrowserLocatorPort = {
      first: () => result,
      count: async () => Number(matches()),
      isVisible: async () => matches(),
      getAttribute: async (name) => (isTarget && name === "data-tweet-id" ? "999" : null),
      innerText: async () =>
        isMenu ? "Undo repost" : reloaded && !active ? "synthetic" : "You reposted",
      textContent: async () => (isMenu ? "Undo repost" : "synthetic"),
      locator: (child) => locator(child, true),
      click: async () => {
        if (isAction) {
          openClicks += 1;
          menuOpened = true;
          // The optimistic UI hides the active button before confirmation.
          active = false;
        } else if (isMenu) {
          expect(responseRegistered).toBe(true);
          undoClicks += 1;
          if (scenario === "timeout") rejectResponse?.(new Error("synthetic timeout"));
          else resolveResponse?.(response);
        } else {
          throw new Error("unexpected synthetic click");
        }
      }
    };
    return result;
  };

  const page: BrowserPagePort = {
    url: () => "https://x.com/author/status/999",
    locator: (selector) => locator(selector),
    waitForResponse: (predicate) => {
      expect(predicate(response)).toBe(true);
      expect(predicate({ ...response, request: () => ({ method: () => "GET" }) })).toBe(false);
      expect(predicate({ ...response, url: () => "https://x.com/unrelated" })).toBe(false);
      expect(
        predicate({ ...response, url: () => "https://x.com/i/api/graphql/synthetic/CreateRetweet" })
      ).toBe(false);
      responseRegistered = true;
      return new Promise((resolve, reject) => {
        resolveResponse = resolve;
        rejectResponse = reject;
      });
    },
    goto: async () => {
      expect(undoClicks).toBe(1);
      expect(responseFinished).toBe(true);
      reloads += 1;
      reloaded = true;
      active = scenario === "reverted";
    }
  };
  return {
    page,
    openClicks: () => openClicks,
    undoClicks: () => undoClicks,
    reloads: () => reloads
  };
}
