import { resolveApplicationDataDirectory } from "../../platform/application-data.js";
import type { CliDependencies } from "../dependencies.js";

export interface StatusCommandOptions {
  readonly dataDir?: string;
}

export function createStatusCommand(
  dependencies: CliDependencies
): (options: StatusCommandOptions) => void {
  return (options) => {
    const dataDirectory = resolveApplicationDataDirectory(
      options.dataDir === undefined ? {} : { dataDir: options.dataDir }
    );
    dependencies.output.writeLine(
      dependencies.translator.translate("status.dataDirectory", { dataDirectory })
    );
    dependencies.output.writeLine(dependencies.translator.translate("status.localOnlyNotice"));
  };
}
