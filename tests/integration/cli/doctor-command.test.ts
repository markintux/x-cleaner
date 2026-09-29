import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDoctorCommand } from "../../../src/cli/commands/doctor.js";
import { createProgram } from "../../../src/cli/create-program.js";
import { createCompositionRoot } from "../../../src/composition-root.js";
import { BrowserPrerequisiteProbe } from "../../../src/infrastructure/browser/browser-prerequisites.js";

describe("doctor", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    );
  });

  it("confere os pré-requisitos sem criar dados nem abrir navegador", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-doctor-"));
    temporaryDirectories.push(workspace);
    const dataDirectory = path.join(workspace, "dados");
    const lines: string[] = [];
    const root = createCompositionRoot({
      output: { writeLine: (line) => lines.push(line) },
      browserPrerequisites: new BrowserPrerequisiteProbe({
        platform: "darwin",
        environment: {},
        playwrightExecutable: "/synthetic/chromium",
        fileExists: async (filename) =>
          filename === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      })
    });
    const result = await createDoctorCommand(
      root.dependencies,
      "24.21.0"
    )({
      dataDir: dataDirectory
    });

    expect(result).toEqual({
      ready: true,
      nodeReady: true,
      chromeReady: true,
      playwrightReady: false
    });
    expect(lines.join("\n")).toContain("Pré-requisitos encontrados");
    expect(lines.join("\n")).toContain(dataDirectory);
    await expect(access(dataDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("não considera o Chromium do Playwright um substituto do Chrome para login", async () => {
    const lines: string[] = [];
    const root = createCompositionRoot({
      output: { writeLine: (line) => lines.push(line) },
      browserPrerequisites: new BrowserPrerequisiteProbe({
        platform: "linux",
        environment: { PATH: "/synthetic/bin" },
        playwrightExecutable: "/synthetic/chromium",
        fileExists: async (filename) => filename === "/synthetic/chromium"
      })
    });
    const result = await createDoctorCommand(root.dependencies, "22.21.1")({});

    expect(result).toEqual({
      ready: false,
      nodeReady: false,
      chromeReady: false,
      playwrightReady: true
    });
    expect(lines.join("\n")).toContain("instale a versão 24 LTS");
    expect(lines.join("\n")).toContain("Google Chrome: não encontrado");
  });

  it("encontra Chrome no Windows e expõe o comando na ajuda", async () => {
    const root = createCompositionRoot({
      output: { writeLine: () => undefined },
      browserPrerequisites: new BrowserPrerequisiteProbe({
        platform: "win32",
        environment: { PROGRAMFILES: "C:\\Program Files" },
        playwrightExecutable: "C:\\synthetic\\chrome.exe",
        fileExists: async (filename) =>
          filename === "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      })
    });
    const result = await createDoctorCommand(root.dependencies, "24.21.0")({});

    expect(result.chromeReady).toBe(true);
    expect(createProgram(root.dependencies).helpInformation()).toContain("doctor");
  });
});
