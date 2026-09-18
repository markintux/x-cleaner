import { resolveApplicationDataDirectory } from "../../platform/application-data.js";
import { getCatalogStatus } from "../../application/catalog/get-catalog-status.js";
import {
  openCliRepositories,
  type CliDependencies,
  type CliRepositories
} from "../dependencies.js";

export interface StatusCommandOptions {
  readonly dataDir?: string;
}

export function createStatusCommand(
  dependencies: CliDependencies
): (options: StatusCommandOptions) => Promise<void> {
  return async (options) => {
    const dataDirectory = resolveApplicationDataDirectory(
      options.dataDir === undefined ? {} : { dataDir: options.dataDir }
    );
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
    } finally {
      repositories.close?.();
    }
  };
}

async function openRepositories(
  dependencies: CliDependencies,
  dataDirectory: string
): Promise<CliRepositories> {
  return openCliRepositories(dependencies, dataDirectory);
}
