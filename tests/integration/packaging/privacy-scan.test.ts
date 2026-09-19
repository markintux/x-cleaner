import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(".");
const scanner = path.join(projectRoot, "scripts/check-private-artifacts.mjs");

describe("scanner de artefatos privados", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    );
  });

  it("aceita fixtures sintéticos documentados, inclusive no caminho de Archive", async () => {
    const root = await createFixtureWorkspace();
    const fixture = path.join(root, "tests/fixtures/x-archive/synthetic/data/records.js");
    const fixtureZip = path.join(root, "tests/fixtures/x-archive/synthetic/archive.zip");
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      path.join(root, "tests/fixtures/x-archive/README.md"),
      "These are documented synthetic fixtures only.\n",
      "utf8"
    );
    await writeFile(fixture, "window.synthetic = true;\n", "utf8");
    await writeFile(fixtureZip, "synthetic archive bytes\n", "utf8");
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "synthetic-fixtures",
        version: "1.0.0",
        private: true,
        files: ["tests/fixtures"]
      }),
      "utf8"
    );

    const result = await runNode([scanner, "--root", root]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("PRIVACY SCAN PASSOU");
  });

  it("detecta classes proibidas no conjunto de arquivos auditado", async () => {
    const prohibitedArtifacts = [
      ["archive", "real-archive.zip"],
      ["sqlite", "state.sqlite"],
      ["sqlite-journal", "state.sqlite-journal"],
      ["browser-profile", "browser-profile/Default/Preferences"],
      ["cookie", "cookies.json"],
      ["log", "logs/audit.ndjson"],
      ["report", "reports/run.json"],
      ["screenshot", "screenshots/capture.png"],
      ["trace", "traces/run.trace"],
      ["video", "videos/run.webm"],
      ["environment", ".env"],
      ["real-data-path", "x-cleaner-data/catalog.txt"]
    ] as const;

    for (const [label, relativePath] of prohibitedArtifacts) {
      const root = await createFixtureWorkspace();
      const artifact = path.join(root, relativePath);
      await mkdir(path.dirname(artifact), { recursive: true });
      await writeFile(artifact, `synthetic marker for ${label}\n`, "utf8");

      const result = await runNode([scanner, "--root", root]);

      expect(result.code, label).not.toBe(0);
      expect(result.stdout, label).toContain("PRIVACY SCAN FALHOU");
      expect(result.stdout, label).toContain(relativePath.replaceAll(path.sep, "/"));
    }
  });

  it("detecta um artefato ignorado pelo Git quando ele entra no pacote", async () => {
    const root = await createFixtureWorkspace();
    const privateArtifact = path.join(root, "dist/state.sqlite");
    await mkdir(path.dirname(privateArtifact), { recursive: true });
    await writeFile(privateArtifact, "not a real database\n", "utf8");
    await writeFile(path.join(root, ".gitignore"), "dist/\n", "utf8");
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "package-fixture", version: "1.0.0", private: true, files: ["dist"] }),
      "utf8"
    );
    await runCommand("git", ["init", "--quiet"], root);
    await runCommand("git", ["add", ".gitignore", "package.json"], root);

    const result = await runNode([scanner, "--root", root]);

    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain("[package]");
    expect(result.stdout).toContain("dist/state.sqlite");
  });

  async function createFixtureWorkspace(): Promise<string> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-privacy-"));
    temporaryDirectories.push(directory);
    return directory;
  }
});

async function runNode(arguments_: readonly string[], cwd = projectRoot): Promise<ProcessResult> {
  return runCommand(process.execPath, arguments_, cwd);
}

async function runCommand(
  command: string,
  arguments_: readonly string[],
  cwd: string
): Promise<ProcessResult> {
  try {
    const result = await execFileAsync(command, [...arguments_], { cwd, maxBuffer: 2_000_000 });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? ""
    };
  }
}

interface ProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}
