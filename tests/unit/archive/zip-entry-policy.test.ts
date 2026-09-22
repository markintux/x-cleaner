import { describe, expect, it } from "vitest";

import { ArchiveSourceError } from "../../../src/application/ports/archive-source.js";
import {
  assertNoForbiddenArchiveWarnings,
  normalizeZipEntryName,
  validateZipEntries,
  type ZipEntryMetadata
} from "../../../src/infrastructure/archive/zip-entry-policy.js";

function entry(filename: string, options: Partial<ZipEntryMetadata> = {}): ZipEntryMetadata {
  return {
    filename,
    directory: false,
    compressedSize: 10,
    uncompressedSize: 10,
    ...options
  };
}

describe("política de entradas ZIP", () => {
  it("normaliza nomes relativos e rejeita escapes após a normalização", () => {
    expect(normalizeZipEntryName("folder\\../data/tweets.js")).toBe("data/tweets.js");
    expect(normalizeZipEntryName("archive//data//")).toBe("archive/data/");
    for (const name of [
      "../outside.js",
      "folder/../../outside.js",
      "/absolute.js",
      "\\\\server\\share\\archive.js",
      "C:\\archive.js",
      "C:archive.js"
    ]) {
      expect(() => normalizeZipEntryName(name)).toThrowError(
        expect.objectContaining({ code: "ARCHIVE_ENTRY_OUTSIDE_SOURCE" })
      );
    }
  });

  it("rejeita symlinks, entradas criptografadas e nomes duplicados normalizados", () => {
    expect(() => validateZipEntries([entry("link", { symlink: true })])).toThrowError(
      expect.objectContaining({ code: "ARCHIVE_ENTRY_SYMLINK" })
    );
    expect(() => validateZipEntries([entry("secret.js", { encrypted: true })])).toThrowError(
      expect.objectContaining({ code: "ARCHIVE_ENTRY_ENCRYPTED" })
    );
    expect(() =>
      validateZipEntries([entry("data/../data/tweets.js"), entry("data/tweets.js")])
    ).toThrowError(expect.objectContaining({ code: "ARCHIVE_ENTRY_DUPLICATE" }));
    expect(() => validateZipEntries([entry("link", { unixMode: 0o120777 })])).toThrowError(
      expect.objectContaining({ code: "ARCHIVE_ENTRY_SYMLINK" })
    );
  });

  it("aplica limites de contagem, compressão, expansão e total antes dos bytes", () => {
    expect(() => validateZipEntries([entry("one.js"), entry("two.js")], { maxEntries: 1 })).toThrow(
      "ARCHIVE_TOO_MANY_ENTRIES"
    );
    expect(() =>
      validateZipEntries([entry("one.js", { compressedSize: 11 })], {
        maxEntryCompressedBytes: 10
      })
    ).toThrow("ARCHIVE_ENTRY_COMPRESSED_TOO_LARGE");
    expect(() =>
      validateZipEntries([entry("one.js", { uncompressedSize: 11 })], {
        maxEntryUncompressedBytes: 10
      })
    ).toThrow("ARCHIVE_ENTRY_TOO_LARGE");
    expect(() =>
      validateZipEntries([entry("one.js"), entry("two.js")], {
        maxTotalRelevantUncompressedBytes: 15
      })
    ).toThrow("ARCHIVE_TOTAL_TOO_LARGE");
    expect(() =>
      validateZipEntries(
        [entry("one.js", { compressedSize: 6 }), entry("two.js", { compressedSize: 6 })],
        {
          maxTotalCompressedBytes: 10
        }
      )
    ).toThrow("ARCHIVE_TOTAL_COMPRESSED_TOO_LARGE");
  });

  it("rejeita ambiguidade estrutural conhecida", () => {
    expect(() => assertNoForbiddenArchiveWarnings([{ reason: "appended data" }])).toThrowError(
      expect.objectContaining({ code: "ARCHIVE_AMBIGUOUS" })
    );
    expect(() =>
      assertNoForbiddenArchiveWarnings([{ reason: "unsorted central directory" }])
    ).not.toThrow();
  });

  it("mantém códigos de política como falhas sanitizáveis", () => {
    try {
      validateZipEntries([entry("bad.js", { uncompressedSize: Number.MAX_SAFE_INTEGER + 1 })]);
    } catch (error) {
      expect(error).toBeInstanceOf(ArchiveSourceError);
      expect((error as ArchiveSourceError).code).toBe("ARCHIVE_ENTRY_SIZE_INVALID");
    }
  });
});
