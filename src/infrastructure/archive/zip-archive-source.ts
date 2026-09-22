import { openAsBlob } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

import { BlobReader, ZipReader, type Entry, type FileEntry } from "@zip-js/zip-js";

import {
  ArchiveSourceError,
  type ArchiveEntry,
  type ArchiveSource,
  type ArchiveTextReadOptions
} from "../../application/ports/archive-source.js";
import { fingerprintZipFile } from "./source-fingerprint.js";
import {
  assertNoForbiddenArchiveWarnings,
  DEFAULT_ZIP_ENTRY_POLICY,
  normalizeZipEntryName,
  validateZipEntries,
  type ValidatedZipEntry,
  type ZipEntryMetadata,
  type ZipEntryPolicyOptions
} from "./zip-entry-policy.js";

export interface ZipArchiveSourceOptions extends ZipEntryPolicyOptions {
  /** Compatibility alias for the directory source's per-entry limit. */
  readonly maxEntryBytes?: number;
  /** Maximum bytes accepted by one text read, independent of ZIP metadata. */
  readonly maxTextBytes?: number;
  /** Maximum tolerated bytes after the end-of-central-directory record. */
  readonly maxAppendedDataSize?: number;
}

const DEFAULT_MAX_APPENDED_DATA_SIZE = 1024 * 1024;
const TRAILING_CENTRAL_DIRECTORY_WARNING = "trailing central directory data";
const REDUNDANT_ZIP64_END_RECORD_BYTES = 76;
const REDUNDANT_ZIP64_PROBE_BYTES = REDUNDANT_ZIP64_END_RECORD_BYTES + 4;

/**
 * A read-only, non-extracting ZIP source. Each operation owns a ZipReader and
 * closes it in a finally block, so a failed parse cannot leave a reader alive.
 */
export class ZipArchiveSource implements ArchiveSource {
  readonly kind = "ZIP" as const;
  readonly label: string;
  readonly #filename: string;
  readonly #policyOptions: ZipEntryPolicyOptions;
  readonly #maxTextBytes: number;
  readonly #maxAppendedDataSize: number;

  constructor(filename: string, options: ZipArchiveSourceOptions = {}) {
    this.#filename = path.resolve(filename);
    this.label = safeLabel(this.#filename);

    const maxEntryBytes = options.maxEntryBytes;
    this.#policyOptions = {
      ...options,
      ...(maxEntryBytes === undefined ? {} : { maxEntryUncompressedBytes: maxEntryBytes })
    };
    this.#maxTextBytes =
      options.maxTextBytes ??
      options.maxEntryUncompressedBytes ??
      maxEntryBytes ??
      DEFAULT_ZIP_ENTRY_POLICY.maxEntryUncompressedBytes;
    this.#maxAppendedDataSize = options.maxAppendedDataSize ?? DEFAULT_MAX_APPENDED_DATA_SIZE;
    validatePositiveLimit(this.#maxTextBytes);
    validateNonNegativeLimit(this.#maxAppendedDataSize);
  }

  async entries(): Promise<readonly ArchiveEntry[]> {
    const readerState = await this.#openReader();
    try {
      return readerState.entries
        .filter(({ entry }) => !entry.directory)
        .map(({ entry, name }) => ({ name, size: entry.uncompressedSize }))
        .sort((left, right) => left.name.localeCompare(right.name));
    } finally {
      await readerState.reader.close();
    }
  }

  listEntries(): Promise<readonly ArchiveEntry[]> {
    return this.entries();
  }

  async *openText(name: string, options: ArchiveTextReadOptions = {}): AsyncIterable<string> {
    const normalized = normalizeZipEntryName(name);
    const maxBytes = options.maxBytes ?? this.#maxTextBytes;
    validatePositiveLimit(maxBytes);
    const readerState = await this.#openReader();
    try {
      const selected = readerState.entries.find((item) => item.name === normalized);
      if (selected === undefined) {
        throw new ArchiveSourceError("ARCHIVE_ENTRY_NOT_FOUND");
      }
      if (selected.entry.directory) {
        throw new ArchiveSourceError("ARCHIVE_ENTRY_NOT_REGULAR");
      }
      if (selected.entry.uncompressedSize > maxBytes) {
        throw new ArchiveSourceError("ARCHIVE_ENTRY_TOO_LARGE");
      }

      yield* this.#streamText(selected.entry, maxBytes);
    } finally {
      await readerState.reader.close();
    }
  }

  async readText(name: string, options: ArchiveTextReadOptions = {}): Promise<string> {
    let result = "";
    for await (const chunk of this.openText(name, options)) {
      result += chunk;
    }
    return result;
  }

  fingerprint(): Promise<string> {
    return fingerprintZipFile(this.#filename);
  }

  async #openReader(): Promise<ZipReaderState> {
    let reader: ZipReader<Blob> | undefined;
    try {
      const blob = await openAsBlob(this.#filename);
      reader = new ZipReader(new BlobReader(blob), {
        strictness: "balanced",
        filenameValidation: "strict",
        normalizeFilename: normalizeZipEntryName,
        checkLocalDirectory: true,
        checkLocalFilename: true,
        maxAppendedDataSize: this.#maxAppendedDataSize
      });
      const entries = await reader.getEntries();
      const warnings = reader.warnings ?? [];
      const permitsRedundantZip64 =
        warnings.some(({ reason }) => reason === TRAILING_CENTRAL_DIRECTORY_WARNING) &&
        (await hasConsistentRedundantZip64EndRecords(
          this.#filename,
          reader.directoryOffset,
          reader.directoryLength,
          entries.length
        ));
      assertNoForbiddenArchiveWarnings(
        permitsRedundantZip64
          ? warnings.filter(({ reason }) => reason !== TRAILING_CENTRAL_DIRECTORY_WARNING)
          : warnings
      );
      const validated = validateZipEntries(
        entries as readonly (Entry & ZipEntryMetadata)[],
        this.#policyOptions
      );
      return { reader, entries: validated as readonly ValidatedZipEntry<Entry>[] };
    } catch (error) {
      if (reader !== undefined) {
        await reader.close().catch(() => undefined);
      }
      throw toArchiveSourceError(error);
    }
  }

  async *#streamText(entry: FileEntry, maxBytes: number): AsyncIterable<string> {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytesRead = 0;
    const transform = new TransformStream<Uint8Array, string>({
      transform: (chunk, controller) => {
        bytesRead += chunk.byteLength;
        if (bytesRead > maxBytes) {
          throw new ArchiveSourceError("ARCHIVE_ENTRY_TOO_LARGE");
        }
        try {
          const text = decoder.decode(chunk, { stream: true });
          if (text.length > 0) controller.enqueue(text);
        } catch {
          throw new ArchiveSourceError("ARCHIVE_INVALID_UTF8");
        }
      },
      flush: (controller) => {
        try {
          const text = decoder.decode();
          if (text.length > 0) controller.enqueue(text);
        } catch {
          throw new ArchiveSourceError("ARCHIVE_INVALID_UTF8");
        }
      }
    });
    const output = transform.readable.getReader();
    const dataPromise = entry.getData(transform.writable);
    let finished = false;

    try {
      while (true) {
        const next = await output.read();
        if (next.done) break;
        if (next.value !== undefined) yield next.value;
      }
      await dataPromise;
      finished = true;
    } catch (error) {
      await dataPromise.catch(() => undefined);
      throw toArchiveSourceError(error);
    } finally {
      if (!finished) {
        await output.cancel().catch(() => undefined);
        await dataPromise.catch(() => undefined);
      }
      output.releaseLock();
    }
  }
}

async function hasConsistentRedundantZip64EndRecords(
  filename: string,
  directoryOffset: number | undefined,
  directoryLength: number | undefined,
  entryCount: number
): Promise<boolean> {
  if (
    directoryOffset === undefined ||
    directoryLength === undefined ||
    !Number.isSafeInteger(directoryOffset) ||
    !Number.isSafeInteger(directoryLength) ||
    !Number.isSafeInteger(entryCount) ||
    directoryOffset < 0 ||
    directoryLength < 0 ||
    entryCount < 0
  ) {
    return false;
  }

  const recordsOffset = directoryOffset + directoryLength;
  if (!Number.isSafeInteger(recordsOffset)) return false;

  const bytes = Buffer.alloc(REDUNDANT_ZIP64_PROBE_BYTES);
  const handle = await open(filename, "r");
  try {
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, recordsOffset);
    if (bytesRead !== bytes.length) return false;
  } finally {
    await handle.close();
  }

  const zip64EndSignature = 0x06064b50;
  const zip64LocatorSignature = 0x07064b50;
  const classicEndSignature = 0x06054b50;
  const expectedEntries = BigInt(entryCount);

  return (
    bytes.readUInt32LE(0) === zip64EndSignature &&
    bytes.readBigUInt64LE(4) === 44n &&
    bytes.readUInt32LE(16) === 0 &&
    bytes.readUInt32LE(20) === 0 &&
    bytes.readBigUInt64LE(24) === expectedEntries &&
    bytes.readBigUInt64LE(32) === expectedEntries &&
    bytes.readBigUInt64LE(40) === BigInt(directoryLength) &&
    bytes.readBigUInt64LE(48) === BigInt(directoryOffset) &&
    bytes.readUInt32LE(56) === zip64LocatorSignature &&
    bytes.readUInt32LE(60) === 0 &&
    bytes.readBigUInt64LE(64) === BigInt(recordsOffset) &&
    bytes.readUInt32LE(72) === 1 &&
    bytes.readUInt32LE(REDUNDANT_ZIP64_END_RECORD_BYTES) === classicEndSignature
  );
}

interface ZipReaderState {
  readonly reader: ZipReader<Blob>;
  readonly entries: readonly ValidatedZipEntry<Entry>[];
}

function safeLabel(filename: string): string {
  const label = path.basename(filename);
  if (
    label.length === 0 ||
    label === "." ||
    label === ".." ||
    label.includes("/") ||
    label.includes("\\")
  ) {
    throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID");
  }
  return label;
}

function validatePositiveLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID", "invalid archive entry limit");
  }
}

function validateNonNegativeLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID", "invalid archive appended-data limit");
  }
}

function toArchiveSourceError(error: unknown): ArchiveSourceError {
  if (error instanceof ArchiveSourceError) return error;
  const message = error instanceof Error ? error.message : "";
  const reason = (error as { reason?: unknown }).reason;
  if (reason === "appended data") {
    return new ArchiveSourceError("ARCHIVE_APPENDED_DATA_TOO_LARGE");
  }
  if (reason === "duplicate filename") {
    return new ArchiveSourceError("ARCHIVE_ENTRY_DUPLICATE");
  }
  if (/encrypt/i.test(message)) return new ArchiveSourceError("ARCHIVE_ENTRY_ENCRYPTED");
  if (/duplicate filename/i.test(message)) return new ArchiveSourceError("ARCHIVE_ENTRY_DUPLICATE");
  if (/unsafe filename/i.test(message)) {
    return new ArchiveSourceError("ARCHIVE_ENTRY_OUTSIDE_SOURCE");
  }
  if (/ambiguous|appended data|central directory/i.test(message)) {
    return new ArchiveSourceError("ARCHIVE_AMBIGUOUS");
  }
  if (/invalid utf|utf-?8/i.test(message)) return new ArchiveSourceError("ARCHIVE_INVALID_UTF8");
  return new ArchiveSourceError("ARCHIVE_MALFORMED");
}
