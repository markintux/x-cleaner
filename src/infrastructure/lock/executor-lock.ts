import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ExecutorLockPort } from "../../application/ports/executor-lock.js";

export interface ExecutorLockMetadata {
  readonly pid: number;
  readonly hostname: string;
  readonly acquiredAt: string;
}

interface StoredExecutorLock extends ExecutorLockMetadata {
  readonly token: string;
}

export interface ExecutorLockLease {
  readonly metadata: ExecutorLockMetadata;
  release(): Promise<void>;
}

export type StaleLockDiagnosis = "NOT_HELD" | "ACTIVE" | "STALE" | "UNKNOWN";

export class ExecutorLockHeldError extends Error {
  readonly code = "EXECUTOR_LOCK_HELD";

  constructor(readonly metadata: ExecutorLockMetadata | null) {
    super("EXECUTOR_LOCK_HELD");
  }
}

export interface ExecutorLockOptions {
  readonly now?: () => string;
  readonly pid?: () => number;
  readonly hostname?: () => string;
  readonly isPidAlive?: (pid: number) => boolean;
}

/**
 * Filesystem ownership is intentionally separate from SQLite. A stale file is
 * diagnostic evidence only: it is never removed or taken over automatically.
 */
export class ExecutorLock implements ExecutorLockPort {
  readonly #now: () => string;
  readonly #pid: () => number;
  readonly #hostname: () => string;
  readonly #isPidAlive: (pid: number) => boolean;
  readonly #lockPath: string;

  constructor(dataDirectory: string, options: ExecutorLockOptions = {}) {
    const resolvedDataDirectory = path.resolve(dataDirectory);
    this.#lockPath = path.join(resolvedDataDirectory, ".executor.lock");
    if (path.dirname(this.#lockPath) !== resolvedDataDirectory) {
      throw new Error("INVALID_LOCK_PATH");
    }
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#pid = options.pid ?? (() => process.pid);
    this.#hostname = options.hostname ?? (() => os.hostname());
    this.#isPidAlive = options.isPidAlive ?? processIsAlive;
  }

  async acquire(): Promise<ExecutorLockLease> {
    await mkdir(path.dirname(this.#lockPath), { recursive: true });
    const stored: StoredExecutorLock = {
      pid: this.#pid(),
      hostname: this.#hostname(),
      acquiredAt: this.#now(),
      token: randomUUID()
    };

    try {
      const handle = await open(this.#lockPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(stored), "utf8");
      } finally {
        await handle.close();
      }
    } catch (error: unknown) {
      if (isAlreadyExists(error)) {
        throw new ExecutorLockHeldError(await this.readStatus());
      }
      throw error;
    }

    let released = false;
    return {
      metadata: publicMetadata(stored),
      release: async (): Promise<void> => {
        if (released) {
          return;
        }
        const current = await this.readStoredLock();
        if (current?.token !== stored.token) {
          throw new Error("EXECUTOR_LOCK_OWNERSHIP_LOST");
        }
        await rm(this.#lockPath, { force: false });
        released = true;
      }
    };
  }

  /** Safe for status commands: it only observes the lock file and never writes it. */
  async readStatus(): Promise<ExecutorLockMetadata | null> {
    const stored = await this.readLockState();
    return typeof stored === "string" || stored === null ? null : publicMetadata(stored);
  }

  async diagnoseStaleLock(): Promise<StaleLockDiagnosis> {
    const stored = await this.readLockState();
    if (stored === null) {
      return "NOT_HELD";
    }
    if (stored === "INVALID") {
      return "UNKNOWN";
    }
    const metadata = publicMetadata(stored);
    if (metadata.hostname !== this.#hostname()) {
      return "UNKNOWN";
    }
    return this.#isPidAlive(metadata.pid) ? "ACTIVE" : "STALE";
  }

  private async readStoredLock(): Promise<StoredExecutorLock | null> {
    const state = await this.readLockState();
    return typeof state === "string" ? null : state;
  }

  private async readLockState(): Promise<StoredExecutorLock | "INVALID" | null> {
    try {
      const source = await readFile(this.#lockPath, "utf8");
      try {
        return parseStoredLock(source);
      } catch {
        return "INVALID";
      }
    } catch (error: unknown) {
      if (isNotFound(error)) {
        return null;
      }
      return "INVALID";
    }
  }
}

function parseStoredLock(source: string): StoredExecutorLock {
  try {
    const parsed: unknown = JSON.parse(source);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).pid !== "number" ||
      typeof (parsed as Record<string, unknown>).hostname !== "string" ||
      typeof (parsed as Record<string, unknown>).acquiredAt !== "string" ||
      typeof (parsed as Record<string, unknown>).token !== "string"
    ) {
      throw new Error("INVALID_EXECUTOR_LOCK");
    }
    return parsed as StoredExecutorLock;
  } catch {
    throw new Error("INVALID_EXECUTOR_LOCK");
  }
}

function publicMetadata(lock: StoredExecutorLock): ExecutorLockMetadata {
  return { pid: lock.pid, hostname: lock.hostname, acquiredAt: lock.acquiredAt };
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}
