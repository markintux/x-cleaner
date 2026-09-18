import { describe, expect, it } from "vitest";

import { xInteractionId } from "../../../src/domain/interaction.js";
import {
  addInteraction,
  createDatabaseFixture,
  digest,
  fixedNow,
  seedCatalog
} from "../../support/database.js";

describe("SqliteCatalogRepository", () => {
  it("insere, reutiliza e atualiza interações sem duplicá-las", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const inserted = fixture.catalog.upsertInteraction({
        accountId,
        xInteractionId: xInteractionId("90071992547409931234"),
        type: "POST",
        interactionCreatedAt: fixedNow,
        contentPreview: "conteúdo sintético",
        sourceRelativePath: "data/tweets.js",
        sourceRecordKey: "0",
        importId
      });
      fixture.catalog.createArchiveImport({
        id: "import-2",
        accountId,
        sourceKind: "DIRECTORY",
        sourceLabel: "synthetic-2",
        sourceSha256: digest,
        adapterKey: "synthetic-ytd",
        status: "COMPLETED",
        startedAt: fixedNow
      });
      const reused = fixture.catalog.upsertInteraction({
        accountId,
        xInteractionId: xInteractionId("90071992547409931234"),
        type: "POST",
        interactionCreatedAt: fixedNow,
        contentPreview: "conteúdo sintético",
        sourceRelativePath: "data/tweets.js",
        sourceRecordKey: "0",
        importId: "import-2"
      });
      fixture.catalog.createArchiveImport({
        id: "import-3",
        accountId,
        sourceKind: "DIRECTORY",
        sourceLabel: "synthetic-3",
        sourceSha256: digest,
        adapterKey: "synthetic-ytd",
        status: "COMPLETED",
        startedAt: fixedNow
      });
      const updated = fixture.catalog.upsertInteraction({
        accountId,
        xInteractionId: xInteractionId("90071992547409931234"),
        type: "POST",
        interactionCreatedAt: fixedNow,
        contentPreview: "conteúdo corrigido",
        sourceRelativePath: "data/tweets.js",
        sourceRecordKey: "1",
        importId: "import-3"
      });

      expect(inserted.kind).toBe("INSERTED");
      expect(reused.kind).toBe("REUSED");
      expect(updated.kind).toBe("UPDATED");
      expect(fixture.catalog.countInteractions(accountId)).toBe(1);
      expect(updated.interaction.firstSeenImportId).toBe(importId);
      expect(updated.interaction.lastSeenImportId).toBe("import-3");
    } finally {
      await fixture.cleanup();
    }
  });

  it("mantém catálogos de diretórios de dados distintos isolados", async () => {
    const first = await createDatabaseFixture();
    const second = await createDatabaseFixture();
    try {
      const firstCatalog = seedCatalog(first, "1");
      const secondCatalog = seedCatalog(second, "2");
      addInteraction(first, firstCatalog.accountId, firstCatalog.importId, 1);
      addInteraction(second, secondCatalog.accountId, secondCatalog.importId, 2, "LIKE");

      expect(first.catalog.countInteractions(firstCatalog.accountId)).toBe(1);
      expect(second.catalog.countInteractions(secondCatalog.accountId)).toBe(1);
      expect(first.catalog.countInteractions(secondCatalog.accountId)).toBe(0);
      expect(second.catalog.countInteractions(firstCatalog.accountId)).toBe(0);
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });
});
