import type { SessionStorage } from "../ports/session-storage.js";

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
  storage: SessionStorage,
  now: () => string = () => new Date().toISOString()
): Promise<ClearSessionResult> {
  if (!input.confirmed) {
    throw new ClearSessionError("SESSION_CLEAR_CONFIRMATION_REQUIRED");
  }

  const profileDirectory = await storage.clearProfile(input.dataDirectory);
  return {
    profileDirectory,
    removed: true,
    clearedAt: now()
  };
}

export class ClearSession {
  constructor(
    private readonly storage: SessionStorage,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  clear(input: ClearSessionInput): Promise<ClearSessionResult> {
    return clearSession(input, this.storage, this.now);
  }

  execute(input: ClearSessionInput): Promise<ClearSessionResult> {
    return this.clear(input);
  }
}
