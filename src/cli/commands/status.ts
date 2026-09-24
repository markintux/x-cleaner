import { getCatalogStatus } from "../../application/catalog/get-catalog-status.js";
import {
  openCliRepositories,
  type CliDependencies,
  type CliRepositories,
  resolveCliDataDirectory
} from "../dependencies.js";

export interface StatusCommandOptions {
  readonly dataDir?: string;
}

export function createStatusCommand(
  dependencies: CliDependencies
): (options: StatusCommandOptions) => Promise<void> {
  return async (options) => {
    const dataDirectory = resolveCliDataDirectory(dependencies, options.dataDir);
    const repositories = await openRepositories(dependencies, dataDirectory);
    try {
      const status = getCatalogStatus(repositories.catalog);
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
