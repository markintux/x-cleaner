import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip-js/zip-js";
import { afterEach, describe, expect, it } from "vitest";

import { createCompositionRoot } from "../../src/composition-root.js";
import type { CliSignalAdapter } from "../../src/cli/dependencies.js";
import type { Prompt } from "../../src/application/ports/prompt.js";
import type { LoginSessionResult } from "../../src/application/session/login-session.js";
import { xUserId } from "../../src/domain/interaction.js";
import { FakeCleanerEngine } from "../support/fake-cleaner-engine.js";
import { FakeClock } from "../support/fake-clock.js";
import { FakeDelay } from "../support/fake-delay.js";
import { FakePrompt } from "../support/fake-prompt.js";

const syntheticFixture = path.resolve("tests/fixtures/x-archive/synthetic");

describe("fluxo e2e sintético do CLI", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    );
  });

  it("importa, revisa, cancela, interrompe, retoma, conclui e gera relatório", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-e2e-workflow-"));
    temporaryDirectories.push(workspace);
    const dataDirectory = path.join(workspace, "data");
    const archiveDirectory = path.join(workspace, "archive");
    const archiveZip = path.join(workspace, "archive.zip");
    await cp(syntheticFixture, archiveDirectory, { recursive: true });
    await createZip(archiveDirectory, archiveZip);

    const lines: string[] = [];
    const prompt = new WorkflowPrompt(["", "APAGAR", "APAGAR"]);
    const engine = new FakeCleanerEngine();
    const clock = new FakeClock("2026-09-18T12:00:00.000Z");
    const delay = new FakeDelay();
    let activeSignal: InterruptibleSignal | undefined;
    let interruptNextBatch = true;
    const root = createCompositionRoot({
      output: { writeLine: (line) => lines.push(line) },
      errorOutput: { writeLine: (line) => lines.push(line) },
      prompt,
      clock,
      delay,
      createLoginSession: () => ({ execute: async () => authenticatedResult(dataDirectory) }),
      createBrowserEngine: () => engine,
      createSignalAdapter: (runId) => {
        activeSignal = new InterruptibleSignal(runId);
        return activeSignal;
      }
    });

    const archiveBeforeImport = await readFile(archiveZip);
    const importResult = await run(
      root,
      ["import", archiveZip, "--data-dir", dataDirectory],
      lines
    );
    expect(importResult).toContain("Total: 4");
    expect(importResult).toContain("Adaptador: ytd-synthetic-v1");
    expect(await readFile(archiveZip)).toEqual(archiveBeforeImport);

    const status = await run(root, ["status", "--data-dir", dataDirectory], lines);
    expect(status).toContain("Catálogo: 4 interações");
    expect(status).toContain("POST: 1");

    const dryRun = await run(
      root,
      ["dry-run", "--data-dir", dataDirectory, "--type", "POST", "--type", "REPLY"],
      lines
    );
    expect(dryRun).toContain("SIMULAÇÃO");
    expect(dryRun).toContain("Total selecionado: 2");
    expect(engine.calls).toHaveLength(0);
    const planId = matchOne(dryRun, /Plano imutável: (\S+)/u);

    await run(root, ["session", "login", "--data-dir", dataDirectory], lines);
    expect(lines.join("\n")).toContain("Conta @synthetic_owner confirmada");

    const canceled = await run(
      root,
      ["run", planId, "--data-dir", dataDirectory, "--limit", "1"],
      lines
    );
    expect(canceled).toContain("cancelada");
    expect(engine.calls).toHaveLength(0);

    const originalExecute = engine.execute.bind(engine);
    engine.execute = async (input) => {
      const result = await originalExecute(input);
      if (interruptNextBatch) {
        interruptNextBatch = false;
        activeSignal?.request();
      }
      return result;
    };
    const interrupted = await run(
      root,
      ["run", planId, "--data-dir", dataDirectory, "--limit", "1"],
      lines
    );
    expect(interrupted).toContain("pausada");
    expect(interrupted).toContain("x-cleaner resume");
    expect(engine.calls).toHaveLength(1);

    const resumed = await run(
      root,
      ["resume", matchOne(interrupted, /Execução: (\S+)/u), "--data-dir", dataDirectory],
      lines
    );
    expect(resumed).toContain("concluído");
    expect(engine.calls).toHaveLength(2);

    const report = await run(
      root,
      ["report", matchOne(interrupted, /Execução: (\S+)/u), "--data-dir", dataDirectory],
      lines
    );
    expect(report).toContain("Estado: COMPLETED");
    const reportPath = matchOne(report, /Caminho local relativo: (\S+)/u);
    expect(reportPath).toMatch(/^reports\//u);
    await expect(readFile(path.join(dataDirectory, reportPath), "utf8")).resolves.toContain(
      '"state": "COMPLETED"'
    );
  });
});

class WorkflowPrompt extends FakePrompt implements Prompt {
  async confirm(): Promise<boolean> {
    return true;
  }
}

class InterruptibleSignal implements CliSignalAdapter {
  #requested = false;

  constructor(readonly runId: string) {}

  install(): () => void {
    return () => undefined;
  }

  uninstall(): void {
    return undefined;
  }

  setCheckpointFlusher(): void {
    return undefined;
  }

  isStopRequested(): boolean {
    return this.#requested;
  }

  request(): void {
    this.#requested = true;
  }
}

function authenticatedResult(dataDirectory: string): LoginSessionResult {
  const account = { handle: "synthetic_owner", xUserId: xUserId("90071992547409931234") };
  return {
    detection: {
      status: "AUTHENTICATED",
      outcome: "AUTHENTICATED",
      state: "AUTHENTICATED",
      account
    },
    account,
    profileDirectory: path.join(dataDirectory, "browser-profile")
  };
}

async function run(
  root: ReturnType<typeof createCompositionRoot>,
  arguments_: readonly string[],
  lines: string[]
): Promise<string> {
  const start = lines.length;
  const program = root.createProgram();
  program.exitOverride();
  await program.parseAsync([...arguments_], { from: "user" });
  return lines.slice(start).join("\n");
}

function matchOne(value: string, pattern: RegExp): string {
  const match = pattern.exec(value);
  if (match?.[1] === undefined) throw new Error(`Test pattern did not match: ${pattern}`);
  return match[1];
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
