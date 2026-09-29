import { getCatalogStatus } from "../../application/catalog/get-catalog-status.js";
import type { CatalogStatusSnapshot } from "../../application/ports/catalog-repository.js";
import {
  openCliRepositories,
  type CliDependencies,
  type CliRepositories,
  resolveCliDataDirectory
} from "../dependencies.js";

export interface StatusCommandOptions {
  readonly dataDir?: string;
  readonly presentation?: "menu";
}

export function createStatusCommand(
  dependencies: CliDependencies
): (options: StatusCommandOptions) => Promise<void> {
  return async (options) => {
    const dataDirectory = resolveCliDataDirectory(dependencies, options.dataDir);
    const repositories = await openRepositories(dependencies, dataDirectory);
    try {
      const status = getCatalogStatus(repositories.catalog);
      if (options.presentation === "menu") {
        await writeMenuStatus(dependencies, repositories, status, dataDirectory);
        return;
      }
      dependencies.output.writeLine(
        dependencies.translator.translate("status.dataDirectory", { dataDirectory })
      );
      dependencies.output.writeLine(dependencies.translator.translate("status.localOnlyNotice"));
      if (status.account?.archiveHandle !== null && status.account?.archiveHandle !== undefined) {
        dependencies.output.writeLine(
          dependencies.translator.translate("status.account", {
            handle: status.account.archiveHandle
          })
        );
      } else {
        dependencies.output.writeLine(dependencies.translator.translate("status.accountMissing"));
      }
      dependencies.output.writeLine(
        dependencies.translator.translate("status.imports", { total: status.imports.total })
      );
      dependencies.output.writeLine(
        dependencies.translator.translate("status.importLifecycle", {
          completed: status.imports.byStatus.COMPLETED,
          processing: status.imports.byStatus.PROCESSING,
          failed: status.imports.byStatus.FAILED
        })
      );
      dependencies.output.writeLine(
        dependencies.translator.translate("status.catalog", {
          total: status.interactions.total
        })
      );
      for (const [type, count] of Object.entries(status.interactions.byType)) {
        dependencies.output.writeLine(
          dependencies.translator.translate("status.typeCount", { type, count })
        );
      }
      if (status.interactions.total === 0) {
        dependencies.output.writeLine(dependencies.translator.translate("status.emptyCatalog"));
      }
      await writeExecutorLockStatus(dependencies, repositories);
    } finally {
      repositories.close?.();
    }
  };
}

async function writeMenuStatus(
  dependencies: CliDependencies,
  repositories: CliRepositories,
  status: CatalogStatusSnapshot,
  dataDirectory: string
): Promise<void> {
  const translate = dependencies.translator.translate.bind(dependencies.translator);
  const write = dependencies.output.writeLine.bind(dependencies.output);
  const diagnosis = await repositories.lock?.diagnoseStaleLock?.();
  const lockState =
    diagnosis === "NOT_HELD"
      ? translate("menu.statusLockFree")
      : diagnosis === "ACTIVE"
        ? translate("menu.statusLockActive")
        : diagnosis === "STALE"
          ? translate("menu.statusLockStale")
          : translate("menu.statusLockUnknown");
  const rows: [string, string][] = [
    [
      translate("menu.statusAccount"),
      status.account?.archiveHandle === null || status.account?.archiveHandle === undefined
        ? translate("menu.statusAccountMissing")
        : `@${status.account.archiveHandle}`
    ],
    [translate("menu.statusImports"), String(status.imports.total)],
    [translate("menu.statusCompleted"), String(status.imports.byStatus.COMPLETED)],
    [translate("menu.statusProcessing"), String(status.imports.byStatus.PROCESSING)],
    [translate("menu.statusFailed"), String(status.imports.byStatus.FAILED)],
    [translate("menu.statusCatalog"), String(status.interactions.total)],
    ...Object.entries(status.interactions.byType).map(([type, count]): [string, string] => [
      type,
      String(count)
    ]),
    [translate("menu.statusExecutor"), lockState]
  ];
  const headings = [
    translate("menu.statusColumnField"),
    translate("menu.statusColumnValue")
  ] as const;
  const fieldWidth = Math.max(...rows.map(([field]) => field.length), headings[0].length);
  const valueWidth = Math.max(...rows.map(([, value]) => value.length), headings[1].length);
  const rule = (left: string, middle: string, right: string) =>
    `${left}${"─".repeat(fieldWidth + 2)}${middle}${"─".repeat(valueWidth + 2)}${right}`;
  const row = ([field, value]: readonly [string, string]) =>
    `│ ${field.padEnd(fieldWidth)} │ ${value.padEnd(valueWidth)} │`;
  write(translate("menu.statusTitle"));
  write(rule("┌", "┬", "┐"));
  write(row(headings));
  write(rule("├", "┼", "┤"));
  for (const entry of rows) write(row(entry));
  write(rule("└", "┴", "┘"));
  if (status.interactions.total === 0) write(translate("status.emptyCatalog"));
  if (diagnosis !== "NOT_HELD") await writeExecutorLockStatus(dependencies, repositories);
  write(translate("status.dataDirectory", { dataDirectory }));
  write(translate("status.localOnlyNotice"));
}

/** Read-only lock inspection; `status` never writes or removes the lock file. */
async function writeExecutorLockStatus(
  dependencies: CliDependencies,
  repositories: CliRepositories
): Promise<void> {
  const lock = repositories.lock;
  if (lock?.diagnoseStaleLock === undefined) return;
  const diagnosis = await lock.diagnoseStaleLock();
  if (diagnosis === "NOT_HELD") {
    dependencies.output.writeLine(dependencies.translator.translate("status.lockNotHeld"));
    return;
  }
  if (diagnosis === "UNKNOWN") {
    dependencies.output.writeLine(dependencies.translator.translate("status.lockUnknown"));
    return;
  }
  const owner = (await lock.readStatus?.()) ?? null;
  dependencies.output.writeLine(
    dependencies.translator.translate(
      diagnosis === "ACTIVE" ? "status.lockActive" : "status.lockStale",
      {
        pid: owner?.pid ?? "?",
        hostname: owner?.hostname ?? "?",
        acquiredAt: owner?.acquiredAt ?? "?"
      }
    )
  );
}

async function openRepositories(
  dependencies: CliDependencies,
  dataDirectory: string
): Promise<CliRepositories> {
  return openCliRepositories(dependencies, dataDirectory);
}
