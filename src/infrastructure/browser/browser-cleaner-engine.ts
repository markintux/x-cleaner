import type {
  BrowserContextFactoryPort,
  BrowserContextPort,
  BrowserPagePort
} from "../../application/ports/browser-session.js";
import type {
  CleanerEngine,
  CleanerEngineInteraction,
  CleanerEngineOutcome
} from "../../application/ports/cleaner-engine.js";
import { normalizeAccountHandle } from "../../domain/account.js";
import { BrowserContextFactory } from "./browser-context-factory.js";
import { buildInteractionUrl } from "./x/interaction-url.js";
import { PostPage, type PostPageEvidence } from "./x/post-page.js";

export interface BrowserCleanerEngineOptions {
  readonly dataDirectory?: string;
  readonly contextFactory?: BrowserContextFactoryPort;
  readonly page?: BrowserPagePort;
  readonly confirmedHandle?: string;
  readonly accountHandle?: string;
  readonly handle?: string;
  /** Test-only navigation seam for local deterministic pages. */
  readonly statusUrlBuilder?: (handle: string, interactionId: string) => string;
  readonly interactionUrlBuilder?: (handle: string, interactionId: string) => string;
  readonly pageFactory?: (context: BrowserContextPort) => Promise<BrowserPagePort>;
}

/**
 * Browser implementation of the Core CleanerEngine contract.
 *
 * The persistent context is created lazily, after Core has obtained a
 * separately confirmed batch. Construction itself has no browser side effect.
 */
export class BrowserCleanerEngine implements CleanerEngine {
  readonly #contextFactory: BrowserContextFactoryPort | null;
  readonly #confirmedHandle: string;
  readonly #statusUrlBuilder: (handle: string, interactionId: string) => string;
  readonly #pageFactory: (context: BrowserContextPort) => Promise<BrowserPagePort>;
  readonly #providedPage: BrowserPagePort | null;
  #context: BrowserContextPort | null = null;

  constructor(options: BrowserCleanerEngineOptions);
  constructor(contextFactory: BrowserContextFactoryPort, confirmedHandle: string);
  constructor(page: BrowserPagePort, confirmedHandle: string);
  constructor(
    optionsOrFactory: BrowserCleanerEngineOptions | BrowserContextFactoryPort | BrowserPagePort,
    confirmedHandle?: string
  ) {
    const options: BrowserCleanerEngineOptions = isContextFactory(optionsOrFactory)
      ? {
          contextFactory: optionsOrFactory,
          ...(confirmedHandle === undefined ? {} : { confirmedHandle })
        }
      : isPage(optionsOrFactory)
        ? {
            page: optionsOrFactory,
            ...(confirmedHandle === undefined ? {} : { confirmedHandle })
          }
        : optionsOrFactory;
    this.#contextFactory =
      options.contextFactory ??
      (options.dataDirectory === undefined
        ? null
        : new BrowserContextFactory({ dataDirectory: options.dataDirectory }));
    this.#confirmedHandle =
      options.confirmedHandle ?? options.accountHandle ?? options.handle ?? "";
    this.#statusUrlBuilder =
      options.statusUrlBuilder ?? options.interactionUrlBuilder ?? buildInteractionUrl;
    this.#pageFactory = options.pageFactory ?? ((context) => context.newPage());
    this.#providedPage = options.page ?? null;
  }

  async execute(input: CleanerEngineInteraction): Promise<CleanerEngineOutcome> {
    const startedAt = Date.now();
    if (input.interaction.type !== "POST" && input.interaction.type !== "REPLY") {
      return permanent("UNSUPPORTED_INTERACTION_TYPE", elapsed(startedAt));
    }

    let handle: string;
    try {
      handle = normalizeAccountHandle(this.#confirmedHandle);
    } catch {
      return permanent("CONFIRMED_HANDLE_REQUIRED", elapsed(startedAt));
    }

    if (this.#contextFactory === null && this.#providedPage === null) {
      return permanent("BROWSER_CONTEXT_NOT_CONFIGURED", elapsed(startedAt));
    }

    try {
      const page = await this.page();
      const url = this.#statusUrlBuilder(handle, input.interaction.xInteractionId);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const evidence = await new PostPage(page, {
        expectedHandle: handle,
        expectedInteractionId: input.interaction.xInteractionId
      }).deletePost();
      return mapEvidence(evidence, elapsed(startedAt));
    } catch {
      return permanent("BROWSER_ERROR", elapsed(startedAt));
    }
  }

  async close(): Promise<void> {
    const context = this.#context;
    this.#context = null;
    if (context !== null) {
      await context.close();
    }
  }

  private async context(): Promise<BrowserContextPort> {
    if (this.#context !== null) {
      return this.#context;
    }
    if (this.#contextFactory === null) {
      throw new Error("BROWSER_CONTEXT_NOT_CONFIGURED");
    }
    this.#context = await this.#contextFactory.launch();
    return this.#context;
  }

  private async page(): Promise<BrowserPagePort> {
    if (this.#providedPage !== null) {
      return this.#providedPage;
    }
    return this.#pageFactory(await this.context());
  }
}

export const BrowserEngine = BrowserCleanerEngine;

export function createBrowserCleanerEngine(
  options: BrowserCleanerEngineOptions
): BrowserCleanerEngine {
  return new BrowserCleanerEngine(options);
}

function mapEvidence(evidence: PostPageEvidence, durationMs: number): CleanerEngineOutcome {
  switch (evidence.kind) {
    case "DELETED":
      return { kind: "COMPLETED", outcome: "COMPLETED", durationMs };
    case "ALREADY_REMOVED":
      return {
        kind: "TERMINAL_NON_ERROR",
        outcome: "ALREADY_REMOVED",
        durationMs
      };
    case "NOT_FOUND":
      return { kind: "TERMINAL_NON_ERROR", outcome: "NOT_FOUND", durationMs };
    case "UNAVAILABLE":
      return { kind: "TERMINAL_NON_ERROR", outcome: "UNAVAILABLE", durationMs };
    case "UNAUTHENTICATED":
      return {
        kind: "SESSION_EXPIRED",
        outcome: "PAUSED",
        pauseReason: "SESSION_EXPIRED",
        errorCode: evidence.reason === "LOGIN_REQUIRED" ? "LOGIN_REQUIRED" : "SESSION_EXPIRED",
        durationMs
      };
    case "CHALLENGE":
      return {
        kind: "CHALLENGE_OR_RATE_LIMIT",
        outcome: "PAUSED",
        pauseReason: "SECURITY_CHALLENGE",
        errorCode: "SECURITY_CHALLENGE",
        durationMs
      };
    case "UNKNOWN":
      return {
        kind: "UNKNOWN_UI",
        outcome: "PAUSED",
        pauseReason: "UNKNOWN_UI",
        errorCode: evidence.errorCode ?? evidence.reason ?? "UNKNOWN_UI",
        durationMs
      };
  }
}

function permanent(errorCode: string, durationMs: number): CleanerEngineOutcome {
  return { kind: "PERMANENT_FAILURE", outcome: "FAILED", errorCode, durationMs };
}

function elapsed(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function isContextFactory(
  value: BrowserCleanerEngineOptions | BrowserContextFactoryPort | BrowserPagePort
): value is BrowserContextFactoryPort {
  return "launch" in value && typeof value.launch === "function";
}

function isPage(
  value: BrowserCleanerEngineOptions | BrowserContextFactoryPort | BrowserPagePort
): value is BrowserPagePort {
  return "goto" in value && "locator" in value && typeof value.goto === "function";
}
