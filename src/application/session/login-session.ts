import type {
  BrowserContextFactoryPort,
  BrowserContextPort,
  BrowserPagePort
} from "../ports/browser-session.js";
import { BrowserContextFactory } from "../../infrastructure/browser/browser-context-factory.js";
import { AccountPage } from "../../infrastructure/browser/x/account-page.js";
import { X_URLS } from "../../infrastructure/browser/x/selectors.js";
import type { AccountDetection, DetectedAccount } from "../../domain/account.js";

export const OFFICIAL_X_LOGIN_URL = X_URLS.login;

interface AccountPageDetector {
  detect(): Promise<AccountDetection>;
}

export interface LoginSessionOptions {
  readonly dataDirectory: string;
  readonly contextFactory?: BrowserContextFactoryPort;
  readonly loginUrl?: string;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly accountPageFactory?: (page: BrowserPagePort) => AccountPageDetector;
}

export interface LoginSessionResult {
  readonly detection: AccountDetection;
  readonly account: DetectedAccount | null;
  readonly profileDirectory: string;
}

/** Opens only the official visible flow and never reads credentials from the page. */
export class LoginSession {
  readonly #contextFactory: BrowserContextFactoryPort;
  readonly #loginUrl: string;
  readonly #timeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #accountPageFactory: (page: BrowserPagePort) => AccountPageDetector;

  constructor(options: LoginSessionOptions) {
    this.#contextFactory =
      options.contextFactory ?? new BrowserContextFactory({ dataDirectory: options.dataDirectory });
    this.#loginUrl = options.loginUrl ?? OFFICIAL_X_LOGIN_URL;
    this.#timeoutMs = options.timeoutMs ?? 120_000;
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

  async login(): Promise<LoginSessionResult> {
    return this.execute();
  }

  async execute(): Promise<LoginSessionResult> {
    const context = await this.#contextFactory.launch();
    try {
      const page = await context.newPage();
      await page.goto(this.#loginUrl, { waitUntil: "domcontentloaded" });
      const detection = await this.waitForAuthentication(page);
      return {
        detection,
        account: detection.status === "AUTHENTICATED" ? detection.account : null,
        profileDirectory: this.#contextFactory.profileDirectory
      };
    } finally {
      await context.close();
    }
  }

  private async waitForAuthentication(page: BrowserPagePort): Promise<AccountDetection> {
    const accountPage = this.#accountPageFactory(page);
    const startedAt = Date.now();
    while (true) {
      const detection = await accountPage.detect();
      if (detection.status === "AUTHENTICATED" || detection.status === "SECURITY_CHALLENGE") {
        return detection;
      }
      if (detection.status === "UNKNOWN_STATE") {
        return detection;
      }
      if (Date.now() - startedAt >= this.#timeoutMs) {
        return detection;
      }
      const remaining = this.#timeoutMs - (Date.now() - startedAt);
      await this.#sleep(Math.min(this.#pollIntervalMs, remaining));
    }
  }
}

export function createLoginSession(options: LoginSessionOptions): LoginSession {
  return new LoginSession(options);
}

export type LoginBrowserContext = BrowserContextPort;
