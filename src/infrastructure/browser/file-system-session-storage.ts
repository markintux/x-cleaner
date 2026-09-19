import { rm } from "node:fs/promises";
import path from "node:path";

import type { SessionStorage } from "../../application/ports/session-storage.js";
import { ClearSessionError } from "../../application/session/clear-session.js";
import {
  BROWSER_PROFILE_DIRECTORY_NAME,
  dedicatedBrowserProfileDirectory
} from "./session-path.js";

export class FileSystemSessionStorage implements SessionStorage {
  async clearProfile(inputDirectory: string): Promise<string> {
    const dataDirectory = path.resolve(inputDirectory);
    const profileDirectory = dedicatedBrowserProfileDirectory(dataDirectory);
    if (
      path.dirname(profileDirectory) !== dataDirectory ||
      path.basename(profileDirectory) !== BROWSER_PROFILE_DIRECTORY_NAME
    ) {
      throw new ClearSessionError("INVALID_SESSION_SCOPE");
    }
    await rm(profileDirectory, { recursive: true, force: true });
    return profileDirectory;
  }
}
