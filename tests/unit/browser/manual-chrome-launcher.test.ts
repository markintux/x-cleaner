import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ManualChromeLauncher } from "../../../src/infrastructure/browser/manual-chrome-launcher.js";

describe("ManualChromeLauncher", () => {
  it("abre Chrome comum no macOS com o perfil dedicado e sem automação remota", async () => {
    const run = vi.fn(async () => undefined);
    const launcher = new ManualChromeLauncher({ platform: "darwin", run });

    await launcher.open("/synthetic/data/browser-profile", "https://x.com/i/flow/login");

    expect(run).toHaveBeenCalledWith(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      [
        `--user-data-dir=${path.resolve("/synthetic/data/browser-profile")}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-mode",
        "--new-window",
        "https://x.com/i/flow/login"
      ]
    );
    expect(run.mock.calls[0]?.[1].join(" ")).not.toMatch(/remote-debugging|enable-automation/iu);
  });

  it("tenta os executáveis Linux em ordem somente quando não existem", async () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const run = vi.fn().mockRejectedValueOnce(missing).mockResolvedValueOnce(undefined);
    const launcher = new ManualChromeLauncher({ platform: "linux", run });

    await launcher.open("/synthetic/profile", "https://x.com/i/flow/login");

    expect(run.mock.calls.map(([executable]) => executable)).toEqual([
      "google-chrome",
      "google-chrome-stable"
    ]);
  });

  it("não mascara uma falha real do Chrome", async () => {
    const run = vi.fn().mockRejectedValue(new Error("synthetic chrome failure"));
    const launcher = new ManualChromeLauncher({ platform: "darwin", run });

    await expect(launcher.open("/synthetic/profile", "https://x.com/i/flow/login")).rejects.toThrow(
      "synthetic chrome failure"
    );
    expect(run).toHaveBeenCalledOnce();
  });
});
