import { Command, type CommanderError, type Help } from "commander";

import { createDryRunCommand } from "./commands/dry-run.js";
import { createImportCommand } from "./commands/import.js";
import { createStatusCommand } from "./commands/status.js";
import { createSessionCommand } from "./commands/session.js";
import { createRunCommand } from "./commands/run.js";
import { createResumeCommand } from "./commands/resume.js";
import { createMenuCommand } from "./commands/menu.js";
import { createReportCommand } from "./commands/report.js";
import { createDoctorCommand } from "./commands/doctor.js";
import type { CliDependencies } from "./dependencies.js";
import type { MessageKey } from "../i18n/catalog.js";

export const cliExitCodes = {
  success: 0,
  argument: 2,
  safety: 3,
  lock: 4,
  failure: 1
} as const;

export function createProgram(dependencies: CliDependencies): Command {
  const translate = dependencies.translator.translate.bind(dependencies.translator);
  const program = new Command();

  program
    .name("x-cleaner")
    .description(translate("cli.description"))
    .helpOption("-h, --help", translate("cli.helpOption"))
    .helpCommand("help [command]", translate("cli.helpCommand"))
    .option("--data-dir <path>", translate("cli.dataDirectoryOption"))
    .option("--diagnostics", translate("cli.diagnosticsOption"))
    .argument("[path]", translate("cli.archivePathArgument"))
    .action(async (input: string | undefined, _options, command: Command) => {
      if (input === undefined) {
        await createMenuCommand(dependencies)(command.optsWithGlobals());
        return;
      }
      await createImportCommand(dependencies)(input, command.optsWithGlobals());
    });
  program.configureHelp({
    formatHelp: (command, helper) => formatPortugueseHelp(command, helper, dependencies)
  });
  program.configureOutput({ outputError: () => undefined });

  program
    .command("menu")
    .description(translate("cli.menuDescription"))
    .action(async (_options, command) => {
      await createMenuCommand(dependencies)(command.optsWithGlobals());
    });

  program
    .command("status")
    .description(translate("cli.statusDescription"))
    .action(async (_options, command) => {
      await createStatusCommand(dependencies)(command.optsWithGlobals());
    });

  program
    .command("doctor")
    .description(translate("cli.doctorDescription"))
    .action(async (_options, command) => {
      await createDoctorCommand(dependencies)(command.optsWithGlobals());
    });

  program
    .command("import <path>")
    .description(translate("cli.importDescription"))
    .action(async (input, _options, command) => {
      await createImportCommand(dependencies)(input, command.optsWithGlobals());
    });

  program
    .command("dry-run")
    .description(translate("cli.dryRunDescription"))
    .option(
      "--type <type>",
      translate("cli.typeOption"),
      (value: string, previous: string[] = []) => [...previous, value],
      []
    )
    .option("--from <date>", translate("cli.fromOption"))
    .option("--to <date>", translate("cli.toOption"))
    .action(async (_options, command) => {
      await createDryRunCommand(dependencies)(command.optsWithGlobals());
    });

  program.addCommand(createSessionCommand(dependencies));

  program
    .command("run <planId>")
    .description(translate("cli.runDescription"))
    .option("--limit <number>", translate("cli.limitOption"))
    .option("--release-stale-lock", translate("cli.releaseStaleLockOption"))
    .action(async (planId, options, command) => {
      await createRunCommand(dependencies)(planId, {
        ...options,
        ...command.optsWithGlobals()
      });
    });

  program
    .command("resume <runId>")
    .description(translate("cli.resumeDescription"))
    .option("--limit <number>", translate("cli.limitOption"))
    .option("--release-stale-lock", translate("cli.releaseStaleLockOption"))
    .action(async (runId, options, command) => {
      await createResumeCommand(dependencies)(runId, {
        ...options,
        ...command.optsWithGlobals()
      });
    });

  program
    .command("report <runId>")
    .description(translate("cli.reportDescription"))
    .action(async (runId, _options, command) => {
      await createReportCommand(dependencies)(runId, command.optsWithGlobals());
    });

  return program;
}

export function exitCodeForError(error: unknown): number {
  if (isSuccessfulCommanderExit(error)) return cliExitCodes.success;
  const code = errorCodeFor(error);
  if (code === "EXECUTOR_LOCK_HELD") return cliExitCodes.lock;
  if (safetyErrorCodes.has(code)) return cliExitCodes.safety;
  if (argumentErrorCodes.has(code)) return cliExitCodes.argument;
  return cliExitCodes.failure;
}

export function errorCodeFor(error: unknown): string {
  if (isSuccessfulCommanderExit(error)) return "";
  const candidate = error as { readonly code?: unknown; readonly message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : candidate.message;
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]*$/u.test(code)) return code;
  if (typeof candidate.code === "string" && candidate.code.startsWith("commander.")) {
    return "CLI_ARGUMENT_INVALID";
  }
  return "CLI_FAILURE";
}

/** Prints a sanitized localized failure and never prints a stack by default. */
export function reportCliError(
  error: unknown,
  dependencies: CliDependencies,
  diagnostics = dependencies.diagnostics ?? false
): number {
  if (isSuccessfulCommanderExit(error)) return cliExitCodes.success;
  const code = errorCodeFor(error);
  const output = dependencies.errorOutput ?? dependencies.output;
  output.writeLine(dependencies.translator.translate("cli.error", { errorCode: code }));
  output.writeLine(
    dependencies.translator.translate("cli.nextStep", {
      nextStep: dependencies.translator.translate(nextStepKey(code))
    })
  );
  if (diagnostics) {
    const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);
    output.writeLine(
      dependencies.translator.translate("cli.diagnosticDetails", { details: stack })
    );
  }
  return exitCodeForError(error);
}

export function isSuccessfulCommanderExit(error: unknown): error is CommanderError {
  const code = (error as { readonly code?: unknown }).code;
  return code === "commander.helpDisplayed" || code === "commander.version";
}

function formatPortugueseHelp(
  command: Command,
  helper: Help,
  dependencies: CliDependencies
): string {
  const translate = dependencies.translator.translate.bind(dependencies.translator);
  const lines = [`${translate("cli.helpUsage")} ${helper.commandUsage(command)}`];
  const description = helper.commandDescription(command);
  if (description.length > 0) lines.push("", description);

  appendHelpItems(
    lines,
    translate("cli.helpArguments"),
    helper
      .visibleArguments(command)
      .map((item) => [helper.argumentTerm(item), helper.argumentDescription(item)])
  );
  appendHelpItems(
    lines,
    translate("cli.helpOptions"),
    helper
      .visibleOptions(command)
      .map((item) => [helper.optionTerm(item), helper.optionDescription(item)])
  );
  appendHelpItems(
    lines,
    translate("cli.helpCommands"),
    helper
      .visibleCommands(command)
      .map((item) => [helper.subcommandTerm(item), helper.subcommandDescription(item)])
  );
  return `${lines.join("\n")}\n`;
}

function appendHelpItems(
  lines: string[],
  heading: string,
  items: readonly (readonly [string, string])[]
): void {
  if (items.length === 0) return;
  lines.push("", heading);
  for (const [term, description] of items) {
    lines.push(`  ${term}${description.length === 0 ? "" : `\t${description}`}`);
  }
}

function nextStepKey(code: string): MessageKey {
  if (code.startsWith("ARCHIVE_") || code.startsWith("UNSUPPORTED_ARCHIVE")) {
    return "cli.nextImport";
  }
  if (code.startsWith("SELECTION_") || code === "ACCOUNT_NOT_FOUND") {
    return "cli.nextDryRun";
  }
  if (
    code.includes("ACCOUNT") ||
    code.includes("SESSION") ||
    code === "CURRENT_ACCOUNT_UNAVAILABLE" ||
    code === "CURRENT_ACCOUNT_REQUIRED"
  ) {
    return "cli.nextSession";
  }
  if (code.includes("LOCK")) return "cli.nextLock";
  if (code.startsWith("RUN_") || code.startsWith("BATCH_") || code === "PLAN_EMPTY") {
    return "cli.nextResume";
  }
  if (code === "REVIEWED_PLAN_REQUIRED" || code === "CONFIRMATION_REQUIRED") {
    return "cli.nextPlan";
  }
  return "cli.nextGeneral";
}

const safetyErrorCodes = new Set([
  "REVIEWED_PLAN_REQUIRED",
  "PLAN_EMPTY",
  "PLAN_SNAPSHOT_INVALID",
  "CONFIRMED_ACCOUNT_REQUIRED",
  "CURRENT_ACCOUNT_REQUIRED",
  "CURRENT_ACCOUNT_UNAVAILABLE",
  "ACCOUNT_MISMATCH",
  "RUN_ALREADY_EXISTS",
  "RUN_NOT_FOUND",
  "RUN_NOT_RESUMABLE",
  "BATCH_NOT_FOUND",
  "BATCH_ALREADY_FINISHED",
  "CONFIRMATION_CANCELED",
  "CONFIRMATION_REQUIRED",
  "EXECUTOR_LOCK_REQUIRED",
  "INVALID_BATCH_LIMIT",
  "ENGINE_NOT_CONFIGURED",
  "EXECUTION_REPOSITORIES_NOT_CONFIGURED",
  "EXECUTION_SERVICES_NOT_CONFIGURED",
  "REPORT_REPOSITORIES_NOT_CONFIGURED"
]);

const argumentErrorCodes = new Set(["CLI_ARGUMENT_INVALID", "INVALID_BATCH_LIMIT"]);
