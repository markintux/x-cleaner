import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ConfirmBatch } from "../../../src/application/runs/confirm-batch.js";
import { CreateRun } from "../../../src/application/runs/create-run.js";
import { ExecuteBatch } from "../../../src/application/runs/execute-batch.js";
import { createCleaningPlan } from "../../../src/application/plans/create-cleaning-plan.js";
import type { CleanerEngineInteraction } from "../../../src/application/ports/cleaner-engine.js";
import { ExecutorLock } from "../../../src/infrastructure/lock/executor-lock.js";
import { UnitOfWork } from "../../../src/infrastructure/database/unit-of-work.js";
import { BrowserCleanerEngine } from "../../../src/infrastructure/browser/browser-cleaner-engine.js";
import { FakePrompt } from "../../support/fake-prompt.js";
import {
  addInteraction,
  createDatabaseFixture,
  fixedNow,
  seedCatalog
} from "../../support/database.js";

describe("BrowserCleanerEngine para POST e REPLY", () => {
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
  }, 30_000);

  it.each(["POST", "REPLY"] as const)("delega a exclusão para %s", async (type) => {
    await page.route("http://local.test/status/123", async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `
          <article data-testid="tweet" data-tweet-id="123" data-author-handle="owner">
            <button data-testid="post-menu" type="button">Mais</button>
            <div role="menu" hidden><button role="menuitem" data-testid="delete-post" type="button">Delete</button></div>
            <div role="dialog" hidden><button data-testid="confirm-delete" type="button">Delete</button></div>
          </article>
          <script>
            const menu = document.querySelector('[role="menu"]');
            const dialog = document.querySelector('[role="dialog"]');
            document.querySelector('[data-testid="post-menu"]').onclick = () => menu.hidden = false;
            document.querySelector('[data-testid="delete-post"]').onclick = () => dialog.hidden = false;
            document.querySelector('[data-testid="confirm-delete"]').onclick = () => {
              document.querySelector('[data-testid="tweet"]').remove();
              document.body.insertAdjacentHTML('beforeend', '<div data-post-state="deleted">Post deleted</div>');
            };
          </script>
        `
      });
    });

    const launch = vi.fn(
      async () =>
        ({
          newPage: async () => page,
          close: async () => undefined
        }) satisfies { newPage(): Promise<Page>; close(): Promise<void> }
    );
    const input = interaction(type);
    const engine = new BrowserCleanerEngine({
      confirmedHandle: "owner",
      contextFactory: { profileDirectory: "local", launch },
      statusUrlBuilder: () => "http://local.test/status/123"
    });

    await expect(engine.execute(input)).resolves.toEqual({
      kind: "COMPLETED",
      outcome: "COMPLETED",
      durationMs: expect.any(Number)
    });
    expect(launch).toHaveBeenCalledTimes(1);
    await engine.close();
    await page.unroute("http://local.test/status/123");
  });

  it("mapeia estados terminais, sessão expirada, desafio e estado desconhecido", async () => {
    const fixtures = [
      [
        '<main data-post-state="deleted">Post deleted</main>',
        {
          kind: "TERMINAL_NON_ERROR",
          outcome: "ALREADY_REMOVED"
        }
      ],
      [
        '<main data-post-state="not-found">Post not found</main>',
        {
          kind: "TERMINAL_NON_ERROR",
          outcome: "NOT_FOUND"
        }
      ],
      [
        '<main data-post-state="unavailable">Post unavailable</main>',
        {
          kind: "TERMINAL_NON_ERROR",
          outcome: "UNAVAILABLE"
        }
      ],
      [
        '<main data-testid="login">Entrar</main>',
        {
          kind: "SESSION_EXPIRED",
          outcome: "PAUSED",
          pauseReason: "SESSION_EXPIRED",
          errorCode: "LOGIN_REQUIRED"
        }
      ],
      [
        '<main data-testid="security-challenge">Security challenge</main>',
        {
          kind: "CHALLENGE_OR_RATE_LIMIT",
          outcome: "PAUSED",
          pauseReason: "SECURITY_CHALLENGE",
          errorCode: "SECURITY_CHALLENGE"
        }
      ],
      [
        `<article data-testid="tweet" data-tweet-id="123" data-author-handle="other">
          <button data-testid="post-menu" type="button" onclick="window.menuClicks++">Mais</button>
          <button data-testid="delete-post" type="button" onclick="window.destructiveClicks++">Excluir</button>
          <button data-testid="confirm-delete" type="button" onclick="window.destructiveClicks++">Confirmar</button>
        </article>
        <script>window.menuClicks = 0; window.destructiveClicks = 0;</script>`,
        {
          kind: "UNKNOWN_UI",
          outcome: "PAUSED",
          pauseReason: "UNKNOWN_UI",
          errorCode: "AUTHOR_IDENTITY_MISMATCH"
        }
      ]
    ] as const;

    for (const [html, expected] of fixtures) {
      await page.route("http://local.test/status/123", async (route) => {
        await route.fulfill({ contentType: "text/html", body: html });
      });
      const launch = vi.fn(
        async () =>
          ({
            newPage: async () => page,
            close: async () => undefined
          }) satisfies { newPage(): Promise<Page>; close(): Promise<void> }
      );
      const engine = new BrowserCleanerEngine({
        confirmedHandle: "owner",
        contextFactory: { profileDirectory: "local", launch },
        statusUrlBuilder: () => "http://local.test/status/123"
      });
      const result = await engine.execute(interaction("POST"));
      expect(result).toEqual({ ...expected, durationMs: expect.any(Number) });
      expect(await page.evaluate(() => window.menuClicks ?? 0)).toBe(0);
      expect(await page.evaluate(() => window.destructiveClicks ?? 0)).toBe(0);
      await engine.close();
      await page.unroute("http://local.test/status/123");
    }
  });

  it("mantém um plano somente de REPLY isolado de itens POST até o BrowserEngine", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const postId = addInteraction(fixture, accountId, importId, 1, "POST");
      const replyId = addInteraction(fixture, accountId, importId, 2, "REPLY");
      const plan = createCleaningPlan(
        fixture.transactions,
        fixture.catalog,
        fixture.plans,
        { accountId, types: ["REPLY"] },
        { now: () => fixedNow, idFactory: () => "plan-reply-only" }
      );

      expect(plan.types).toEqual(["REPLY"]);
      expect(plan.items.map((item) => item.interactionId)).toEqual([replyId]);
      expect(plan.items.map((item) => item.interactionId)).not.toContain(postId);

      const managed = fixture.catalog.getManagedAccount()!;
      fixture.catalog.upsertManagedAccount({
        id: managed.id,
        xUserId: managed.xUserId,
        archiveHandle: managed.archiveHandle,
        confirmedHandle: managed.archiveHandle,
        confirmedAt: fixedNow
      });
      const account = { handle: managed.archiveHandle!, xUserId: managed.xUserId };
      const run = new CreateRun(fixture.plans, fixture.catalog, fixture.runs, {
        now: () => fixedNow,
        idFactory: () => "run-reply-only"
      }).execute({ planId: plan.plan.id, account });
      const confirmation = await new ConfirmBatch(
        fixture.plans,
        fixture.catalog,
        fixture.runs,
        new FakePrompt(["APAGAR"]),
        { now: () => fixedNow, idFactory: () => "batch-reply-only" }
      ).execute({ run: run.run, account });
      expect(confirmation.confirmed).toBe(true);

      const reply = fixture.catalog.getInteraction(replyId)!;
      const post = fixture.catalog.getInteraction(postId)!;
      const visited: string[] = [];
      await page.route("http://local.test/status/*", async (route) => {
        visited.push(route.request().url());
        await route.fulfill({
          contentType: "text/html",
          body: `
            <article data-testid="tweet" data-tweet-id="${reply.xInteractionId}" data-author-handle="${account.handle}">
              <button data-testid="post-menu" type="button">Mais</button>
              <div role="menu" hidden><button role="menuitem" data-testid="delete-post" type="button">Excluir</button></div>
              <div role="dialog" hidden><button data-testid="confirm-delete" type="button">Excluir</button></div>
            </article>
            <script>
              const article = document.querySelector('[data-testid="tweet"]');
              const menu = document.querySelector('[role="menu"]');
              const dialog = document.querySelector('[role="dialog"]');
              document.querySelector('[data-testid="post-menu"]').onclick = () => { menu.hidden = false; };
              document.querySelector('[data-testid="delete-post"]').onclick = () => { dialog.hidden = false; };
              document.querySelector('[data-testid="confirm-delete"]').onclick = () => {
                article.remove();
                document.body.insertAdjacentHTML('beforeend', '<div data-post-state="deleted">Post deleted</div>');
              };
            </script>
          `
        });
      });

      const engine = new BrowserCleanerEngine({
        page,
        confirmedHandle: account.handle,
        statusUrlBuilder: (_handle, interactionId) => `http://local.test/status/${interactionId}`
      });
      const execution = await new ExecuteBatch(
        {
          plans: fixture.plans,
          catalog: fixture.catalog,
          runs: fixture.runs,
          audit: fixture.audit,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit),
          lock: new ExecutorLock(fixture.directory),
          engine
        },
        { clock: { now: () => fixedNow } }
      ).execute({
        runId: run.run.id,
        batchId: confirmation.batch!.id,
        account
      });

      expect(execution.processedCount).toBe(1);
      expect(visited).toEqual([`http://local.test/status/${reply.xInteractionId}`]);
      expect(visited).not.toContain(`http://local.test/status/${post.xInteractionId}`);
      expect(fixture.runs.listRunItems(run.run.id).map((item) => item.status)).toEqual([
        "COMPLETED"
      ]);
      await page.unroute("http://local.test/status/*");
    } finally {
      await fixture.cleanup();
    }
  });

  it("recusa tipos fora do fluxo de posts e não abre navegador", async () => {
    const launch = vi.fn();
    const engine = new BrowserCleanerEngine({
      confirmedHandle: "owner",
      contextFactory: { profileDirectory: "local", launch }
    });
    const result = await engine.execute(interaction("LIKE"));

    expect(result).toMatchObject({
      kind: "PERMANENT_FAILURE",
      errorCode: "UNSUPPORTED_INTERACTION_TYPE"
    });
    expect(launch).not.toHaveBeenCalled();
  });

  it("não executa ação quando a identidade do alvo diverge", async () => {
    let clicks = 0;
    await page.route("http://local.test/status/123", async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `<article data-testid="tweet" data-tweet-id="999" data-author-handle="owner"><button data-testid="post-menu" type="button" onclick="window.clicks++">Mais</button></article><script>window.clicks = 0</script>`
      });
    });
    const engine = new BrowserCleanerEngine({
      confirmedHandle: "owner",
      contextFactory: {
        profileDirectory: "local",
        launch: async () => ({ newPage: async () => page, close: async () => undefined })
      },
      statusUrlBuilder: () => "http://local.test/status/123"
    });
    const result = await engine.execute(interaction("POST"));
    clicks = await page.evaluate(() => window.clicks ?? 0);

    expect(result).toEqual({
      kind: "UNKNOWN_UI",
      outcome: "PAUSED",
      pauseReason: "UNKNOWN_UI",
      errorCode: "STATUS_IDENTITY_MISMATCH",
      durationMs: expect.any(Number)
    });
    expect(clicks).toBe(0);
    await engine.close();
    await page.unroute("http://local.test/status/123");
  });
});

function interaction(type: "POST" | "REPLY" | "LIKE"): CleanerEngineInteraction {
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
      sourceRelativePath: "synthetic/posts.js",
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
