import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostPage } from "../../../src/infrastructure/browser/x/post-page.js";

describe("PostPage em páginas locais semânticas", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: true,
      executablePath: await findChromiumExecutable()
    });
    page = await browser.newPage();
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
  }, 30_000);

  async function load(html: string): Promise<PostPage> {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    return new PostPage(page, {
      expectedHandle: "owner",
      expectedInteractionId: "123"
    });
  }

  it("prova ID e autor, abre o menu semântico, confirma e só então relata exclusão", async () => {
    const result = await (
      await load(`
        <article data-testid="tweet" data-tweet-id="123" data-author-handle="owner">
          <button data-testid="post-menu" type="button">Mais</button>
          <div role="menu" hidden>
            <button role="menuitem" data-testid="delete-post" type="button">Excluir</button>
          </div>
          <div role="dialog" hidden>
            <button data-testid="confirm-delete" type="button">Excluir</button>
          </div>
        </article>
        <script>
          const article = document.querySelector('[data-testid="tweet"]');
          const menu = document.querySelector('[role="menu"]');
          const dialog = document.querySelector('[role="dialog"]');
          document.querySelector('[data-testid="post-menu"]').onclick = () => { menu.hidden = false; };
          document.querySelector('[data-testid="delete-post"]').onclick = () => { dialog.hidden = false; };
          document.querySelector('[data-testid="confirm-delete"]').onclick = () => {
            article.remove();
            document.body.insertAdjacentHTML('beforeend', '<div data-post-state="deleted">Publicação excluída</div>');
          };
        </script>
      `)
    ).deletePost();

    expect(result).toEqual({
      kind: "DELETED",
      outcome: "DELETED",
      reason: "DELETED_CONFIRMED"
    });
  });

  it("aguarda o DOM atual e escolhe somente o artigo ligado ao status exato", async () => {
    await page.setContent(`
      <article data-testid="tweet">
        <a href="/other/status/999">Outro post</a>
        <button data-testid="post-menu" type="button" onclick="window.otherClicks++">Mais</button>
      </article>
      <div id="mount"></div>
      <div id="global-menu" role="menu" hidden>
        <button role="menuitem" type="button">Delete</button>
      </div>
      <div id="global-dialog" data-testid="confirmationSheetDialog" hidden>
        <button data-testid="confirmationSheetConfirm" type="button">Delete</button>
      </div>
      <script>
        window.otherClicks = 0;
        setTimeout(() => {
          document.querySelector("#mount").innerHTML =
            '<article data-testid="tweet">' +
            '<a href="/owner">@owner</a>' +
            '<a href="/owner/status/123">Data</a>' +
            '<button data-testid="caret" type="button">Mais</button>' +
            '</article>';
          const target = document.querySelector('#mount article');
          const menu = document.querySelector('#global-menu');
          const dialog = document.querySelector('#global-dialog');
          target.querySelector('[data-testid="caret"]').onclick = () => menu.hidden = false;
          menu.querySelector('[role="menuitem"]').onclick = () => dialog.hidden = false;
          dialog.querySelector('[data-testid="confirmationSheetConfirm"]').onclick = () => {
            target.remove();
            document.body.insertAdjacentHTML('beforeend', '<div data-post-state="deleted">Post deleted</div>');
          };
        }, 25);
      </script>
    `);

    const result = await new PostPage(page, {
      expectedHandle: "owner",
      expectedInteractionId: "123",
      evidenceTimeoutMs: 1_000,
      pollIntervalMs: 5
    }).deletePost();

    expect(result).toEqual({
      kind: "DELETED",
      outcome: "DELETED",
      reason: "DELETED_CONFIRMED"
    });
    expect(await page.evaluate(() => window.otherClicks)).toBe(0);
  });

  it.each([
    [
      "já removido",
      '<main data-post-state="deleted">Post deleted</main>',
      { kind: "ALREADY_REMOVED", outcome: "ALREADY_REMOVED", reason: "DELETED_STATE" }
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
  ] as const)("relata o estado %s sem clicar", async (_label, html, expected) => {
    const result = await (await load(html)).deletePost();
    expect(result).toEqual(expected);
  });

  it("para sem clicar quando o ID do status diverge", async () => {
    await page.setContent(`
      <article data-testid="tweet" data-tweet-id="999" data-author-handle="owner">
        <button data-testid="post-menu" type="button" onclick="window.menuClicks = (window.menuClicks || 0) + 1">Mais</button>
        <button data-testid="delete-post" type="button" onclick="window.destructiveClicks = (window.destructiveClicks || 0) + 1">Excluir</button>
        <button data-testid="confirm-delete" type="button" onclick="window.destructiveClicks = (window.destructiveClicks || 0) + 1">Confirmar</button>
      </article>
    `);
    const result = await new PostPage(page, {
      expectedHandle: "owner",
      expectedInteractionId: "123",
      evidenceTimeoutMs: 0
    }).deletePost();

    expect(result).toEqual({
      kind: "UNKNOWN",
      outcome: "UNKNOWN",
      reason: "STATUS_IDENTITY_MISMATCH",
      errorCode: "STATUS_IDENTITY_MISMATCH"
    });
    expect(await page.evaluate(() => window.destructiveClicks ?? 0)).toBe(0);
  });

  it("para sem clicar quando o autor do status diverge mesmo com o ID correto", async () => {
    await page.setContent(`
      <article data-testid="tweet" data-tweet-id="123" data-author-handle="outra-conta">
        <button data-testid="post-menu" type="button" onclick="window.menuClicks = (window.menuClicks || 0) + 1">Mais</button>
        <button data-testid="delete-post" type="button" onclick="window.destructiveClicks = (window.destructiveClicks || 0) + 1">Excluir</button>
        <button data-testid="confirm-delete" type="button" onclick="window.destructiveClicks = (window.destructiveClicks || 0) + 1">Confirmar</button>
      </article>
    `);
    const result = await new PostPage(page, {
      expectedHandle: "owner",
      expectedInteractionId: "123",
      evidenceTimeoutMs: 0
    }).deletePost();

    expect(result).toEqual({
      kind: "UNKNOWN",
      outcome: "UNKNOWN",
      reason: "AUTHOR_IDENTITY_MISMATCH",
      errorCode: "AUTHOR_IDENTITY_MISMATCH"
    });
    expect(await page.evaluate(() => window.destructiveClicks ?? 0)).toBe(0);
  });

  it("não especula nem clica quando a interface está em estado desconhecido", async () => {
    await page.setContent(`
      <article data-testid="tweet" data-tweet-id="123" data-author-handle="owner">
        <p>Estado novo sem ação documentada</p>
        <button data-testid="new-action" type="button" onclick="window.menuClicks = (window.menuClicks || 0) + 1">Nova ação</button>
        <button data-testid="delete-post" type="button" hidden onclick="window.destructiveClicks = (window.destructiveClicks || 0) + 1">Excluir</button>
        <button data-testid="confirm-delete" type="button" hidden onclick="window.destructiveClicks = (window.destructiveClicks || 0) + 1">Confirmar</button>
      </article>
    `);
    const result = await new PostPage(page, {
      expectedHandle: "owner",
      expectedInteractionId: "123",
      evidenceTimeoutMs: 0
    }).deletePost();

    expect(result).toEqual({
      kind: "UNKNOWN",
      outcome: "UNKNOWN",
      reason: "DELETE_CONTROL_MISSING",
      errorCode: "DELETE_CONTROL_MISSING"
    });
    expect(await page.evaluate(() => window.menuClicks ?? 0)).toBe(0);
    expect(await page.evaluate(() => window.destructiveClicks ?? 0)).toBe(0);
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
