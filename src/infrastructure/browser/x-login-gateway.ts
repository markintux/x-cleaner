import type { LoginGateway, LoginGatewayResult } from "../../application/ports/login-gateway.js";
import type { BrowserContextFactoryPort, BrowserPagePort } from "./browser-session.js";
import type { ManualBrowserLauncherPort } from "./manual-chrome-launcher.js";
import { AccountPage } from "./x/account-page.js";
import { X_URLS } from "./x/selectors.js";

interface AccountDetector {
  detect(): ReturnType<AccountPage["detect"]>;
}

export interface XLoginGatewayOptions {
  readonly contextFactory: BrowserContextFactoryPort;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly accountPageFactory?: (page: BrowserPagePort) => AccountDetector;
  readonly manualBrowserLauncher?: ManualBrowserLauncherPort;
}

/** Owns the official X login URL, page evidence and browser polling. */
export class XLoginGateway implements LoginGateway {
  readonly #timeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #accountPageFactory: (page: BrowserPagePort) => AccountDetector;

  constructor(private readonly options: XLoginGatewayOptions) {
    this.#timeoutMs = options.timeoutMs ?? 300_000;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#accountPageFactory = options.accountPageFactory ?? ((page) => new AccountPage(page));
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs < 0) {
      throw new Error("INVALID_LOGIN_TIMEOUT");
    }
    if (!Number.isFinite(this.#pollIntervalMs) || this.#pollIntervalMs < 0) {
      throw new Error("INVALID_LOGIN_POLL_INTERVAL");
    }
  }

  async login(): Promise<LoginGatewayResult> {
    await this.options.manualBrowserLauncher?.open(
      this.options.contextFactory.profileDirectory,
      X_URLS.login
    );
    const context = await this.options.contextFactory.launch();
    try {
      const page = await context.newPage();
      await page.goto(X_URLS.home, { waitUntil: "domcontentloaded" });
      return {
        detection: await this.waitForAuthentication(page),
        profileDirectory: this.options.contextFactory.profileDirectory
      };
    } finally {
      await context.close();
    }
  }

  private async waitForAuthentication(page: BrowserPagePort) {
    const accountPage = this.#accountPageFactory(page);
    const startedAt = Date.now();
    let lastDetection = await accountPage.detect();
    while (true) {
      if (
        lastDetection.status === "AUTHENTICATED" ||
        lastDetection.status === "SECURITY_CHALLENGE"
      ) {
        return lastDetection;
      }
      if (Date.now() - startedAt >= this.#timeoutMs) return lastDetection;
      const remaining = this.#timeoutMs - (Date.now() - startedAt);
      await this.#sleep(Math.min(this.#pollIntervalMs, remaining));
      lastDetection = await accountPage.detect();
    }
  }
}
