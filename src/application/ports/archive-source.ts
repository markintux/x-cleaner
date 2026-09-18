import type { ArchiveSourceKind } from "../../domain/interaction.js";

export const DEFAULT_ARCHIVE_ENTRY_MAX_BYTES = 16 * 1024 * 1024;

export interface ArchiveEntry {
  readonly name: string;
  readonly size: number;
}

export interface ArchiveTextReadOptions {
  readonly maxBytes?: number;
}

/**
 * Read-only boundary for an extracted archive.
 *
 * Entry names are always normalized to `/` separated paths relative to the
 * selected source directory. Implementations must reject symlinks and every
 * path which escapes that directory before opening it.
 */
export interface ArchiveSource {
  readonly kind: ArchiveSourceKind;
  readonly label: string;

  entries(): Promise<readonly ArchiveEntry[]>;
  listEntries(): Promise<readonly ArchiveEntry[]>;
  openText(name: string, options?: ArchiveTextReadOptions): AsyncIterable<string>;
  readText(name: string, options?: ArchiveTextReadOptions): Promise<string>;
  fingerprint(): Promise<string>;
}

export class ArchiveSourceError extends Error {
  constructor(
    readonly code:
      | "ARCHIVE_SOURCE_INVALID"
      | "ARCHIVE_ENTRY_INVALID"
      | "ARCHIVE_ENTRY_SYMLINK"
      | "ARCHIVE_ENTRY_OUTSIDE_SOURCE"
      | "ARCHIVE_ENTRY_TOO_LARGE"
      | "ARCHIVE_ENTRY_NOT_FOUND"
      | "ARCHIVE_ENTRY_NOT_REGULAR"
      | "ARCHIVE_INVALID_UTF8"
      | "ARCHIVE_SOURCE_CHANGED"
      | "ARCHIVE_ENTRY_ENCRYPTED"
      | "ARCHIVE_ENTRY_DUPLICATE"
      | "ARCHIVE_ENTRY_AMBIGUOUS"
      | "ARCHIVE_ENTRY_COMPRESSED_TOO_LARGE"
      | "ARCHIVE_ENTRY_SIZE_INVALID"
      | "ARCHIVE_TOO_MANY_ENTRIES"
      | "ARCHIVE_TOTAL_TOO_LARGE"
      | "ARCHIVE_TOTAL_COMPRESSED_TOO_LARGE"
      | "ARCHIVE_APPENDED_DATA_TOO_LARGE"
      | "ARCHIVE_AMBIGUOUS"
      | "ARCHIVE_MALFORMED",
    message?: string
  ) {
    super(message ?? code);
    this.name = "ArchiveSourceError";
  }
}
