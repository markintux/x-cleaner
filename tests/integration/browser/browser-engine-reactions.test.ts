import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CleanerEngineInteraction } from "../../../src/application/ports/cleaner-engine.js";
import { BrowserCleanerEngine } from "../../../src/infrastructure/browser/browser-cleaner-engine.js";

describe("BrowserCleanerEngine para REPOST e LIKE", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: true,
      executablePath: await findChromiumExecutable()
    });
    context = await browser.newContext();
    page = await context.newPage();
  });

  afterAll(async () => {
    await context?.close();
    await browser?.close();
  });

  it.each([
    [
      "REPOST",
      `
        <article data-testid="tweet" data-tweet-id="123" data-author-handle="third-party">
          <button data-testid="undo-repost" type="button">Undo repost</button>
          <button data-testid="delete-post" type="button" onclick="window.deleteClicks++">Delete post</button>
        </article>
        <script>
          window.deleteClicks = 0;
          const article = document.querySelector('[data-testid="tweet"]');
          const undo = document.querySelector('[data-testid="undo-repost"]');
          undo.onclick = () => { undo.hidden = true; article.dataset.repostState = 'undone'; };
        </script>
      `,
      "COMPLETED"
    ],
    [
      "LIKE",
      `
        <article data-testid="tweet" data-tweet-id="123" data-author-handle="third-party">
          <button data-testid="unlike" type="button">Unlike</button>
        </article>
        <script>
          const article = document.querySelector('[data-testid="tweet"]');
          const unlike = document.querySelector('[data-testid="unlike"]');
          unlike.onclick = () => { unlike.hidden = true; article.dataset.likeState = 'unliked'; };
        </script>
      `,
      "COMPLETED"
    ]
  ] as const)("mapeia %s para o contrato Core", async (type, html, expectedOutcome) => {
    await page.route("http://local.test/owner/status/123", async (route) => {
      await route.fulfill({ contentType: "text/html", body: html });
    });

    const engine = new BrowserCleanerEngine({
      page,
      confirmedHandle: "owner",
      statusUrlBuilder: () => "http://local.test/owner/status/123"
    });
    const result = await engine.execute(interaction(type));

    expect(result).toMatchObject({
      kind: "COMPLETED",
      outcome: expectedOutcome,
      durationMs: expect.any(Number)
    });
    if (type === "REPOST") {
      expect(await page.evaluate(() => window.deleteClicks ?? 0)).toBe(0);
    }
    await page.unroute("http://local.test/owner/status/123");
  });

  it.each([
    [
      '<main data-repost-state="undone">Repost removed</main>',
      { kind: "TERMINAL_NON_ERROR", outcome: "ALREADY_REMOVED" }
    ],
    [
      '<main data-post-state="not-found">Post not found</main>',
      { kind: "TERMINAL_NON_ERROR", outcome: "NOT_FOUND" }
    ],
    [
      '<main data-post-state="unavailable">Post unavailable</main>',
      { kind: "TERMINAL_NON_ERROR", outcome: "UNAVAILABLE" }
    ],
    [
      '<main data-testid="login">Entrar</main>',
      { kind: "SESSION_EXPIRED", outcome: "PAUSED", pauseReason: "SESSION_EXPIRED" }
    ],
    [
      '<main data-testid="security-challenge">Security challenge</main>',
      {
        kind: "CHALLENGE_OR_RATE_LIMIT",
        outcome: "PAUSED",
        pauseReason: "SECURITY_CHALLENGE"
      }
    ],
    [
      '<article data-testid="tweet" data-tweet-id="123" data-author-handle="third-party"><button data-testid="new-action">New action</button></article>',
      { kind: "UNKNOWN_UI", outcome: "PAUSED", pauseReason: "UNKNOWN_UI" }
    ]
  ] as const)("mapeia estados seguros sem adivinhar", async (html, expected) => {
    await page.route("http://local.test/owner/status/123", async (route) => {
      await route.fulfill({ contentType: "text/html", body: html });
    });

    const engine = new BrowserCleanerEngine({
      page,
      confirmedHandle: "owner",
      statusUrlBuilder: () => "http://local.test/owner/status/123"
    });
    const result = await engine.execute(interaction("REPOST"));

    expect(result).toMatchObject({ ...expected, durationMs: expect.any(Number) });
    await page.unroute("http://local.test/owner/status/123");
  });
});

function interaction(type: "REPOST" | "LIKE"): CleanerEngineInteraction {
  return {
    runId: "run-local",
    runItemId: 1,
    interaction: {
      id: 1,
      accountId: "account-local",
      xInteractionId: "123" as never,
      type,
      interactionCreatedAt: null,
      contentPreview: null,
      sourceRelativePath: "synthetic/reactions.js",
      sourceRecordKey: "1",
      firstSeenImportId: "import-local",
      lastSeenImportId: "import-local",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  };
}

async function findChromiumExecutable(): Promise<string> {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    ...(os.platform() === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : os.platform() === "win32"
        ? [
            path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
            "C:/Program Files/Google/Chrome/Application/chrome.exe",
            "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"])
  ].filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next local browser candidate.
    }
  }
  throw new Error("NO_LOCAL_CHROMIUM_EXECUTABLE");
}
