import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(".");
const inspector = path.join(projectRoot, "scripts/inspect-package.mjs");
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";

describe("conteúdo e execução do pacote", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    );
  });

  it("inspeciona um pacote seguro e não inclui fontes, mapas ou testes", async () => {
    const build = await runCommand(npmExecutable, ["run", "build"], projectRoot);
    expect(build.code, build.stderr || build.stdout).toBe(0);
    const inspection = await runNode([inspector], projectRoot);
    expect(inspection.code, inspection.stderr || inspection.stdout).toBe(0);
    expect(inspection.stdout).toContain("PACKAGE INSPECTION PASSOU");

    const dryRun = await runCommand(
      npmExecutable,
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      projectRoot
    );
    expect(dryRun.code, dryRun.stderr || dryRun.stdout).toBe(0);
    const entries = JSON.parse(dryRun.stdout) as Array<{ files?: Array<{ path: string }> }>;
    const files = entries.flatMap(
      (entry) => entry.files?.map((file) => file.path.replaceAll("\\", "/")) ?? []
    );

    expect(files).toContain("package.json");
    expect(files).toContain("README.md");
    expect(files).toContain("SECURITY.md");
    expect(files).toContain("LICENSE");
    expect(files).toContain("dist/cli.js");
    expect(
      files.every(
        (file) =>
          file.startsWith("dist/") ||
          ["package.json", "README.md", "SECURITY.md", "LICENSE"].includes(file)
      )
    ).toBe(true);
    expect(files.some((file) => file.endsWith(".map"))).toBe(false);
    expect(files.some((file) => file.startsWith("src/") || file.startsWith("tests/"))).toBe(false);
  }, 30_000);

  it("executa a ajuda do CLI instalado de um tarball em um caminho com espaços", async () => {
    const build = await runCommand(npmExecutable, ["run", "build"], projectRoot);
    expect(build.code, build.stderr || build.stdout).toBe(0);
    const workspace = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-package-"));
    temporaryDirectories.push(workspace);
    const staging = path.join(workspace, "staging path");
    const consumer = path.join(workspace, "consumer path", "nested");
    await writeFile(path.join(workspace, "placeholder.txt"), "synthetic\n", "utf8");
    await mkdir(staging, { recursive: true });
    await mkdir(consumer, { recursive: true });
    await writeFile(path.join(consumer, "package.json"), JSON.stringify({ private: true }), "utf8");

    const packed = await runCommand(
      npmExecutable,
      ["pack", "--ignore-scripts", "--pack-destination", staging, "--json"],
      projectRoot
    );
    expect(packed.code, packed.stderr || packed.stdout).toBe(0);
    const packedEntries = JSON.parse(packed.stdout) as Array<{ filename?: string }>;
    const filename = packedEntries[0]?.filename;
    expect(filename).toBeTruthy();
    const tarball = path.join(staging, filename!);

    const installed = await runCommand(
      npmExecutable,
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", tarball],
      consumer
    );
    expect(installed.code, installed.stderr || installed.stdout).toBe(0);

    const help = await runCommand(
      process.execPath,
      [path.join(consumer, "node_modules", "x-cleaner", "dist", "cli.js"), "--help"],
      consumer
    );
    expect(help.code, help.stderr || help.stdout).toBe(0);
    expect(help.stdout).toContain("Uso:");
    expect(help.stdout).toContain("Comandos:");
    for (const command of ["import", "status", "dry-run", "session", "run", "resume", "report"]) {
      expect(help.stdout).toContain(command);
    }
    expect(help.stdout).not.toContain("Error [");
  }, 60_000);
});

async function runNode(arguments_: readonly string[], cwd: string): Promise<ProcessResult> {
  return runCommand(process.execPath, arguments_, cwd);
}

async function runCommand(
  command: string,
  arguments_: readonly string[],
  cwd: string
): Promise<ProcessResult> {
  try {
    const result = await execFileAsync(command, [...arguments_], {
      cwd,
      maxBuffer: 4_000_000,
      shell: process.platform === "win32"
    });
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
