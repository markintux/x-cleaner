import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccountPage } from "../../../src/infrastructure/browser/x/account-page.js";

describe("AccountPage em fixtures HTML locais", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: true,
      executablePath: await findChromiumExecutable()
    });
    page = await browser.newPage();
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

  afterAll(async () => {
    await browser?.close();
  }, 30_000);

  async function accountPage(fixture: string): Promise<AccountPage> {
    await page.setContent(fixture, { waitUntil: "domcontentloaded" });
    return new AccountPage(page);
  }

  it("detecta handle e ID estável por evidência semântica", async () => {
    const result = await (
      await accountPage(`
        <main>
          <a data-testid="profile-link" href="/Exemplo" aria-label="Profile">Perfil</a>
          <span data-testid="account-id">9007199254740993</span>
        </main>
      `)
    ).detect();

    expect(result).toMatchObject({
      status: "AUTHENTICATED",
      account: { handle: "exemplo", xUserId: "9007199254740993" }
    });
  });

  it("distingue login necessário e sessão expirada", async () => {
    const unauthenticated = await (
      await accountPage('<a data-testid="login" href="/login">Entrar</a>')
    ).detect();
    const expired = await (
      await accountPage('<div data-session-expired="true">Sessão expirada</div>')
    ).detect();

    expect(unauthenticated).toMatchObject({ status: "UNAUTHENTICATED", reason: "LOGIN_REQUIRED" });
    expect(expired).toMatchObject({ status: "UNAUTHENTICATED", reason: "SESSION_EXPIRED" });
  });

  it("para diante de desafio de segurança e estado desconhecido", async () => {
    const challenge = await (
      await accountPage("<main><h1>Security challenge</h1></main>")
    ).detect();
    const unknown = await (
      await accountPage("<main>Página sintética sem evidência</main>")
    ).detect();

    expect(challenge).toMatchObject({ status: "SECURITY_CHALLENGE" });
    expect(unknown).toMatchObject({ status: "UNKNOWN_STATE" });
  });
});
