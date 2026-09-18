import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import path from "node:path";

import type { ArchiveEntry } from "../../application/ports/archive-source.js";
import { ArchiveSourceError } from "../../application/ports/archive-source.js";

/** Hashes the exact ZIP bytes without buffering the archive in memory. */
export async function fingerprintZipFile(filename: string): Promise<string> {
  let stats;
  try {
    stats = await lstat(filename);
  } catch {
    throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID");
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID");
  }

  const hash = createHash("sha256");
  const stream = createReadStream(filename);
  try {
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
    return hash.digest("hex");
  } catch {
    throw new ArchiveSourceError("ARCHIVE_SOURCE_CHANGED");
  } finally {
    stream.destroy();
  }
}

/**
 * Hashes a source-independent manifest. Only normalized relative names and
 * file bytes enter the digest; the selected directory's absolute path never
 * does.
 */
export async function fingerprintDirectory(directory: string): Promise<string> {
  const root = path.resolve(directory);
  let stats;
  try {
    stats = await lstat(root);
  } catch {
    throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID");
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID");
  }

  const entries: DirectoryManifestEntry[] = [];
  await collectDirectoryManifest(root, "", entries);
  entries.sort((left, right) => left.name.localeCompare(right.name));
  return fingerprintManifest(entries, (name) => readFileBytes(root, name));
}

export async function fingerprintManifest(
  entries: readonly Pick<ArchiveEntry, "name">[],
  readBytes: (name: string) => AsyncIterable<Uint8Array>
): Promise<string> {
  const hash = createHash("sha256");
  const ordered = [...entries].sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of ordered) {
    const name = entry.name;
    const nameBytes = Buffer.from(name, "utf8");
    hash.update(encodeLength(nameBytes.byteLength));
    hash.update(nameBytes);
    for await (const chunk of readBytes(name)) {
      hash.update(chunk);
    }
    hash.update(encodeLength(0));
  }
  return hash.digest("hex");
}

type DirectoryManifestEntry = ArchiveEntry;

async function collectDirectoryManifest(
  root: string,
  relativeDirectory: string,
  entries: DirectoryManifestEntry[]
): Promise<void> {
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
    const relativeName = normalizeManifestName(
      relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
    );
    if (entry.isSymbolicLink()) {
      throw new ArchiveSourceError("ARCHIVE_ENTRY_SYMLINK");
    }
    if (entry.isDirectory()) {
      await collectDirectoryManifest(root, relativeName, entries);
      continue;
    }
    if (!entry.isFile()) {
      throw new ArchiveSourceError("ARCHIVE_ENTRY_NOT_REGULAR");
    }
    entries.push({ name: relativeName, size: 0 });
  }
}

async function* readFileBytes(root: string, name: string): AsyncIterable<Uint8Array> {
  const absolute = path.resolve(root, ...name.split("/"));
  const stream = createReadStream(absolute);
  try {
    for await (const chunk of stream) {
      yield chunk as Buffer;
    }
  } catch {
    throw new ArchiveSourceError("ARCHIVE_SOURCE_CHANGED");
  } finally {
    stream.destroy();
  }
}

function normalizeManifestName(name: string): string {
  const portable = name.replaceAll("\\", "/");
  const normalized = path.posix.normalize(portable);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    throw new ArchiveSourceError("ARCHIVE_ENTRY_OUTSIDE_SOURCE");
  }
  return normalized;
}

function encodeLength(length: number): Buffer {
  const value = Buffer.allocUnsafe(8);
  value.writeBigUInt64BE(BigInt(length));
  return value;
}
