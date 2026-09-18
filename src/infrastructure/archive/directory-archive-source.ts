import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, opendir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ArchiveSourceError,
  DEFAULT_ARCHIVE_ENTRY_MAX_BYTES,
  type ArchiveEntry,
  type ArchiveSource,
  type ArchiveTextReadOptions
} from "../../application/ports/archive-source.js";

export interface DirectoryArchiveSourceOptions {
  readonly maxEntryBytes?: number;
}

/** A read-only archive source backed by an already extracted directory. */
export class DirectoryArchiveSource implements ArchiveSource {
  readonly kind = "DIRECTORY" as const;
  readonly label: string;
  readonly #directory: string;
  readonly #maxEntryBytes: number;

  constructor(directory: string, options: DirectoryArchiveSourceOptions = {}) {
    this.#directory = path.resolve(directory);
    if (this.#directory === path.parse(this.#directory).root) {
      throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID");
    }
    this.label = safeLabel(this.#directory);
    this.#maxEntryBytes = options.maxEntryBytes ?? DEFAULT_ARCHIVE_ENTRY_MAX_BYTES;
    if (!Number.isSafeInteger(this.#maxEntryBytes) || this.#maxEntryBytes <= 0) {
      throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID", "invalid archive entry limit");
    }
  }

  async entries(): Promise<readonly ArchiveEntry[]> {
    const root = await this.#validatedRoot();
    const found: ArchiveEntry[] = [];
    await this.#walk(root, "", found);
    found.sort((left, right) => left.name.localeCompare(right.name));
    return found;
  }

  listEntries(): Promise<readonly ArchiveEntry[]> {
    return this.entries();
  }

  async *openText(name: string, options: ArchiveTextReadOptions = {}): AsyncIterable<string> {
    const maxBytes = options.maxBytes ?? this.#maxEntryBytes;
    validateLimit(maxBytes);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for await (const chunk of this.#openBytes(name, maxBytes)) {
      try {
        yield decoder.decode(chunk, { stream: true });
      } catch {
        throw new ArchiveSourceError("ARCHIVE_INVALID_UTF8");
      }
    }
    try {
      const finalText = decoder.decode();
      if (finalText.length > 0) {
        yield finalText;
      }
    } catch {
      throw new ArchiveSourceError("ARCHIVE_INVALID_UTF8");
    }
  }

  async readText(name: string, options: ArchiveTextReadOptions = {}): Promise<string> {
    let result = "";
    for await (const chunk of this.openText(name, options)) {
      result += chunk;
    }
    return result;
  }

  async fingerprint(): Promise<string> {
    const hash = createHash("sha256");
    for (const entry of await this.entries()) {
      hash.update(entry.name, "utf8");
      hash.update(new Uint8Array([0]));
      for await (const chunk of this.#openBytes(entry.name, Number.MAX_SAFE_INTEGER)) {
        hash.update(chunk);
      }
      hash.update(new Uint8Array([0]));
    }
    return hash.digest("hex");
  }

  async #validatedRoot(): Promise<string> {
    let rootStats;
    try {
      rootStats = await lstat(this.#directory);
    } catch {
      throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID");
    }
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID");
    }
    try {
      return await realpath(this.#directory);
    } catch {
      throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID");
    }
  }

  async #walk(root: string, relativeDirectory: string, found: ArchiveEntry[]): Promise<void> {
    const absoluteDirectory = relativeDirectory
      ? path.join(root, ...relativeDirectory.split("/"))
      : root;
    let directory;
    try {
      directory = await opendir(absoluteDirectory);
    } catch {
      throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID");
    }

    for await (const entry of directory) {
      const relativeName = normalizeRelativeName(
        relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      );
      if (entry.isSymbolicLink()) {
        throw new ArchiveSourceError("ARCHIVE_ENTRY_SYMLINK");
      }
      if (entry.isDirectory()) {
        await this.#walk(root, relativeName, found);
        continue;
      }
      if (!entry.isFile()) {
        throw new ArchiveSourceError("ARCHIVE_ENTRY_NOT_REGULAR");
      }
      const size = await this.#safeFileSize(root, relativeName);
      if (size > this.#maxEntryBytes) {
        throw new ArchiveSourceError("ARCHIVE_ENTRY_TOO_LARGE");
      }
      found.push({ name: relativeName, size });
    }
  }

  async #safeFileSize(root: string, name: string): Promise<number> {
    const absolute = safeResolve(root, name);
    let fileStats;
    try {
      fileStats = await lstat(absolute);
    } catch {
      throw new ArchiveSourceError("ARCHIVE_ENTRY_NOT_FOUND");
    }
    if (fileStats.isSymbolicLink()) {
      throw new ArchiveSourceError("ARCHIVE_ENTRY_SYMLINK");
    }
    if (!fileStats.isFile()) {
      throw new ArchiveSourceError("ARCHIVE_ENTRY_NOT_REGULAR");
    }
    await assertRealPathInside(root, absolute);
    return fileStats.size;
  }

  async *#openBytes(name: string, maxBytes: number): AsyncIterable<Uint8Array> {
    validateLimit(maxBytes);
    const root = await this.#validatedRoot();
    const normalized = normalizeRelativeName(name);
    const absolute = safeResolve(root, normalized);
    await this.#safeFileSize(root, normalized);
    let bytesRead = 0;
    const stream = createReadStream(absolute);
    try {
      for await (const chunk of stream) {
        const bytes = chunk as Buffer;
        bytesRead += bytes.byteLength;
        if (bytesRead > maxBytes) {
          stream.destroy();
          throw new ArchiveSourceError("ARCHIVE_ENTRY_TOO_LARGE");
        }
        yield bytes;
      }
    } catch (error) {
      if (error instanceof ArchiveSourceError) {
        throw error;
      }
      throw new ArchiveSourceError("ARCHIVE_SOURCE_CHANGED");
    } finally {
      stream.destroy();
    }
  }
}

export function normalizeRelativeName(name: string): string {
  if (typeof name !== "string" || name.length === 0) {
    throw new ArchiveSourceError("ARCHIVE_ENTRY_INVALID");
  }
  const portable = name.replaceAll("\\", "/");
  if (portable.startsWith("/") || /^[A-Za-z]:\//u.test(portable)) {
    throw new ArchiveSourceError("ARCHIVE_ENTRY_OUTSIDE_SOURCE");
  }
  const parts = portable.split("/");
  if (parts.some((part) => part === "..")) {
    throw new ArchiveSourceError("ARCHIVE_ENTRY_OUTSIDE_SOURCE");
  }
  const normalized = path.posix.normalize(portable);
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    normalized.startsWith("/")
  ) {
    throw new ArchiveSourceError("ARCHIVE_ENTRY_OUTSIDE_SOURCE");
  }
  return normalized;
}

function safeResolve(root: string, name: string): string {
  const absolute = path.resolve(root, ...name.split("/"));
  const relative = path.relative(root, absolute);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ArchiveSourceError("ARCHIVE_ENTRY_OUTSIDE_SOURCE");
  }
  return absolute;
}

async function assertRealPathInside(root: string, absolute: string): Promise<void> {
  let real;
  try {
    real = await realpath(absolute);
  } catch {
    throw new ArchiveSourceError("ARCHIVE_ENTRY_NOT_FOUND");
  }
  const relative = path.relative(root, real);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ArchiveSourceError("ARCHIVE_ENTRY_OUTSIDE_SOURCE");
  }
}

function validateLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID", "invalid archive entry limit");
  }
}

function safeLabel(directory: string): string {
  const label = path.basename(directory) || path.basename(os.tmpdir());
  if (label === "." || label === ".." || label.includes("/") || label.includes("\\")) {
    throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID");
  }
  return label;
}
