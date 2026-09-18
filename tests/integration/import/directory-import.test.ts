import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ImportArchive } from "../../../src/application/import/import-archive.js";
import { DirectoryArchiveSource } from "../../../src/infrastructure/archive/directory-archive-source.js";
import type { ArchiveDetector } from "../../../src/infrastructure/archive/archive-detector.js";
import { createDatabaseFixture, fixedNow } from "../../support/database.js";

const syntheticFixture = path.resolve("tests/fixtures/x-archive/synthetic");
const emptyFixture = path.resolve("tests/fixtures/x-archive/empty");

describe("importação de diretório X Archive", () => {
  it("importa os quatro tipos, preserva os bytes e deduplica uma repetição", async () => {
    const sourceDirectory = await copyFixture(syntheticFixture);
    const fixture = await createDatabaseFixture();
    try {
      const before = await snapshotFiles(sourceDirectory);
      const ids = ["import-1", "account-1", "import-2"];
      const importer = new ImportArchive(fixture.database, fixture.catalog, {
        now: () => fixedNow,
        idFactory: () => ids.shift() ?? "unexpected-id"
      });

      const first = await importer.execute(sourceDirectory);
      const second = await importer.execute(sourceDirectory);

      expect(first.adapterKey).toBe("ytd-synthetic-v1");
      expect(first.postsCount).toBe(1);
      expect(first.repliesCount).toBe(1);
      expect(first.repostsCount).toBe(1);
      expect(first.likesCount).toBe(1);
      expect(first.totalCount).toBe(4);
      expect(first.insertedCount).toBe(4);
      expect(second.reusedCount).toBe(4);
      expect(second.insertedCount).toBe(0);
      expect(second.updatedCount).toBe(0);
      expect(fixture.catalog.countInteractions(first.account.id)).toBe(4);
      expect(await snapshotFiles(sourceDirectory)).toEqual(before);

      const imports = fixture.database.connection
        .prepare(
          "SELECT status, inserted_count, reused_count FROM archive_imports ORDER BY created_at, id"
        )
        .all();
      expect(imports).toEqual([
        { status: "COMPLETED", inserted_count: 4, reused_count: 0 },
        { status: "COMPLETED", inserted_count: 0, reused_count: 4 }
      ]);
      const idsOnDisk = fixture.database.connection
        .prepare(
          "SELECT x_interaction_id, type, interaction_created_at FROM interactions ORDER BY id"
        )
        .all();
      expect(idsOnDisk).toContainEqual({
        x_interaction_id: "90071992547409931235",
        type: "POST",
        interaction_created_at: "2026-01-02T03:04:05.000Z"
      });
      expect(idsOnDisk).toContainEqual({
        x_interaction_id: "90071992547409931236",
        type: "REPLY",
        interaction_created_at: null
      });
    } finally {
      await fixture.cleanup();
      await rm(sourceDirectory, { recursive: true, force: true });
    }
  });

  it("trata um arquivo válido sem interações como sucesso vazio", async () => {
    const sourceDirectory = await copyFixture(emptyFixture);
    const fixture = await createDatabaseFixture();
    try {
      const importer = new ImportArchive(fixture.database, fixture.catalog, {
        now: () => fixedNow,
        idFactory: () => "empty-import"
      });
      const result = await importer.execute(sourceDirectory);

      expect(result.totalCount).toBe(0);
      expect(result.insertedCount).toBe(0);
      expect(fixture.catalog.countInteractions(result.account.id)).toBe(0);
      expect(result.archiveImport.status).toBe("COMPLETED");
    } finally {
      await fixture.cleanup();
      await rm(sourceDirectory, { recursive: true, force: true });
    }
  });

  it("rejeita conteúdo não suportado sem criar linhas do catálogo", async () => {
    const sourceDirectory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-unsupported-"));
    await writeFile(path.join(sourceDirectory, "random.js"), "console.log('synthetic');\n", "utf8");
    const fixture = await createDatabaseFixture();
    try {
      const importer = new ImportArchive(fixture.database, fixture.catalog, {
        now: () => fixedNow,
        idFactory: () => "unsupported-import"
      });

      await expect(importer.execute(sourceDirectory)).rejects.toThrow("UNSUPPORTED_ARCHIVE");
      expect(
        fixture.database.connection.prepare("SELECT count(*) AS count FROM interactions").get()
      ).toEqual({
        count: 0
      });
      expect(
        fixture.database.connection
          .prepare("SELECT status, error_code FROM archive_imports WHERE id = ?")
          .get("unsupported-import")
      ).toEqual({ status: "FAILED", error_code: "UNSUPPORTED_ARCHIVE" });
    } finally {
      await fixture.cleanup();
      await rm(sourceDirectory, { recursive: true, force: true });
    }
  });

  it("faz rollback de todas as interações quando uma escrita falha", async () => {
    const sourceDirectory = await copyFixture(syntheticFixture);
    const fixture = await createDatabaseFixture();
    try {
      const fakeDetector = {
        detect: async () => ({
          adapter: {
            key: "synthetic-test-adapter",
            parse: async () => ({
              account: { xUserId: "90071992547409931234", handle: "synthetic_owner" },
              interactions: [
                {
                  xInteractionId: "901" as never,
                  type: "POST" as const,
                  interactionCreatedAt: null,
                  contentPreview: null,
                  sourceRelativePath: "safe.js",
                  sourceRecordKey: "0"
                },
                {
                  xInteractionId: "902" as never,
                  type: "REPLY" as const,
                  interactionCreatedAt: null,
                  contentPreview: null,
                  sourceRelativePath: "../outside.js",
                  sourceRecordKey: "1"
                }
              ]
            })
          },
          evidence: []
        })
      } as unknown as ArchiveDetector;
      const importer = new ImportArchive(fixture.database, fixture.catalog, {
        detector: fakeDetector,
        now: () => fixedNow,
        idFactory: () => "rollback-import"
      });

      await expect(importer.execute(sourceDirectory)).rejects.toThrow();
      expect(
        fixture.database.connection.prepare("SELECT count(*) AS count FROM interactions").get()
      ).toEqual({
        count: 0
      });
      expect(
        fixture.database.connection
          .prepare("SELECT status, error_code FROM archive_imports WHERE id = ?")
          .get("rollback-import")
      ).toEqual({ status: "FAILED", error_code: "ARCHIVE_IMPORT_FAILED" });
    } finally {
      await fixture.cleanup();
      await rm(sourceDirectory, { recursive: true, force: true });
    }
  });

  it("rejeita symlink em vez de atravessar a fronteira do diretório", async () => {
    const sourceDirectory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-symlink-"));
    const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-outside-"));
    await writeFile(path.join(outsideDirectory, "secret.js"), "synthetic", "utf8");
    await symlink(
      path.join(outsideDirectory, "secret.js"),
      path.join(sourceDirectory, "secret.js")
    );
    try {
      await expect(new DirectoryArchiveSource(sourceDirectory).entries()).rejects.toThrow(
        "ARCHIVE_ENTRY_SYMLINK"
      );
    } finally {
      await rm(sourceDirectory, { recursive: true, force: true });
      await rm(outsideDirectory, { recursive: true, force: true });
    }
  });
});

async function copyFixture(source: string): Promise<string> {
  const target = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-archive-"));
  await cp(source, target, { recursive: true });
  return target;
}

async function snapshotFiles(directory: string): Promise<readonly [string, string][]> {
  const result: [string, string][] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else {
        result.push([
          path.relative(directory, absolute),
          (await readFile(absolute)).toString("hex")
        ]);
      }
    }
  };
  await walk(directory);
  result.sort(([left], [right]) => left.localeCompare(right));
  return result;
}
