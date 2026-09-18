import { Command } from "commander";

import { createStatusCommand } from "./commands/status.js";
import type { CliDependencies } from "./dependencies.js";

export function createProgram(dependencies: CliDependencies): Command {
  const program = new Command();

  program
    .name("x-cleaner")
    .description(dependencies.translator.translate("cli.description"))
    .option("--data-dir <path>", dependencies.translator.translate("cli.dataDirectoryOption"))
    .command("status")
    .description(dependencies.translator.translate("cli.statusDescription"))
    .action((_options, command) => createStatusCommand(dependencies)(command.optsWithGlobals()));

  return program;
}
