import { Command } from "commander";

import { createDryRunCommand } from "./commands/dry-run.js";
import { createImportCommand } from "./commands/import.js";
import { createStatusCommand } from "./commands/status.js";
import { createSessionCommand } from "./commands/session.js";
import { createRunCommand } from "./commands/run.js";
import { createResumeCommand } from "./commands/resume.js";
import { createReportCommand } from "./commands/report.js";
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

  program.addCommand(createSessionCommand(dependencies));

  program
    .command("report <runId>")
    .description(dependencies.translator.translate("cli.reportDescription"))
    .action(async (runId, _options, command) => {
      await createReportCommand(dependencies)(runId, command.optsWithGlobals());
    });

  program
    .command("run <planId>")
    .description(dependencies.translator.translate("cli.runDescription"))
    .option("--limit <number>", dependencies.translator.translate("cli.limitOption"))
    .action(async (planId, options, command) => {
      await createRunCommand(dependencies)(planId, {
        ...options,
        ...command.optsWithGlobals()
      });
    });

  program
    .command("resume <runId>")
    .description(dependencies.translator.translate("cli.resumeDescription"))
    .option("--limit <number>", dependencies.translator.translate("cli.limitOption"))
    .action(async (runId, options, command) => {
      await createResumeCommand(dependencies)(runId, {
        ...options,
        ...command.optsWithGlobals()
      });
    });

  return program;
}
