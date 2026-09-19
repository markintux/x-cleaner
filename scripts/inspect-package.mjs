import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { classifyPath } from "./check-private-artifacts.mjs";

const REQUIRED_FILES = new Set(["package.json", "README.md", "SECURITY.md", "LICENSE"]);
const FORBIDDEN_PREFIXES = [
  "src/",
  "tests/",
  "docs/",
  "scripts/",
  ".github/",
  ".phases/",
  ".harness/"
];

export async function inspectPackage(rootDirectory = process.cwd()) {
  const root = path.resolve(rootDirectory);
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const entries = await packFiles(root);
  const files = entries.flatMap((entry) => entry.files?.map((file) => normalize(file.path)) ?? []);
  const errors = [];

  if (packageJson.private !== true) errors.push("package.json precisa manter private=true");
  for (const required of REQUIRED_FILES) {
    if (!files.includes(required)) errors.push(`arquivo obrigatório ausente: ${required}`);
  }

  const bin = packageJson.bin;
  const binPath = typeof bin === "string" ? bin : bin?.["x-cleaner"];
  if (typeof binPath !== "string") {
    errors.push("bin x-cleaner ausente");
  } else if (!files.includes(normalize(binPath))) {
    errors.push(`bin não empacotado: ${binPath}`);
  }

  for (const file of files) {
    if (FORBIDDEN_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      errors.push(`arquivo fora do pacote de distribuição: ${file}`);
    }
    if (file.startsWith("dist/") && !/\.d?\.ts$|\.js$/u.test(file)) {
      errors.push(`artefato compilado não distribuível: ${file}`);
    }
    const privateArtifact = classifyPath(file, root);
    if (privateArtifact !== null) {
      errors.push(`artefato privado no pacote: ${file} (${privateArtifact})`);
    }
  }

  if (!files.some((file) => file.startsWith("dist/") && file.endsWith(".js"))) {
    errors.push("nenhum JavaScript compilado no pacote");
  }

  if (errors.length > 0) {
    throw new Error(
      ["PACKAGE INSPECTION FALHOU", ...errors.map((error) => `- ${error}`)].join("\n")
    );
  }
  return { root, files };
}

async function packFiles(root) {
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmExecutable, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    throw new Error(
      `npm pack falhou: ${(result.stderr || result.stdout).trim() || "erro desconhecido"}`
    );
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new Error("npm pack não retornou JSON válido");
  }
}

function normalize(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export async function main(arguments_ = process.argv.slice(2)) {
  const index = arguments_.indexOf("--root");
  const root =
    index >= 0 && arguments_[index + 1] !== undefined ? arguments_[index + 1] : process.cwd();
  try {
    const result = await inspectPackage(root);
    process.stdout.write(`PACKAGE INSPECTION PASSOU: ${result.files.length} arquivos\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && isMainModule(entryPoint)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

function isMainModule(entryPoint) {
  try {
    return realpathSync(entryPoint) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
