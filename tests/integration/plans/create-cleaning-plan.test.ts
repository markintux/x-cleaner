import { describe, expect, it } from "vitest";

import { createCleaningPlan } from "../../../src/application/plans/create-cleaning-plan.js";
import { xInteractionId } from "../../../src/domain/interaction.js";
import { SelectionValidationError } from "../../../src/domain/selection.js";
import { createDatabaseFixture, digest, fixedNow, seedCatalog } from "../../support/database.js";

describe("createCleaningPlan", () => {
  it("salva a fotografia exata, ordenada e limitada ao catálogo atual", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const post = addCatalogItem(
        fixture,
        accountId,
        importId,
        "1",
        "POST",
        "2026-01-01T00:00:00.000Z"
      );
      const reply = addCatalogItem(
        fixture,
        accountId,
        importId,
        "2",
        "REPLY",
        "2026-01-31T23:59:59.999Z"
      );
      addCatalogItem(fixture, accountId, importId, "3", "REPOST", "2026-02-01T00:00:00.000Z");
      addCatalogItem(fixture, accountId, importId, "4", "LIKE", null);

      const created = createCleaningPlan(
        fixture.transactions,
        fixture.catalog,
        fixture.plans,
        {
          accountId,
          types: ["POST", "REPLY"],
          from: "2026-01-01",
          to: "2026-01-31"
        },
        { now: () => fixedNow, idFactory: () => "plan-exact" }
      );

      expect(created.plan.catalogCutoffId).toBe(4);
      expect(created.plan.selectedCount).toBe(2);
      expect(created.filters).toEqual({
        types: ["POST", "REPLY"],
        fromAt: "2026-01-01T00:00:00.000Z",
        toAt: "2026-01-31T23:59:59.999Z"
      });
      expect(created.items.map((item) => item.interactionId)).toEqual([post, reply]);
      expect(
        fixture.plans.getSnapshot("plan-exact")?.items.map((item) => item.interactionId)
      ).toEqual([post, reply]);

      fixture.catalog.createArchiveImport({
        id: "import-2",
        accountId,
        sourceKind: "DIRECTORY",
        sourceLabel: "later-import",
        sourceSha256: digest,
        adapterKey: "synthetic-ytd",
        status: "COMPLETED",
        startedAt: fixedNow,
        finishedAt: fixedNow
      });
      const later = addCatalogItem(fixture, accountId, "import-2", "5", "POST", fixedNow);
      expect(later).toBeGreaterThan(created.plan.catalogCutoffId);
      expect(
        fixture.plans.getSnapshot("plan-exact")?.items.map((item) => item.interactionId)
      ).toEqual([post, reply]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("recusa um plano vazio sem persistir seu cabeçalho", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      addCatalogItem(fixture, accountId, importId, "1", "LIKE", null);

      expect(() =>
        createCleaningPlan(fixture.transactions, fixture.catalog, fixture.plans, {
          accountId,
          types: ["POST"]
        })
      ).toThrowError(SelectionValidationError);
      expect(
        fixture.database.connection.prepare("SELECT count(*) AS count FROM cleaning_plans").get()
      ).toEqual({ count: 0 });
    } finally {
      await fixture.cleanup();
    }
  });
});

function addCatalogItem(
  fixture: Awaited<ReturnType<typeof createDatabaseFixture>>,
  accountId: string,
  importId: string,
  suffix: string,
  type: "POST" | "REPLY" | "REPOST" | "LIKE",
  createdAt: string | null
): number {
  return fixture.catalog.upsertInteraction({
    accountId,
    xInteractionId: xInteractionId(`9100000000000000000${suffix}`),
    type,
    interactionCreatedAt: createdAt,
    contentPreview: "conteúdo que não participa da seleção",
    sourceRelativePath: `data/${type.toLowerCase()}.js`,
    sourceRecordKey: suffix,
    importId
  }).interaction.id;
}
