import { Command } from "commander";

import { createDryRunCommand } from "./commands/dry-run.js";
import { createImportCommand } from "./commands/import.js";
import { createStatusCommand } from "./commands/status.js";
import type { CliDependencies } from "./dependencies.js";

export function createProgram(dependencies: CliDependencies): Command {
  const program = new Command();

  program
    .name("x-cleaner")
    .description(dependencies.translator.translate("cli.description"))
    .option("--data-dir <path>", dependencies.translator.translate("cli.dataDirectoryOption"));

  program
    .command("status")
    .description(dependencies.translator.translate("cli.statusDescription"))
    .action((_options, command) => createStatusCommand(dependencies)(command.optsWithGlobals()));

  program
    .command("import <path>")
    .description(dependencies.translator.translate("cli.importDescription"))
    .action(async (input, _options, command) => {
      await createImportCommand(dependencies)(input, command.optsWithGlobals());
    });

  program
    .command("dry-run")
    .description(dependencies.translator.translate("cli.dryRunDescription"))
    .option(
      "--type <type>",
      dependencies.translator.translate("cli.typeOption"),
      (value: string, previous: string[] = []) => [...previous, value],
      []
    )
    .option("--from <date>", dependencies.translator.translate("cli.fromOption"))
    .option("--to <date>", dependencies.translator.translate("cli.toOption"))
    .action(async (_options, command) => {
      await createDryRunCommand(dependencies)(command.optsWithGlobals());
    });

  return program;
}
