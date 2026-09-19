import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip-js/zip-js";
import { afterEach, describe, expect, it } from "vitest";

import { createCompositionRoot } from "../../src/composition-root.js";
import type { Prompt } from "../../src/application/ports/prompt.js";
import type { LoginSessionResult } from "../../src/application/session/login-session.js";
import { xUserId } from "../../src/domain/interaction.js";
import { FakeCleanerEngine } from "../support/fake-cleaner-engine.js";
import { FakeClock } from "../support/fake-clock.js";
import { FakePrompt } from "../support/fake-prompt.js";

const syntheticFixture = path.resolve("tests/fixtures/x-archive/synthetic");

describe("regressões de segurança do workflow", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    );
  });

  it("falha sem plano revisado antes de chamar a engine e não expõe domínios fora do escopo", async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-e2e-missing-"));
    temporaryDirectories.push(dataDirectory);
    const engine = new FakeCleanerEngine();
    const root = createCompositionRoot({
      output: { writeLine: () => undefined },
      errorOutput: { writeLine: () => undefined },
      prompt: new WorkflowPrompt(["APAGAR"]),
      clock: new FakeClock(),
      createLoginSession: () => ({ execute: async () => authenticatedResult(dataDirectory) }),
      createBrowserEngine: () => engine
    });
    const program = root.createProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(["run", "missing-plan", "--data-dir", dataDirectory], { from: "user" })
    ).rejects.toMatchObject({ message: "REVIEWED_PLAN_REQUIRED" });
    expect(engine.calls).toHaveLength(0);

    const help = root.createProgram().helpInformation();
    expect(help).toContain("Comandos:");
    expect(help).not.toMatch(
      /mensagens|bookmarks?|followers?|following|direct messages|oauth|api/iu
    );
    expect(help).toContain("import");
    expect(help).toContain("dry-run");
    expect(help).toContain("session");
    expect(help).toContain("run");
    expect(help).toContain("resume");
    expect(help).toContain("report");
  });

  it("mantém diretórios isolados e não aciona browser em leitura", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-e2e-isolation-"));
    temporaryDirectories.push(workspace);
    const firstDataDirectory = path.join(workspace, "first");
    const secondDataDirectory = path.join(workspace, "second");
    const firstArchive = path.join(workspace, "first-archive");
    await cp(syntheticFixture, firstArchive, { recursive: true });
    let contextFactoryCalls = 0;
    const root = createCompositionRoot({
      output: { writeLine: () => undefined },
      createBrowserContextFactory: () => {
        contextFactoryCalls += 1;
        throw new Error("BROWSER_MUST_BE_LAZY");
      }
    });

    await run(root, ["import", firstArchive, "--data-dir", firstDataDirectory]);
    const firstStatus = await run(root, ["status", "--data-dir", firstDataDirectory]);
    const secondStatus = await run(root, ["status", "--data-dir", secondDataDirectory]);
    expect(firstStatus).toContain("Catálogo: 4 interações");
    expect(secondStatus).toContain("Catálogo: 0 interações");
    expect(contextFactoryCalls).toBe(0);
    await expect(readFile(path.join(firstDataDirectory, "state.sqlite"))).resolves.toBeInstanceOf(
      Buffer
    );
    await expect(readFile(path.join(secondDataDirectory, "state.sqlite"))).resolves.toBeInstanceOf(
      Buffer
    );
  });

  it("não expande o plano quando uma importação posterior adiciona interação", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-e2e-immutable-"));
    temporaryDirectories.push(workspace);
    const dataDirectory = path.join(workspace, "data");
    const firstArchive = path.join(workspace, "first-archive");
    const laterArchive = path.join(workspace, "later-archive");
    const firstZip = path.join(workspace, "first.zip");
    const laterZip = path.join(workspace, "later.zip");
    await cp(syntheticFixture, firstArchive, { recursive: true });
    await cp(syntheticFixture, laterArchive, { recursive: true });
    await writeFile(
      path.join(laterArchive, "data", "more.js"),
      'window.YTD.tweets.part1 = [{"tweet":{"id_str":"90071992547409931239","full_text":"synthetic later post"}}];\n',
      "utf8"
    );
    await createZip(firstArchive, firstZip);
    await createZip(laterArchive, laterZip);

    const engine = new FakeCleanerEngine();
    const prompt = new WorkflowPrompt(["APAGAR"]);
    const root = createCompositionRoot({
      output: { writeLine: () => undefined },
      prompt,
      clock: new FakeClock(),
      createLoginSession: () => ({ execute: async () => authenticatedResult(dataDirectory) }),
      createBrowserEngine: () => engine
    });
    await run(root, ["import", firstZip, "--data-dir", dataDirectory]);
    await run(root, ["session", "login", "--data-dir", dataDirectory]);
    const dryRun = await run(root, ["dry-run", "--data-dir", dataDirectory, "--type", "POST"]);
    const planId = matchOne(dryRun, /Plano imutável: (\S+)/u);
    await run(root, ["import", laterZip, "--data-dir", dataDirectory]);
    const runOutput = await run(root, ["run", planId, "--data-dir", dataDirectory]);

    expect(runOutput).toContain("concluído");
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]?.interaction.xInteractionId).toBe("90071992547409931235");
  });

  it("não possui chamadas de rede ou crawling no caminho fake do workflow", async () => {
    const sourceFiles = [
      "src/application/import/import-archive.ts",
      "src/cli/commands/status.ts",
      "src/cli/commands/dry-run.ts",
      "src/application/ports/cleaner-engine.ts"
    ];
    const source = await Promise.all(sourceFiles.map((file) => readFile(file, "utf8")));
    expect(source.join("\n")).not.toMatch(/fetch\(|axios|timeline|scrollIntoView|page\.request/iu);
    expect(source.join("\n")).not.toMatch(
      /direct messages|bookmarks?|followers?|following|oauth/iu
    );
  });
});

class WorkflowPrompt extends FakePrompt implements Prompt {
  async confirm(): Promise<boolean> {
    return true;
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
  arguments_: readonly string[]
): Promise<string> {
  const lines: string[] = [];
  const output = root.dependencies.output;
  const originalWriteLine = output.writeLine;
  const captured = (line: string): void => {
    lines.push(line);
    originalWriteLine.call(output, line);
  };
  (root.dependencies.output as { writeLine: (line: string) => void }).writeLine = captured;
  try {
    const program = root.createProgram();
    program.exitOverride();
    await program.parseAsync([...arguments_], { from: "user" });
    return lines.join("\n");
  } finally {
    (root.dependencies.output as { writeLine: (line: string) => void }).writeLine =
      originalWriteLine;
  }
}

function matchOne(value: string, pattern: RegExp): string {
  const match = pattern.exec(value);
  if (match?.[1] === undefined) throw new Error(`Test pattern did not match: ${pattern}`);
  return match[1];
}

async function createZip(sourceDirectory: string, target: string): Promise<void> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const relative of ["data/account.js", "data/likes.js", "data/records.js", "data/more.js"]) {
    try {
      await writer.add(
        relative,
        new Uint8ArrayReader(await readFile(path.join(sourceDirectory, relative)))
      );
    } catch {
      if (relative !== "data/more.js")
        throw new Error(`Missing synthetic archive entry: ${relative}`);
    }
  }
  await writeFile(target, await writer.close());
}
