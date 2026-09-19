import { describe, expect, it, vi } from "vitest";

import { XLoginGateway } from "../../../src/infrastructure/browser/x-login-gateway.js";

describe("XLoginGateway", () => {
  it("mantém URL e evidência do X na infraestrutura e fecha o contexto", async () => {
    const goto = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const detect = vi
      .fn()
      .mockResolvedValueOnce({
        status: "UNAUTHENTICATED",
        outcome: "UNAUTHENTICATED",
        state: "UNAUTHENTICATED",
        reason: "LOGIN_REQUIRED"
      })
      .mockResolvedValueOnce({
        status: "AUTHENTICATED",
        outcome: "AUTHENTICATED",
        state: "AUTHENTICATED",
        account: { handle: "synthetic-owner", xUserId: null }
      });
    const page = {
      goto,
      url: () => "https://x.com/home",
      locator: () => {
        throw new Error("UNUSED_LOCATOR");
      }
    };
    const gateway = new XLoginGateway({
      contextFactory: {
        profileDirectory: "/synthetic/browser-profile",
        launch: async () => ({ newPage: async () => page, close })
      },
      pollIntervalMs: 0,
      sleep: async () => undefined,
      accountPageFactory: () => ({ detect })
    });

    const result = await gateway.login();

    expect(goto).toHaveBeenCalledWith("https://x.com/i/flow/login", {
      waitUntil: "domcontentloaded"
    });
    expect(result.detection.status).toBe("AUTHENTICATED");
    expect(result.profileDirectory).toBe("/synthetic/browser-profile");
    expect(close).toHaveBeenCalledOnce();
  });
});
