import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createProgram } from "../../../src/cli/create-program.js";
import type { CliOutput } from "../../../src/cli/dependencies.js";
import { createCompositionRoot } from "../../../src/composition-root.js";

describe("x-cleaner status", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    );
  });

  it("relata em português o espaço local isolado sem efetuar chamadas de rede", async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-status-"));
    temporaryDirectories.push(dataDirectory);
    const lines: string[] = [];
    const output: CliOutput = { writeLine: (message) => lines.push(message) };
    const networkRequest = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = networkRequest;

    try {
      const root = createCompositionRoot({ output });
      const program = createProgram(root.dependencies);
      program.exitOverride();

      await program.parseAsync(["status", "--data-dir", dataDirectory], { from: "user" });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(lines).toContain(`Diretório local de dados: ${dataDirectory}`);
    expect(lines.join("\n")).toContain("Nenhuma conexão com o X foi realizada.");
    expect(lines).toContain("Executor: nenhum lock ativo neste diretório de dados.");
    expect(networkRequest).not.toHaveBeenCalled();
  });
});
