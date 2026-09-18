import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { BrowserContext, BrowserType, LaunchPersistentContextOptions } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_PROFILE_DIRECTORY_NAME,
  BrowserContextFactory
} from "../../../src/infrastructure/browser/browser-context-factory.js";

describe("BrowserContextFactory", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    );
  });

  it("usa um perfil dedicado, abre em modo visível e não ativa mídia diagnóstica", async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-browser-context-"));
    temporaryDirectories.push(dataDirectory);
    const context = {} as BrowserContext;
    const launchPersistentContext = vi
      .fn<
        (userDataDir: string, options: LaunchPersistentContextOptions) => Promise<BrowserContext>
      >()
      .mockResolvedValue(context);
    const browser = { launchPersistentContext } as unknown as BrowserType;

    const factory = new BrowserContextFactory({ dataDirectory, browser });
    expect(await factory.launch()).toBe(context);

    expect(factory.profileDirectory).toBe(path.join(dataDirectory, BROWSER_PROFILE_DIRECTORY_NAME));
    expect(factory.profileDirectory).not.toBe(dataDirectory);
    expect(launchPersistentContext).toHaveBeenCalledWith(factory.profileDirectory, {
      headless: false
    });
    const options = launchPersistentContext.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(options).not.toHaveProperty("recordVideo");
    expect(options).not.toHaveProperty("screenshots");
    expect(options).not.toHaveProperty("trace");
  });

  it("cria somente a subárvore do perfil da aplicação", async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-browser-context-"));
    temporaryDirectories.push(dataDirectory);
    const browser = {
      launchPersistentContext: vi.fn().mockResolvedValue({} as BrowserContext)
    } as unknown as BrowserType;
    const factory = new BrowserContextFactory(dataDirectory, { browser });

    await factory.create();

    await expect(access(factory.profileDirectory)).resolves.toBeUndefined();
    expect(path.basename(factory.profileDirectory)).toBe(BROWSER_PROFILE_DIRECTORY_NAME);
  });
});
