import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

import type { BrowserPrerequisiteResult } from "../../application/ports/browser-prerequisites.js";
import { chromeExecutables } from "./manual-chrome-launcher.js";

export interface BrowserPrerequisiteProbeOptions {
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
  readonly playwrightExecutable?: string;
  readonly fileExists?: (filename: string) => Promise<boolean>;
}

/** Reads executable locations without launching a browser or creating state. */
export class BrowserPrerequisiteProbe {
  constructor(private readonly options: BrowserPrerequisiteProbeOptions = {}) {}

  async check(): Promise<BrowserPrerequisiteResult> {
    const platform = this.options.platform ?? process.platform;
    const environment = this.options.environment ?? process.env;
    const fileExists = this.options.fileExists ?? exists;
    const chromeReady = await hasGoogleChrome(platform, environment, fileExists);
    const { chromium } = await import("playwright");
    const playwrightReady = await fileExists(
      this.options.playwrightExecutable ?? chromium.executablePath()
    );
    return { chromeReady, playwrightReady };
  }
}

async function hasGoogleChrome(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  fileExists: (filename: string) => Promise<boolean>
): Promise<boolean> {
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const candidates = chromeExecutables(platform, environment).filter(
    (candidate) => platform !== "linux" || candidate.startsWith("google-chrome")
  );
  for (const candidate of candidates) {
    if (platformPath.isAbsolute(candidate) && (await fileExists(candidate))) return true;
    if (platformPath.isAbsolute(candidate)) continue;
    for (const directory of (environment.PATH ?? "").split(platformPath.delimiter)) {
      if (directory !== "" && (await fileExists(platformPath.join(directory, candidate)))) {
        return true;
      }
    }
  }
  return false;
}

async function exists(filename: string): Promise<boolean> {
  try {
    await access(filename, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return (await stat(filename)).isFile();
  } catch {
    return false;
  }
}
