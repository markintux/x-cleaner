import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip-js/zip-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createProgram } from "../../../src/cli/create-program.js";
import type { CliOutput } from "../../../src/cli/dependencies.js";
import { createCompositionRoot } from "../../../src/composition-root.js";

const syntheticFixture = path.resolve("tests/fixtures/x-archive/synthetic");
const emptyFixture = path.resolve("tests/fixtures/x-archive/empty");

describe("import, status e dry-run", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    );
  });

  it("importa diretório e ZIP, mostra contagens em português e não lê previews no status", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-phase-6-cli-"));
    temporaryDirectories.push(workspace);
    const dataDirectory = path.join(workspace, "data");
    const directory = path.join(workspace, "archive-directory");
    const zipPath = path.join(workspace, "archive.zip");
    await cp(syntheticFixture, directory, { recursive: true });
    await createZip(directory, zipPath);

    const directoryOutput = await runCli(["import", directory, "--data-dir", dataDirectory]);
    const zipOutput = await runCli(["import", zipPath, "--data-dir", dataDirectory]);
    const statusOutput = await runCli(["status", "--data-dir", dataDirectory]);

    expect(directoryOutput.join("\n")).toContain("Adaptador: x-archive-ytd-v1");
    expect(directoryOutput.join("\n")).toContain("Inseridos: 4");
    expect(directoryOutput.join("\n")).toContain("POST: 1");
    expect(directoryOutput.join("\n")).toContain("Total: 4");
    expect(zipOutput.join("\n")).toContain("Reutilizados: 4");
    expect(statusOutput.join("\n")).toContain("Importações: 2");
    expect(statusOutput.join("\n")).toContain("Catálogo: 4 interações");
    expect(statusOutput.join("\n")).toContain("LIKE: 1");
    expect(statusOutput.join("\n")).not.toContain("synthetic original post");
    const audit = await readFile(path.join(dataDirectory, "logs/audit.ndjson"), "utf8");
    const events = audit
      .trimEnd()
      .split("\n")
      .map((line) => (JSON.parse(line) as { event: string }).event);
    expect(events).toEqual([
      "archive.import.started",
      "archive.import.completed",
      "archive.import.started",
      "archive.import.completed"
    ]);
  });

  it("exibe SIMULAÇÃO, salva o plano e nunca chama um cleaner engine", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-phase-6-dry-run-"));
    temporaryDirectories.push(workspace);
    const dataDirectory = path.join(workspace, "data");
    const source = path.join(workspace, "archive");
    await cp(syntheticFixture, source, { recursive: true });
    await runCli(["import", source, "--data-dir", dataDirectory]);

    const cleanerEngine = vi.fn(() => {
      throw new Error("DRY_RUN_MUST_NOT_CALL_CLEANER_ENGINE");
    });
    const lines: string[] = [];
    const output: CliOutput = { writeLine: (line) => lines.push(line) };
    const root = createCompositionRoot({ output });
    const program = createProgram({ ...root.dependencies, cleanerEngine });
    program.exitOverride();
    await program.parseAsync(
      ["dry-run", "--data-dir", dataDirectory, "--type", "POST", "--type", "REPLY"],
      { from: "user" }
    );

    expect(lines.join("\n")).toContain("SIMULAÇÃO");
    expect(lines.join("\n")).toContain("Nenhuma alteração será feita no X");
    expect(lines.join("\n")).toContain("POST: 1");
    expect(lines.join("\n")).toContain("REPLY: 1");
    expect(lines.join("\n")).toContain("Total selecionado: 2");
    expect(lines.join("\n")).toMatch(/Plano imutável: \S+/u);
    expect(cleanerEngine).not.toHaveBeenCalled();
    const audit = await readFile(path.join(dataDirectory, "logs/audit.ndjson"), "utf8");
    const events = audit
      .trimEnd()
      .split("\n")
      .map((line) => (JSON.parse(line) as { event: string }).event);
    expect(events).toEqual([
      "archive.import.started",
      "archive.import.completed",
      "plan.created",
      "plan.previewed"
    ]);
  });

  it("trata arquivo vazio como sucesso e recusa dry-run sem itens", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-phase-6-empty-"));
    temporaryDirectories.push(workspace);
    const dataDirectory = path.join(workspace, "data");
    const source = path.join(workspace, "empty");
    await cp(emptyFixture, source, { recursive: true });

    const importOutput = await runCli(["import", source, "--data-dir", dataDirectory]);
    expect(importOutput.join("\n")).toContain("Nenhuma interação compatível");

    const lines: string[] = [];
    const root = createCompositionRoot({ output: { writeLine: (line) => lines.push(line) } });
    const program = createProgram(root.dependencies);
    program.exitOverride();
    await expect(
      program.parseAsync(["dry-run", "--data-dir", dataDirectory, "--type", "POST"], {
        from: "user"
      })
    ).rejects.toThrow("SELECTION_EMPTY");
    expect(lines.join("\n").toLowerCase()).toContain("nenhuma interação corresponde");
  });

  it("registra falha de importação sem serializar o caminho absoluto", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-phase-6-import-failed-"));
    temporaryDirectories.push(workspace);
    const dataDirectory = path.join(workspace, "data");
    const invalidArchive = path.join(workspace, "not-an-archive.zip");
    await writeFile(invalidArchive, "synthetic invalid archive", "utf8");
    const lines: string[] = [];
    const root = createCompositionRoot({ output: { writeLine: (line) => lines.push(line) } });
    const program = createProgram(root.dependencies);
    program.exitOverride();

    await expect(
      program.parseAsync(["import", invalidArchive, "--data-dir", dataDirectory], {
        from: "user"
      })
    ).rejects.toThrow();

    const audit = await readFile(path.join(dataDirectory, "logs/audit.ndjson"), "utf8");
    expect(audit).toContain('"event":"archive.import.started"');
    expect(audit).toContain('"event":"archive.import.failed"');
    expect(audit).not.toContain(invalidArchive);
    expect(lines.join("\n")).toContain("Importação não concluída");
  });
});

async function runCli(arguments_: readonly string[]): Promise<readonly string[]> {
  const lines: string[] = [];
  const output: CliOutput = { writeLine: (line) => lines.push(line) };
  const root = createCompositionRoot({ output });
  const program = createProgram(root.dependencies);
  program.exitOverride();
  await program.parseAsync([...arguments_], { from: "user" });
  return lines;
}

async function createZip(sourceDirectory: string, target: string): Promise<void> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const relative of ["data/account.js", "data/likes.js", "data/records.js"]) {
    await writer.add(
      relative,
      new Uint8ArrayReader(await readFile(path.join(sourceDirectory, relative)))
    );
  }
  await writeFile(target, await writer.close());
}
