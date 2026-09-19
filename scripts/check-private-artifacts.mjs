import { access, readdir } from "node:fs/promises";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ARCHIVE_EXTENSIONS = new Set([".7z", ".gz", ".rar", ".tar", ".tgz", ".zip"]);
const SQLITE_EXTENSIONS = new Set([".db", ".db3", ".sqlite", ".sqlite3"]);
const MEDIA_EXTENSIONS = new Set([
  ".avi",
  ".jpeg",
  ".jpg",
  ".mkv",
  ".mov",
  ".mp4",
  ".png",
  ".webm",
  ".webp"
]);
const KNOWN_DATA_ROOTS = new Set([
  ".x-cleaner",
  "archive",
  "archives",
  "browser-profile",
  "cookies",
  "extracted-archive",
  "extracted-archives",
  "logs",
  "reports",
  "screenshots",
  "traces",
  "videos",
  "x-archive",
  "x-archives",
  "x-cleaner-data"
]);
const SYNTHETIC_FIXTURE_PREFIX = "tests/fixtures/";

export async function scanPrivateArtifacts(rootDirectory, options = {}) {
  const root = path.resolve(rootDirectory);
  const paths = options.paths ?? (await collectRepositoryPaths(root));
  const violations = [];

  for (const relativePath of paths) {
    const normalizedPath = normalizeRelativePath(relativePath);
    const violation = classifyPath(normalizedPath, root);
    if (violation !== null) {
      violations.push({ source: options.source ?? "repository", path: normalizedPath, violation });
    }
  }

  if (options.includePackage !== false) {
    const packageScan = await collectPackagePaths(root);
    if (packageScan.error !== null) {
      violations.push({ source: "package", path: "package.json", violation: packageScan.error });
    } else {
      for (const packagePath of packageScan.paths) {
        const normalizedPath = normalizeRelativePath(packagePath);
        const violation = classifyPath(normalizedPath, root);
        if (violation !== null) {
          violations.push({ source: "package", path: normalizedPath, violation });
        }
      }
    }
  }

  return { root, violations };
}

export function classifyPath(relativePath, rootDirectory = process.cwd()) {
  const normalizedPath = normalizeRelativePath(relativePath);
  const parts = normalizedPath.toLowerCase().split("/").filter(Boolean);
  const basename = parts.at(-1) ?? "";
  const extension = path.posix.extname(basename);
  const syntheticFixture = isDocumentedSyntheticFixture(normalizedPath, rootDirectory);

  if (syntheticFixture && extension === ".zip") return null;
  if (isEnvironmentFile(basename)) return "arquivo de ambiente";
  if (ARCHIVE_EXTENSIONS.has(extension)) return "arquivo de archive";
  if (SQLITE_EXTENSIONS.has(extension) || /(?:-journal|-wal|-shm)$/u.test(basename)) {
    return "banco SQLite ou arquivo auxiliar";
  }
  if (isCookiePath(parts)) return "cookie ou armazenamento de sessão";
  if (extension === ".log" || extension === ".ndjson") return "log";
  if (extension === ".trace" || parts.includes("traces")) return "trace";
  if (parts.includes("videos") || [".avi", ".mkv", ".mov", ".mp4", ".webm"].includes(extension)) {
    return "vídeo";
  }
  if (
    parts.includes("screenshots") ||
    (MEDIA_EXTENSIONS.has(extension) && /^screenshot/u.test(basename))
  ) {
    return "captura de tela";
  }
  if (isReportPath(parts, basename)) return "relatório";
  if (isBrowserProfilePath(parts)) return "perfil de navegador";
  if (!syntheticFixture && hasKnownDataRoot(parts)) return "caminho de dados reais";
  return null;
}

async function collectRepositoryPaths(root) {
  if (await isDirectory(path.join(root, ".git"))) {
    const git = runGit(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
    if (git.status === 0) {
      return git.stdout.split("\0").filter((value) => value.length > 0);
    }
  }
  return walk(root);
}

async function collectPackagePaths(root) {
  if (!(await isFile(path.join(root, "package.json")))) {
    return { paths: [], error: null };
  }

  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmExecutable, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    return {
      paths: [],
      error: `npm pack falhou: ${(result.stderr || result.stdout).trim() || "erro desconhecido"}`
    };
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return {
      paths: entries.flatMap((entry) => entry.files?.map((file) => file.path) ?? []),
      error: null
    };
  } catch {
    return { paths: [], error: "npm pack não retornou JSON válido" };
  }
}

async function walk(root) {
  const result = [];
  const visit = async (directory, relativeDirectory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const relativePath =
        relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        result.push(relativePath);
      }
    }
  };
  await visit(root, "");
  return result;
}

function runGit(root, arguments_) {
  return spawnSync("git", ["-C", root, ...arguments_], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
}

function isEnvironmentFile(basename) {
  return (
    /^\.env(?:\..*)?$/u.test(basename) && !/^\.env\.(?:example|sample|template)$/u.test(basename)
  );
}

function isCookiePath(parts) {
  return parts.some((part) => /^(?:\.cookies?|cookies?(?:\.json)?)$/u.test(part));
}

function isReportPath(parts, basename) {
  return (
    ["reports", "x-cleaner-data", ".x-cleaner"].includes(parts[0] ?? "") ||
    /^(?:report|.+-report)\.(?:json|ndjson)$/u.test(basename)
  );
}

function isBrowserProfilePath(parts) {
  return parts.some((part) =>
    ["browser-profile", "playwright-profile", "user-data-dir"].includes(part)
  );
}

function hasKnownDataRoot(parts) {
  return parts.some(
    (part, index) =>
      KNOWN_DATA_ROOTS.has(part) &&
      (index === 0 || part === "x-cleaner-data" || part === ".x-cleaner")
  );
}

function isDocumentedSyntheticFixture(relativePath, rootDirectory) {
  if (!relativePath.startsWith(SYNTHETIC_FIXTURE_PREFIX)) return false;
  const parts = relativePath.split("/");
  const fixtureRoot = parts.slice(0, 3).join("/");
  if (fixtureRoot !== "tests/fixtures/x-archive") return false;
  return (
    Boolean(rootDirectory) &&
    hasSyntheticDocumentation(path.join(rootDirectory, fixtureRoot, "README.md"))
  );
}

function hasSyntheticDocumentation(readmePath) {
  try {
    const content = readFileSync(readmePath, "utf8");
    return /synthetic|sint[eé]tic/iu.test(content);
  } catch {
    return false;
  }
}

function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+/gu, "/");
}

async function isFile(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(directoryPath) {
  try {
    const entries = await readdir(directoryPath);
    void entries;
    return true;
  } catch {
    return false;
  }
}

export async function main(arguments_ = process.argv.slice(2)) {
  const root = parseRoot(arguments_);
  const result = await scanPrivateArtifacts(root);
  if (result.violations.length > 0) {
    process.stdout.write("PRIVACY SCAN FALHOU\n");
    for (const violation of result.violations) {
      process.stdout.write(`- [${violation.source}] ${violation.path}: ${violation.violation}\n`);
    }
    return 1;
  }
  process.stdout.write(`PRIVACY SCAN PASSOU: ${result.root}\n`);
  return 0;
}

function parseRoot(arguments_) {
  const index = arguments_.indexOf("--root");
  return index >= 0 && arguments_[index + 1] !== undefined
    ? path.resolve(arguments_[index + 1])
    : process.cwd();
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
