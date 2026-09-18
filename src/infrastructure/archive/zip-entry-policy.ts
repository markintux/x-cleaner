import path from "node:path";

import { ArchiveSourceError } from "../../application/ports/archive-source.js";

/** The metadata needed to validate an entry before its bytes are requested. */
export interface ZipEntryMetadata {
  readonly filename: string;
  readonly directory: boolean;
  readonly symlink?: boolean;
  readonly encrypted?: boolean;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly unixMode?: number;
  readonly unixExternalUpper?: number;
  readonly externalFileAttributes?: number;
  readonly zip64?: boolean;
}

export interface ZipEntryPolicyLimits {
  /** Maximum number of central-directory entries, including directories. */
  readonly maxEntries?: number;
  /** Maximum uncompressed size of one entry. */
  readonly maxEntryUncompressedBytes?: number;
  /** Maximum compressed size of one entry. */
  readonly maxEntryCompressedBytes?: number;
  /** Maximum uncompressed bytes in parser-relevant candidate files. */
  readonly maxTotalRelevantUncompressedBytes?: number;
  /** Maximum compressed bytes across all entries. */
  readonly maxTotalCompressedBytes?: number;
}

export interface ZipEntryPolicyOptions extends ZipEntryPolicyLimits {
  /** An entry is relevant when it can contain a YTD assignment. */
  readonly isRelevant?: (name: string) => boolean;
}

export interface ValidatedZipEntry<Entry extends ZipEntryMetadata = ZipEntryMetadata> {
  readonly entry: Entry;
  readonly name: string;
  readonly relevant: boolean;
}

/** Object form for callers that want to reuse one policy across reader calls. */
export class ZipEntryPolicy {
  readonly #options: ZipEntryPolicyOptions;

  constructor(options: ZipEntryPolicyOptions = {}) {
    this.#options = options;
  }

  validate<Entry extends ZipEntryMetadata>(
    entries: readonly Entry[]
  ): readonly ValidatedZipEntry<Entry>[] {
    return validateZipEntries(entries, this.#options);
  }

  normalizeName(filename: string): string {
    return normalizeZipEntryName(filename);
  }
}

export const DEFAULT_ZIP_ENTRY_POLICY: Required<ZipEntryPolicyLimits> = {
  maxEntries: 100_000,
  maxEntryUncompressedBytes: 64 * 1024 * 1024,
  maxEntryCompressedBytes: 64 * 1024 * 1024,
  maxTotalRelevantUncompressedBytes: 512 * 1024 * 1024,
  maxTotalCompressedBytes: 2 * 1024 * 1024 * 1024
};

/**
 * Validates central-directory metadata without asking zip.js for entry data.
 * The returned names are the only names a source may subsequently open.
 */
export function validateZipEntries<Entry extends ZipEntryMetadata>(
  entries: readonly Entry[],
  options: ZipEntryPolicyOptions = {}
): readonly ValidatedZipEntry<Entry>[] {
  const limits = resolveLimits(options);
  if (entries.length > limits.maxEntries) {
    throw new ArchiveSourceError("ARCHIVE_TOO_MANY_ENTRIES");
  }

  const normalizedNames = new Set<string>();
  const result: ValidatedZipEntry<Entry>[] = [];
  let totalRelevantUncompressedBytes = 0;
  let totalCompressedBytes = 0;
  const isRelevant = options.isRelevant ?? isRelevantArchiveEntryName;

  for (const entry of entries) {
    const name = normalizeZipEntryName(entry.filename);
    if (normalizedNames.has(name)) {
      throw new ArchiveSourceError("ARCHIVE_ENTRY_DUPLICATE");
    }
    normalizedNames.add(name);

    if (entry.symlink === true || hasSymlinkMode(entry)) {
      throw new ArchiveSourceError("ARCHIVE_ENTRY_SYMLINK");
    }
    if (entry.encrypted === true) {
      throw new ArchiveSourceError("ARCHIVE_ENTRY_ENCRYPTED");
    }

    const compressedSize = safeArchiveSize(entry.compressedSize);
    const uncompressedSize = safeArchiveSize(entry.uncompressedSize);
    if (compressedSize > limits.maxEntryCompressedBytes) {
      throw new ArchiveSourceError("ARCHIVE_ENTRY_COMPRESSED_TOO_LARGE");
    }
    if (uncompressedSize > limits.maxEntryUncompressedBytes) {
      throw new ArchiveSourceError("ARCHIVE_ENTRY_TOO_LARGE");
    }
    totalCompressedBytes += compressedSize;
    if (totalCompressedBytes > limits.maxTotalCompressedBytes) {
      throw new ArchiveSourceError("ARCHIVE_TOTAL_COMPRESSED_TOO_LARGE");
    }

    const relevant = !entry.directory && isRelevant(name);
    if (relevant) {
      totalRelevantUncompressedBytes += uncompressedSize;
      if (totalRelevantUncompressedBytes > limits.maxTotalRelevantUncompressedBytes) {
        throw new ArchiveSourceError("ARCHIVE_TOTAL_TOO_LARGE");
      }
    }

    result.push({ entry, name, relevant });
  }

  return result;
}

/**
 * Normalizes ZIP's portable filename grammar and proves the result remains a
 * relative path. Backslashes are treated as separators so Windows-shaped
 * traversal cannot evade validation on POSIX.
 */
export function normalizeZipEntryName(filename: string): string {
  if (typeof filename !== "string" || filename.length === 0 || filename.includes("\0")) {
    throw new ArchiveSourceError("ARCHIVE_ENTRY_INVALID");
  }

  const portable = filename.replaceAll("\\", "/");
  if (portable.startsWith("/") || /^[A-Za-z]:/u.test(portable)) {
    throw new ArchiveSourceError("ARCHIVE_ENTRY_OUTSIDE_SOURCE");
  }

  const normalized = path.posix.normalize(portable);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized)
  ) {
    throw new ArchiveSourceError("ARCHIVE_ENTRY_OUTSIDE_SOURCE");
  }
  return normalized;
}

/** Warnings which mean the archive has more than one defensible interpretation. */
export const forbiddenArchiveWarningReasons = new Set([
  "appended data",
  "prepended data",
  "trailing central directory data",
  "duplicate filename",
  "mismatched zip64 end of central directory",
  "multiple end of central directory records"
]);

export function assertNoForbiddenArchiveWarnings(
  warnings: readonly { readonly reason: string }[] | undefined
): void {
  if (warnings?.some((warning) => forbiddenArchiveWarningReasons.has(warning.reason))) {
    throw new ArchiveSourceError("ARCHIVE_AMBIGUOUS");
  }
}

export function isRelevantArchiveEntryName(name: string): boolean {
  return /\.(?:js|json)$/iu.test(name);
}

function resolveLimits(options: ZipEntryPolicyOptions): Required<ZipEntryPolicyLimits> {
  const limits: Required<ZipEntryPolicyLimits> = {
    maxEntries: options.maxEntries ?? DEFAULT_ZIP_ENTRY_POLICY.maxEntries,
    maxEntryUncompressedBytes:
      options.maxEntryUncompressedBytes ?? DEFAULT_ZIP_ENTRY_POLICY.maxEntryUncompressedBytes,
    maxEntryCompressedBytes:
      options.maxEntryCompressedBytes ?? DEFAULT_ZIP_ENTRY_POLICY.maxEntryCompressedBytes,
    maxTotalRelevantUncompressedBytes:
      options.maxTotalRelevantUncompressedBytes ??
      DEFAULT_ZIP_ENTRY_POLICY.maxTotalRelevantUncompressedBytes,
    maxTotalCompressedBytes:
      options.maxTotalCompressedBytes ?? DEFAULT_ZIP_ENTRY_POLICY.maxTotalCompressedBytes
  };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID", "invalid ZIP limit");
    }
  }
  if (limits.maxEntries === 0 || limits.maxEntryUncompressedBytes === 0) {
    throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID", "invalid ZIP limit");
  }
  return limits;
}

function safeArchiveSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ArchiveSourceError("ARCHIVE_ENTRY_SIZE_INVALID");
  }
  return value;
}

function hasSymlinkMode(entry: ZipEntryMetadata): boolean {
  const mode =
    entry.unixMode ?? entry.unixExternalUpper ?? extractUnixMode(entry.externalFileAttributes);
  return mode !== undefined && (mode & 0xf000) === 0xa000;
}

function extractUnixMode(externalFileAttributes: number | undefined): number | undefined {
  if (externalFileAttributes === undefined || !Number.isSafeInteger(externalFileAttributes)) {
    return undefined;
  }
  return externalFileAttributes >>> 16;
}
