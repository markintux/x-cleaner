import path from "node:path";

export const BROWSER_PROFILE_DIRECTORY_NAME = "browser-profile";

export function dedicatedBrowserProfileDirectory(dataDirectory: string): string {
  return path.join(path.resolve(dataDirectory), BROWSER_PROFILE_DIRECTORY_NAME);
}
