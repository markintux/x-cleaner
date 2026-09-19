import { describe, expect, it } from "vitest";

import { PauseRun } from "../../../src/application/runs/pause-run.js";
import { ConfirmAccount } from "../../../src/application/session/confirm-account.js";
import { LoginSession } from "../../../src/application/session/login-session.js";
import { UnitOfWork } from "../../../src/infrastructure/database/unit-of-work.js";
import {
  addInteraction,
  createDatabaseFixture,
  createPlan,
  fixedNow,
  seedCatalog
} from "../../support/database.js";

describe("pausas seguras e restauração de sessão", () => {
  it.each([
    [
      "RATE_LIMIT",
      { kind: "CHALLENGE_OR_RATE_LIMIT", outcome: "PAUSED", pauseReason: "RATE_LIMIT" }
    ],
    [
      "SECURITY_CHALLENGE",
      {
        kind: "CHALLENGE_OR_RATE_LIMIT",
        outcome: "PAUSED",
        pauseReason: "SECURITY_CHALLENGE"
      }
    ],
    [
      "SESSION_EXPIRED",
      { kind: "SESSION_EXPIRED", outcome: "PAUSED", pauseReason: "SESSION_EXPIRED" }
    ],
    ["UNKNOWN_UI", { kind: "UNKNOWN_UI", outcome: "PAUSED", pauseReason: "UNKNOWN_UI" }]
  ] as const)("persiste a pausa distinta %s antes da orientação", async (reason, outcome) => {
    const fixture = await createDatabaseFixture();
    try {
      const { accountId, importId } = seedCatalog(fixture);
      const interactionId = addInteraction(fixture, accountId, importId, 1);
      const plan = createPlan(fixture, accountId, [interactionId]);
      fixture.runs.createRun({
        id: `run-${reason.toLowerCase()}`,
        planId: plan.id,
        accountId,
        boundHandle: "synthetic-1",
        status: "RUNNING",
        pauseReason: null,
        startedAt: fixedNow,
        pausedAt: null,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      fixture.runs.createBatch({
        id: `batch-${reason.toLowerCase()}`,
        runId: `run-${reason.toLowerCase()}`,
        requestedLimit: 1,
        confirmedAt: fixedNow,
        status: "RUNNING",
        startedAt: fixedNow,
        finishedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      let guidanceSawPersistedPause = false;
      const result = new PauseRun(
        {
          runs: fixture.runs,
          audit: fixture.audit,
          unitOfWork: new UnitOfWork(fixture.database, fixture.runs, fixture.audit)
        },
        {
          now: () => fixedNow,
          printGuidance: (persistedReason) => {
            guidanceSawPersistedPause =
              fixture.runs.getRun(`run-${reason.toLowerCase()}`)?.pauseReason === persistedReason;
          }
        }
      ).execute({
        runId: `run-${reason.toLowerCase()}`,
        batchId: `batch-${reason.toLowerCase()}`,
        outcome
      });

      expect(result.reason).toBe(reason);
      expect(fixture.runs.getRun(`run-${reason.toLowerCase()}`)?.status).toBe("PAUSED");
      expect(fixture.runs.getBatch(`batch-${reason.toLowerCase()}`)?.status).toBe("PAUSED");
      expect(fixture.audit.listCheckpoints(`run-${reason.toLowerCase()}`)[0]?.reason).toBe(reason);
      expect(guidanceSawPersistedPause).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("reconfirma a conta restaurada sem tocar em senha", async () => {
    const detection = {
      status: "AUTHENTICATED" as const,
      outcome: "AUTHENTICATED" as const,
      state: "AUTHENTICATED" as const,
      account: { handle: "restored-owner", xUserId: null }
    };
    const session = await new LoginSession({
      login: async () => ({ detection, profileDirectory: "/tmp/synthetic-profile" })
    }).execute();
    expect(session.account).toEqual({ handle: "restored-owner", xUserId: null });
    expect("password" in session).toBe(false);
  });

  it("vincula a identidade restaurada somente após confirmação explícita", async () => {
    const fixture = await createDatabaseFixture();
    try {
      const result = new ConfirmAccount(fixture.catalog, { now: () => fixedNow }).execute({
        account: { handle: "restored-owner", xUserId: null },
        confirmed: true
      });
      expect(result.confirmed).toBe(true);
      expect(fixture.catalog.getManagedAccount()?.confirmedHandle).toBe("restored-owner");
    } finally {
      await fixture.cleanup();
    }
  });
});
