import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RepostPage } from "../../../src/infrastructure/browser/x/repost-page.js";

describe("RepostPage em páginas locais semânticas", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: true,
      executablePath: await findChromiumExecutable()
    });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close();
  }, 30_000);

  it("prova o status, desfaz apenas o repost e nunca clica em excluir publicação", async () => {
    await page.setContent(`
      <article data-testid="tweet" data-tweet-id="123" data-author-handle="third-party">
        <button data-testid="undo-repost" type="button">Undo repost</button>
        <button data-testid="delete-post" type="button">Delete post</button>
      </article>
      <script>
        window.undoClicks = 0;
        window.deleteClicks = 0;
        const article = document.querySelector('[data-testid="tweet"]');
        const undo = document.querySelector('[data-testid="undo-repost"]');
        undo.onclick = () => {
          window.undoClicks += 1;
          undo.hidden = true;
          article.dataset.repostState = 'undone';
        };
        document.querySelector('[data-testid="delete-post"]').onclick = () => {
          window.deleteClicks += 1;
        };
      </script>
    `);

    const result = await new RepostPage(page, {
      expectedHandle: "owner",
      expectedInteractionId: "123"
    }).undoRepost();

    expect(result).toEqual({
      kind: "COMPLETED",
      outcome: "COMPLETED",
      reason: "REACTION_REMOVED_CONFIRMED"
    });
    expect(await page.evaluate(() => window.undoClicks ?? 0)).toBe(1);
    expect(await page.evaluate(() => window.deleteClicks ?? 0)).toBe(0);
  });

  it.each([
    [
      "já removido",
      '<main data-repost-state="undone">Repost removed</main>',
      { kind: "ALREADY_REMOVED", outcome: "ALREADY_REMOVED", reason: "REACTION_REMOVED_STATE" }
    ],
    [
      "não encontrado",
      '<main data-post-state="not-found">Post not found</main>',
      { kind: "NOT_FOUND", outcome: "NOT_FOUND", reason: "NOT_FOUND_STATE" }
    ],
    [
      "indisponível",
      '<main data-post-state="unavailable">Post unavailable</main>',
      { kind: "UNAVAILABLE", outcome: "UNAVAILABLE", reason: "UNAVAILABLE_STATE" }
    ],
    [
      "não autenticado",
      '<main data-testid="login">Entrar</main>',
      { kind: "UNAUTHENTICATED", outcome: "UNAUTHENTICATED", reason: "LOGIN_REQUIRED" }
    ],
    [
      "desafio",
      '<main data-testid="security-challenge">Security challenge</main>',
      { kind: "CHALLENGE", outcome: "CHALLENGE", reason: "SECURITY_CHALLENGE" }
    ]
  ] as const)("relata %s sem clicar", async (_label, html, expected) => {
    await page.setContent(html);
    const result = await new RepostPage(page, {
      expectedHandle: "owner",
      expectedInteractionId: "123"
    }).undoRepost();

    expect(result).toEqual(expected);
  });

  it("para sem clicar quando o status alvo diverge", async () => {
    await page.setContent(`
      <article data-testid="tweet" data-tweet-id="999" data-author-handle="third-party">
        <button data-testid="undo-repost" type="button" onclick="window.clicks++">Undo repost</button>
      </article>
      <script>window.clicks = 0;</script>
    `);

    const result = await new RepostPage(page, {
      expectedHandle: "owner",
      expectedInteractionId: "123"
    }).undoRepost();

    expect(result).toEqual({
      kind: "UNKNOWN",
      outcome: "UNKNOWN",
      reason: "STATUS_IDENTITY_MISMATCH",
      errorCode: "STATUS_IDENTITY_MISMATCH"
    });
    expect(await page.evaluate(() => window.clicks ?? 0)).toBe(0);
  });

  it("não especula nem clica quando não há controle semântico de desfazer", async () => {
    await page.setContent(`
      <article data-testid="tweet" data-tweet-id="123" data-author-handle="third-party">
        <button data-testid="new-action" type="button" onclick="window.clicks++">New action</button>
      </article>
      <script>window.clicks = 0;</script>
    `);

    const result = await new RepostPage(page, {
      expectedHandle: "owner",
      expectedInteractionId: "123"
    }).undoRepost();

    expect(result).toEqual({
      kind: "UNKNOWN",
      outcome: "UNKNOWN",
      reason: "UNDO_REPOST_CONTROL_MISSING",
      errorCode: "UNDO_REPOST_CONTROL_MISSING"
    });
    expect(await page.evaluate(() => window.clicks ?? 0)).toBe(0);
  });
});

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
