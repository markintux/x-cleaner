import { spawn } from "node:child_process";
import path from "node:path";

export interface ManualBrowserLauncherPort {
  open(profileDirectory: string, url: string): Promise<void>;
}

interface ManualChromeLauncherOptions {
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
  readonly run?: (executable: string, args: readonly string[]) => Promise<void>;
}

/** Opens ordinary Chrome with an isolated profile and waits for the owner to close it. */
export class ManualChromeLauncher implements ManualBrowserLauncherPort {
  readonly #platform: NodeJS.Platform;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #run: (executable: string, args: readonly string[]) => Promise<void>;

  constructor(options: ManualChromeLauncherOptions = {}) {
    this.#platform = options.platform ?? process.platform;
    this.#environment = options.environment ?? process.env;
    this.#run = options.run ?? runBrowserProcess;
  }

  async open(profileDirectory: string, url: string): Promise<void> {
    const args = [
      `--user-data-dir=${path.resolve(profileDirectory)}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-mode",
      "--new-window",
      url
    ];
    let lastMissingExecutable: unknown;

    for (const executable of chromeExecutables(this.#platform, this.#environment)) {
      try {
        await this.#run(executable, args);
        return;
      } catch (error) {
        if (!isMissingExecutable(error)) throw error;
        lastMissingExecutable = error;
      }
    }

    throw new Error("MANUAL_CHROME_NOT_FOUND", { cause: lastMissingExecutable });
  }
}

function chromeExecutables(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv
): readonly string[] {
  if (platform === "darwin") {
    return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }
  if (platform === "win32") {
    return [environment.PROGRAMFILES, environment["PROGRAMFILES(X86)"], environment.LOCALAPPDATA]
      .filter((directory): directory is string => directory !== undefined && directory !== "")
      .map((directory) => path.join(directory, "Google", "Chrome", "Application", "chrome.exe"));
  }
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
}

function runBrowserProcess(executable: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 || (code === null && signal !== null)) {
        resolve();
        return;
      }
      reject(new Error(`MANUAL_CHROME_EXIT_${String(code)}`));
    });
  });
}

function isMissingExecutable(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
