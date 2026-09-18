import { describe, expect, it } from "vitest";

import {
  addInteraction,
  createDatabaseFixture,
  createPlan,
  seedCatalog
} from "../../support/database.js";

describe("SqlitePlanRepository", () => {
  it("persiste a seleção exata, ordenada e imutável do dry-run", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const first = addInteraction(fixture, accountId, importId, 1, "POST");
      const second = addInteraction(fixture, accountId, importId, 2, "REPLY");
      const plan = createPlan(fixture, accountId, [second, first], ["POST", "REPLY"]);

      expect(fixture.plans.getSnapshot(plan.id)).toEqual({
        plan,
        types: ["POST", "REPLY"],
        items: [
          { planId: plan.id, interactionId: second, sequence: 1, createdAt: plan.createdAt },
          { planId: plan.id, interactionId: first, sequence: 2, createdAt: plan.createdAt }
        ]
      });
      expect(() => fixture.plans.createSnapshot({ plan, types: ["POST"], items: [] })).toThrow();
    } finally {
      await fixture.cleanup();
    }
  });

  it("não amplia a fotografia do plano após uma importação posterior", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const original = addInteraction(fixture, accountId, importId, 1);
      const plan = createPlan(fixture, accountId, [original]);
      const later = addInteraction(fixture, accountId, importId, 2, "LIKE");

      const snapshot = fixture.plans.getSnapshot(plan.id);
      expect(snapshot?.items.map((item) => item.interactionId)).toEqual([original]);
      expect(snapshot?.items.map((item) => item.interactionId)).not.toContain(later);
      expect(snapshot?.plan.catalogCutoffId).toBe(original);
    } finally {
      await fixture.cleanup();
    }
  });
});
