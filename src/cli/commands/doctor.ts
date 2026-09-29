import {
  resolveCliDataDirectory,
  type BrowserPrerequisiteResult,
  type CliDependencies
} from "../dependencies.js";

export interface DoctorOptions {
  readonly dataDir?: string;
}

export interface DoctorResult extends BrowserPrerequisiteResult {
  readonly ready: boolean;
  readonly nodeReady: boolean;
}

/** Reports read-only local checks supplied by the composition root. */
export function createDoctorCommand(
  dependencies: CliDependencies,
  nodeVersion = process.versions.node
): (options: DoctorOptions) => Promise<DoctorResult> {
  return async (options) => {
    const translate = dependencies.translator.translate.bind(dependencies.translator);
    const write = dependencies.output.writeLine.bind(dependencies.output);
    const nodeReady = Number(nodeVersion.split(".")[0]) >= 24;
    if (dependencies.browserPrerequisites === undefined) {
      throw new Error("BROWSER_PREREQUISITES_NOT_CONFIGURED");
    }
    const { chromeReady, playwrightReady } = await dependencies.browserPrerequisites.check();

    write(translate("doctor.title"));
    write(
      translate(nodeReady ? "doctor.nodeReady" : "doctor.nodeMissing", { version: nodeVersion })
    );
    write(translate(chromeReady ? "doctor.chromeReady" : "doctor.chromeMissing"));
    write(translate(playwrightReady ? "doctor.playwrightReady" : "doctor.playwrightMissing"));
    write(
      translate("doctor.dataDirectory", {
        path: resolveCliDataDirectory(dependencies, options.dataDir)
      })
    );
    write(translate(nodeReady && chromeReady ? "doctor.ready" : "doctor.notReady"));

    return { ready: nodeReady && chromeReady, nodeReady, chromeReady, playwrightReady };
  };
}
