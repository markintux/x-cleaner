import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip-js/zip-js";
import { describe, expect, it } from "vitest";

import { ImportArchive } from "../../../src/application/import/import-archive.js";
import { ZipArchiveSource } from "../../../src/infrastructure/archive/zip-archive-source.js";
import { createDatabaseFixture, fixedNow } from "../../support/database.js";
import { createArchiveParser, createArchiveSource } from "../../support/archive.js";

const syntheticFixture = path.resolve("tests/fixtures/x-archive/synthetic");

describe("importação segura de ZIP", () => {
  it("produz o mesmo catálogo do diretório, preserva bytes e lê Zip64 sem extrair", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-zip-import-"));
    const directory = path.join(workspace, "directory");
    const zipPath = path.join(workspace, "synthetic.zip");
    const fixture = await createDatabaseFixture();
    try {
      await cp(syntheticFixture, directory, { recursive: true });
      await writeZipFromDirectory(directory, zipPath, true);
      const before = await readFile(zipPath);
      const importer = new ImportArchive(
        fixture.transactions,
        fixture.catalog,
        createArchiveParser(),
        {
          sourceFactory: createArchiveSource,
          now: () => fixedNow,
          idFactory: (() => {
            const ids = ["directory-import", "directory-account", "zip-import"];
            return () => ids.shift() ?? "unexpected-id";
          })()
        }
      );

      const directoryResult = await importer.execute(directory);
      const zipResult = await importer.execute(zipPath);

      expect(zipResult.archiveImport.sourceKind).toBe("ZIP");
      expect(zipResult.archiveImport.sourceLabel).toBe("synthetic.zip");
      expect(zipResult.archiveImport.sourceSha256).toBe(
        createHash("sha256").update(before).digest("hex")
      );
      expect(zipResult.postsCount).toBe(1);
      expect(zipResult.repliesCount).toBe(1);
      expect(zipResult.repostsCount).toBe(1);
      expect(zipResult.likesCount).toBe(1);
      expect(zipResult.totalCount).toBe(4);
      expect(zipResult.insertedCount).toBe(0);
      expect(zipResult.reusedCount).toBe(4);

      const rows = fixture.database.connection
        .prepare(
          `SELECT x_interaction_id, type, interaction_created_at, content_preview,
                  source_relative_path, source_record_key
           FROM interactions ORDER BY type, x_interaction_id`
        )
        .all();
      expect(rows).toEqual([
        {
          x_interaction_id: "90071992547409931238",
          type: "LIKE",
          interaction_created_at: null,
          content_preview: null,
          source_relative_path: "data/likes.js",
          source_record_key: "0"
        },
        {
          x_interaction_id: "90071992547409931235",
          type: "POST",
          interaction_created_at: "2026-01-02T03:04:05.000Z",
          content_preview: "synthetic original post",
          source_relative_path: "data/records.js",
          source_record_key: "0"
        },
        {
          x_interaction_id: "90071992547409931236",
          type: "REPLY",
          interaction_created_at: null,
          content_preview: "synthetic reply",
          source_relative_path: "data/records.js",
          source_record_key: "1"
        },
        {
          x_interaction_id: "90071992547409931237",
          type: "REPOST",
          interaction_created_at: null,
          content_preview: "synthetic repost",
          source_relative_path: "data/records.js",
          source_record_key: "2"
        }
      ]);
      expect(await readFile(zipPath)).toEqual(before);
      expect(await readdir(workspace)).toEqual(["directory", "synthetic.zip"]);
      expect(directoryResult.totalCount).toBe(4);
    } finally {
      await fixture.cleanup();
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("fecha o leitor em sucesso e falha, e não mantém o ZIP aberto", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-zip-cleanup-"));
    const zipPath = path.join(workspace, "archive.zip");
    try {
      await writeZipFromDirectory(syntheticFixture, zipPath, true);
      const source = new ZipArchiveSource(zipPath);
      await source.entries();
      await source.readText("data/account.js");
      await expect(source.readText("missing.js")).rejects.toThrow("ARCHIVE_ENTRY_NOT_FOUND");
      await rm(zipPath);
      await expect(stat(zipPath)).rejects.toThrow();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("aceita separadores duplicados inofensivos sem relaxar a validação estrutural", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-zip-normalized-name-"));
    const zipPath = path.join(workspace, "archive.zip");
    try {
      const writer = new ZipWriter(new Uint8ArrayWriter());
      await writer.add("archive//data//", undefined, { directory: true });
      await writer.add(
        "archive//data//account.js",
        new Uint8ArrayReader(
          Buffer.from(
            'window.YTD.account.part0 = [{"account":{"accountId":"101","userName":"@synthetic"}}];',
            "utf8"
          )
        )
      );
      await writeFile(zipPath, await writer.close());

      const source = new ZipArchiveSource(zipPath);
      expect(await source.entries()).toEqual([
        expect.objectContaining({ name: "archive/data/account.js" })
      ]);
      await expect(source.readText("archive/data/account.js")).resolves.toContain(
        "window.YTD.account"
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("aceita somente registros ZIP64 redundantes consistentes antes do EOCD clássico", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-zip64-redundant-"));
    const zipPath = path.join(workspace, "redundant.zip");
    const ambiguousPath = path.join(workspace, "ambiguous.zip");
    try {
      await writeZipFromDirectory(syntheticFixture, zipPath, true);
      const redundant = await readFile(zipPath);
      replaceClassicEndFieldsWithZip64Values(redundant);
      await writeFile(zipPath, redundant);

      await expect(new ZipArchiveSource(zipPath).entries()).resolves.toHaveLength(3);

      const endOffset = findEndOfCentralDirectory(redundant);
      const ambiguous = Buffer.concat([
        redundant.subarray(0, endOffset),
        Buffer.from([0x00]),
        redundant.subarray(endOffset)
      ]);
      await writeFile(ambiguousPath, ambiguous);
      await expect(new ZipArchiveSource(ambiguousPath).entries()).rejects.toThrow(
        "ARCHIVE_AMBIGUOUS"
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("falha antes de consumir conteúdo quando limites são excedidos", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-zip-limit-"));
    const zipPath = path.join(workspace, "archive.zip");
    const appendedPath = path.join(workspace, "appended.zip");
    try {
      await writeZipFromDirectory(syntheticFixture, zipPath, true);
      const source = new ZipArchiveSource(zipPath, { maxEntries: 2 });
      await expect(source.entries()).rejects.toThrow("ARCHIVE_TOO_MANY_ENTRIES");
      const bounded = new ZipArchiveSource(zipPath, { maxEntryUncompressedBytes: 20 });
      await expect(bounded.entries()).rejects.toThrow("ARCHIVE_ENTRY_TOO_LARGE");
      await writeFile(appendedPath, Buffer.concat([await readFile(zipPath), Buffer.from([0x01])]));
      await expect(
        new ZipArchiveSource(appendedPath, { maxAppendedDataSize: 0 }).entries()
      ).rejects.toThrow("ARCHIVE_APPENDED_DATA_TOO_LARGE");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("rejeita traversal, criptografia e symlink pelos metadados do ZIP", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-zip-hostile-"));
    const traversalPath = path.join(workspace, "traversal.zip");
    const encryptedPath = path.join(workspace, "encrypted.zip");
    const symlinkPath = path.join(workspace, "symlink.zip");
    try {
      await writeZipWithEntry(traversalPath, "data/file.js", "../inside.js");
      await expect(new ZipArchiveSource(traversalPath).entries()).rejects.toThrow(
        "ARCHIVE_ENTRY_OUTSIDE_SOURCE"
      );

      const encryptedWriter = new ZipWriter(new Uint8ArrayWriter());
      await encryptedWriter.add(
        "data/secret.js",
        new Uint8ArrayReader(Buffer.from("synthetic", "utf8")),
        { password: "synthetic-password" }
      );
      await writeFile(encryptedPath, await encryptedWriter.close());
      await expect(new ZipArchiveSource(encryptedPath).entries()).rejects.toThrow(
        "ARCHIVE_ENTRY_ENCRYPTED"
      );

      const symlinkWriter = new ZipWriter(new Uint8ArrayWriter());
      await symlinkWriter.add(
        "data/link.js",
        new Uint8ArrayReader(Buffer.from("data/tweets.js", "utf8")),
        { unixMode: 0o120777 }
      );
      await writeFile(symlinkPath, await symlinkWriter.close());
      await expect(new ZipArchiveSource(symlinkPath).entries()).rejects.toThrow(
        "ARCHIVE_ENTRY_SYMLINK"
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("sanitiza ZIP malformado sem criar uma árvore de extração", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-zip-invalid-"));
    const zipPath = path.join(workspace, "malformed.zip");
    const fixture = await createDatabaseFixture();
    try {
      await writeFile(zipPath, Buffer.from("synthetic-not-a-zip", "utf8"));
      const importer = new ImportArchive(
        fixture.transactions,
        fixture.catalog,
        createArchiveParser(),
        {
          sourceFactory: createArchiveSource,
          now: () => fixedNow,
          idFactory: () => "malformed-import"
        }
      );
      await expect(importer.execute(zipPath)).rejects.toThrow("ARCHIVE_MALFORMED");
      expect(
        fixture.database.connection
          .prepare("SELECT status, source_kind, source_label, error_code FROM archive_imports")
          .get()
      ).toEqual({
        status: "FAILED",
        source_kind: "ZIP",
        source_label: "malformed.zip",
        error_code: "ARCHIVE_MALFORMED"
      });
      expect(await readdir(workspace)).toEqual(["malformed.zip"]);
    } finally {
      await fixture.cleanup();
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

async function writeZipFromDirectory(
  sourceDirectory: string,
  zipPath: string,
  forceZip64: boolean
): Promise<void> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { zip64: forceZip64 });
  for (const file of await filesIn(sourceDirectory)) {
    const bytes = await readFile(file.absolute);
    await writer.add(
      path.relative(sourceDirectory, file.absolute).replaceAll(path.sep, "/"),
      new Uint8ArrayReader(bytes)
    );
  }
  const bytes = await writer.close(undefined, { zip64: forceZip64 });
  await writeFile(zipPath, bytes);
}

async function writeZipWithEntry(
  zipPath: string,
  originalName: string,
  replacementName: string
): Promise<void> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(originalName, new Uint8ArrayReader(Buffer.from("synthetic", "utf8")));
  const original = await writer.close();
  const bytes = Buffer.from(original);
  const originalBytes = Buffer.from(originalName, "utf8");
  const replacementBytes = Buffer.from(replacementName, "utf8");
  if (originalBytes.length !== replacementBytes.length) {
    throw new Error("TEST_ENTRY_NAME_LENGTH_MISMATCH");
  }
  let offset = bytes.indexOf(originalBytes);
  while (offset >= 0) {
    replacementBytes.copy(bytes, offset);
    offset = bytes.indexOf(originalBytes, offset + replacementBytes.length);
  }
  await writeFile(zipPath, bytes);
}

function replaceClassicEndFieldsWithZip64Values(bytes: Buffer): void {
  const endOffset = findEndOfCentralDirectory(bytes);
  const locatorOffset = endOffset - 20;
  expect(bytes.readUInt32LE(locatorOffset)).toBe(0x07064b50);
  const zip64Offset = Number(bytes.readBigUInt64LE(locatorOffset + 8));
  expect(bytes.readUInt32LE(zip64Offset)).toBe(0x06064b50);

  bytes.writeUInt16LE(0, endOffset + 4);
  bytes.writeUInt16LE(0, endOffset + 6);
  bytes.writeUInt16LE(Number(bytes.readBigUInt64LE(zip64Offset + 24)), endOffset + 8);
  bytes.writeUInt16LE(Number(bytes.readBigUInt64LE(zip64Offset + 32)), endOffset + 10);
  bytes.writeUInt32LE(Number(bytes.readBigUInt64LE(zip64Offset + 40)), endOffset + 12);
  bytes.writeUInt32LE(Number(bytes.readBigUInt64LE(zip64Offset + 48)), endOffset + 16);
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("TEST_EOCD_NOT_FOUND");
}

async function filesIn(directory: string): Promise<readonly { absolute: string }[]> {
  const result: { absolute: string }[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) result.push(...(await filesIn(absolute)));
    if (item.isFile()) result.push({ absolute });
  }
  return result;
}
