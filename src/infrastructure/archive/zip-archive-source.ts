import { openAsBlob } from "node:fs";
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
        strictness: "strict",
        maxAppendedDataSize: this.#maxAppendedDataSize
      });
      const entries = await reader.getEntries();
      assertNoForbiddenArchiveWarnings(reader.warnings);
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
