import { rm } from "node:fs/promises";
import path from "node:path";

import {
  BROWSER_PROFILE_DIRECTORY_NAME,
  dedicatedBrowserProfileDirectory
} from "./session-path.js";

export interface ClearSessionInput {
  readonly dataDirectory: string;
  readonly confirmed: boolean;
}

export interface ClearSessionResult {
  readonly profileDirectory: string;
  readonly removed: boolean;
  readonly clearedAt: string;
}

export class ClearSessionError extends Error {
  constructor(readonly code: "SESSION_CLEAR_CONFIRMATION_REQUIRED" | "INVALID_SESSION_SCOPE") {
    super(code);
    this.name = "ClearSessionError";
  }
}

/** Removes only the fixed dedicated profile, never the application-data root. */
export async function clearSession(
  input: ClearSessionInput,
  now: () => string = () => new Date().toISOString()
): Promise<ClearSessionResult> {
  if (!input.confirmed) {
    throw new ClearSessionError("SESSION_CLEAR_CONFIRMATION_REQUIRED");
  }

  const dataDirectory = path.resolve(input.dataDirectory);
  const profileDirectory = dedicatedBrowserProfileDirectory(dataDirectory);
  const expectedParent = path.dirname(profileDirectory);
  if (
    expectedParent !== dataDirectory ||
    path.basename(profileDirectory) !== BROWSER_PROFILE_DIRECTORY_NAME
  ) {
    throw new ClearSessionError("INVALID_SESSION_SCOPE");
  }

  await rm(profileDirectory, { recursive: true, force: true });
  return {
    profileDirectory,
    removed: true,
    clearedAt: now()
  };
}

export class ClearSession {
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  clear(input: ClearSessionInput): Promise<ClearSessionResult> {
    return clearSession(input, this.now);
  }

  execute(input: ClearSessionInput): Promise<ClearSessionResult> {
    return this.clear(input);
  }
}
