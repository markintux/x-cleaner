import path from "node:path";

export interface ApplicationDataOptions {
  readonly cwd?: string;
  readonly dataDir?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly homeDirectory?: string;
  readonly platform?: NodeJS.Platform;
}

const applicationDirectoryName = "x-cleaner";

/** Resolves the per-user location owned by X Cleaner without creating it. */
export function resolveApplicationDataDirectory(options: ApplicationDataOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const platformPath = platform === "win32" ? path.win32 : path.posix;

  if (options.dataDir !== undefined) {
    return platformPath.resolve(options.cwd ?? process.cwd(), options.dataDir);
  }

  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? environment.HOME ?? process.env.HOME;

  if (homeDirectory === undefined || homeDirectory.length === 0) {
    throw new Error("APPLICATION_DATA_HOME_UNAVAILABLE");
  }

  switch (platform) {
    case "darwin":
      return platformPath.join(
        homeDirectory,
        "Library",
        "Application Support",
        applicationDirectoryName
      );
    case "win32":
      return platformPath.join(
        environment.LOCALAPPDATA ?? environment.APPDATA ?? homeDirectory,
        applicationDirectoryName
      );
    default:
      return platformPath.join(
        environment.XDG_DATA_HOME ?? platformPath.join(homeDirectory, ".local", "share"),
        applicationDirectoryName
      );
  }
}
