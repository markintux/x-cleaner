import { mkdir } from "node:fs/promises";

import { chromium, type BrowserContext, type BrowserType } from "playwright";

import type { BrowserContextFactoryPort } from "./browser-session.js";
import { dedicatedBrowserProfileDirectory } from "./session-path.js";

export {
  BROWSER_PROFILE_DIRECTORY_NAME,
  dedicatedBrowserProfileDirectory
} from "./session-path.js";

export interface BrowserContextFactoryOptions {
  readonly dataDirectory: string;
  readonly browser?: BrowserType;
}

export interface DedicatedBrowserContextFactory extends BrowserContextFactoryPort {
  create(): Promise<BrowserContext>;
}

/**
 * Owns the only browser profile X Cleaner is allowed to open.
 *
 * Capture is intentionally absent from the options below. Playwright's
 * screenshot, tracing, and video facilities are opt-in and therefore remain
 * disabled for real-account sessions by default.
 */
export class BrowserContextFactory implements DedicatedBrowserContextFactory {
  readonly profileDirectory: string;
  readonly #browser: BrowserType;

  constructor(
    dataDirectoryOrOptions: string | BrowserContextFactoryOptions,
    options: Omit<BrowserContextFactoryOptions, "dataDirectory"> = {}
  ) {
    const dataDirectory =
      typeof dataDirectoryOrOptions === "string"
        ? dataDirectoryOrOptions
        : dataDirectoryOrOptions.dataDirectory;
    this.#browser =
      typeof dataDirectoryOrOptions === "string"
        ? (options.browser ?? chromium)
        : (dataDirectoryOrOptions.browser ?? chromium);
    this.profileDirectory = dedicatedBrowserProfileDirectory(dataDirectory);
  }

  async launch(): Promise<BrowserContext> {
    await mkdir(this.profileDirectory, { recursive: true });
    return this.#browser.launchPersistentContext(this.profileDirectory, {
      headless: false
    });
  }

  create(): Promise<BrowserContext> {
    return this.launch();
  }
}

export function createBrowserContextFactory(
  dataDirectory: string,
  options: Omit<BrowserContextFactoryOptions, "dataDirectory"> = {}
): BrowserContextFactory {
  return new BrowserContextFactory(dataDirectory, options);
}
