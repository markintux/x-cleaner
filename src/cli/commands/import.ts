import { resolveApplicationDataDirectory } from "../../platform/application-data.js";
import { ImportArchive } from "../../application/import/import-archive.js";
import {
  openCliRepositories,
  type CliDependencies,
  type CliRepositories
} from "../dependencies.js";

export interface ImportCommandOptions {
  readonly dataDir?: string;
}

export interface ImportCommandResult {
  readonly totalCount: number;
  readonly adapterKey: string;
}

export function createImportCommand(
  dependencies: CliDependencies
): (input: string, options: ImportCommandOptions) => Promise<ImportCommandResult> {
  return async (input, options) => {
    const dataDirectory = resolveApplicationDataDirectory(
      options.dataDir === undefined ? {} : { dataDir: options.dataDir }
    );
    const repositories = await openRepositories(dependencies, dataDirectory);
    try {
      const result = await new ImportArchive(repositories.database, repositories.catalog).execute(
        input
      );
      dependencies.output.writeLine(dependencies.translator.translate("import.completed"));
      dependencies.output.writeLine(
        dependencies.translator.translate("import.adapter", { adapter: result.adapterKey })
      );
      dependencies.output.writeLine(
        dependencies.translator.translate("import.inserted", { count: result.insertedCount })
      );
      dependencies.output.writeLine(
        dependencies.translator.translate("import.reused", { count: result.reusedCount })
      );
      dependencies.output.writeLine(
        dependencies.translator.translate("import.updated", { count: result.updatedCount })
      );
      for (const [type, count] of [
        ["POST", result.postsCount],
        ["REPLY", result.repliesCount],
        ["REPOST", result.repostsCount],
        ["LIKE", result.likesCount]
      ] as const) {
        dependencies.output.writeLine(
          dependencies.translator.translate("import.typeCount", { type, count })
        );
      }
      dependencies.output.writeLine(
        dependencies.translator.translate("import.total", { count: result.totalCount })
      );
      if (result.totalCount === 0) {
        dependencies.output.writeLine(dependencies.translator.translate("import.empty"));
      }
      return { totalCount: result.totalCount, adapterKey: result.adapterKey };
    } catch (error) {
      const errorCode = sanitizedErrorCode(error);
      dependencies.output.writeLine(
        dependencies.translator.translate("import.validationFailure", { errorCode })
      );
      throw error;
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

function sanitizedErrorCode(error: unknown): string {
  const candidate = error as { code?: unknown; message?: unknown };
  const value = typeof candidate.code === "string" ? candidate.code : candidate.message;
  return typeof value === "string" && /^[A-Z][A-Z0-9_]*$/u.test(value)
    ? value
    : "ARCHIVE_IMPORT_FAILED";
}
