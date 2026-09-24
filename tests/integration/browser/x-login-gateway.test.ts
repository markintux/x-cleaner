import { describe, expect, it, vi } from "vitest";

import { XLoginGateway } from "../../../src/infrastructure/browser/x-login-gateway.js";

describe("XLoginGateway", () => {
  it("mantém o navegador aberto durante estados transitórios e fecha após autenticar", async () => {
    const goto = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const open = vi.fn(async () => undefined);
    const detect = vi
      .fn()
      .mockResolvedValueOnce({
        status: "UNAUTHENTICATED",
        outcome: "UNAUTHENTICATED",
        state: "UNAUTHENTICATED",
        reason: "LOGIN_REQUIRED"
      })
      .mockResolvedValueOnce({
        status: "UNKNOWN_STATE",
        outcome: "UNKNOWN_STATE",
        state: "UNKNOWN_STATE",
        reason: "NO_SUPPORTED_ACCOUNT_EVIDENCE"
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
      manualBrowserLauncher: { open },
      pollIntervalMs: 0,
      sleep: async () => undefined,
      accountPageFactory: () => ({ detect })
    });

    const result = await gateway.login();

    expect(open).toHaveBeenCalledWith("/synthetic/browser-profile", "https://x.com/i/flow/login");
    expect(goto).toHaveBeenCalledWith("https://x.com/home", {
      waitUntil: "domcontentloaded"
    });
    expect(result.detection.status).toBe("AUTHENTICATED");
    expect(result.profileDirectory).toBe("/synthetic/browser-profile");
    expect(close).toHaveBeenCalledOnce();
    expect(detect).toHaveBeenCalledTimes(3);
  });

  it("encerra imediatamente diante de desafio de segurança", async () => {
    const close = vi.fn(async () => undefined);
    const detect = vi.fn(async () => ({
      status: "SECURITY_CHALLENGE" as const,
      outcome: "SECURITY_CHALLENGE" as const,
      state: "SECURITY_CHALLENGE" as const,
      reason: "SECURITY_CHALLENGE" as const
    }));
    const gateway = new XLoginGateway({
      contextFactory: {
        profileDirectory: "/synthetic/browser-profile",
        launch: async () => ({
          newPage: async () => ({
            goto: async () => undefined,
            url: () => "https://x.com/account/access",
            locator: () => {
              throw new Error("UNUSED_LOCATOR");
            }
          }),
          close
        })
      },
      timeoutMs: 60_000,
      sleep: async () => {
        throw new Error("MUST_NOT_WAIT");
      },
      accountPageFactory: () => ({ detect })
    });

    const result = await gateway.login();

    expect(result.detection.status).toBe("SECURITY_CHALLENGE");
    expect(detect).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
