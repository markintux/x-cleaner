import { createInterface } from "node:readline/promises";
import { stdin as standardInput, stdout as standardOutput } from "node:process";

import { Command } from "commander";

import {
  AccountConfirmationError,
  ConfirmAccount
} from "../../application/session/confirm-account.js";
import { clearSession as clearDedicatedSession } from "../../application/session/clear-session.js";
import { LoginSession } from "../../application/session/login-session.js";
import { normalizeAccountHandle, type AccountDetection } from "../../domain/account.js";
import { resolveApplicationDataDirectory } from "../../platform/application-data.js";
import type { CliDependencies, CliRepositories, SessionPrompt } from "../dependencies.js";
import { openCliRepositories } from "../dependencies.js";

export interface SessionCommandOptions {
  readonly dataDir?: string;
}

export function createSessionCommand(dependencies: CliDependencies): Command {
  const session = new Command("session").description(
    dependencies.translator.translate("cli.sessionDescription")
  );

  session
    .command("login")
    .description(dependencies.translator.translate("cli.sessionLoginDescription"))
    .action(async (_options, command) => {
      await runLogin(dependencies, command.optsWithGlobals() as SessionCommandOptions);
    });

  session
    .command("status")
    .description(dependencies.translator.translate("cli.sessionStatusDescription"))
    .action(async (_options, command) => {
      await runStatus(dependencies, command.optsWithGlobals() as SessionCommandOptions);
    });

  session
    .command("clear")
    .description(dependencies.translator.translate("cli.sessionClearDescription"))
    .action(async (_options, command) => {
      await runClear(dependencies, command.optsWithGlobals() as SessionCommandOptions);
    });

  return session;
}

async function runLogin(
  dependencies: CliDependencies,
  options: SessionCommandOptions
): Promise<void> {
  const dataDirectory = resolveDataDirectory(options);
  dependencies.output.writeLine(dependencies.translator.translate("session.localGuidance"));
  dependencies.output.writeLine(dependencies.translator.translate("session.loginStarted"));

  const loginSession = await (dependencies.session?.createLoginSession?.(dataDirectory) ??
    new LoginSession({ dataDirectory }));
  const result = await loginSession.execute();
  dependencies.output.writeLine(
    dependencies.translator.translate("session.profile", {
      profileDirectory: result.profileDirectory
    })
  );

  if (result.detection.status !== "AUTHENTICATED" || result.account === null) {
    printDetectionResult(dependencies, result.detection);
    return;
  }

  const normalizedAccount = {
    ...result.account,
    handle: normalizeAccountHandle(result.account.handle)
  };

  dependencies.output.writeLine(
    dependencies.translator.translate("session.detectedAccount", {
      handle: normalizedAccount.handle
    })
  );
  const prompt = dependencies.session?.prompt ?? new ReadlineSessionPrompt();
  const confirmed = await prompt.confirm(
    dependencies.translator.translate("session.confirmQuestion")
  );

  const repositories = await openRepositories(dependencies, dataDirectory);
  try {
    const confirmation = dependencies.session?.confirmAccount
      ? dependencies.session.confirmAccount(repositories.catalog, {
          account: normalizedAccount,
          confirmed
        })
      : new ConfirmAccount(repositories.catalog).execute({
          account: normalizedAccount,
          confirmed
        });
    if (!confirmation.confirmed) {
      dependencies.output.writeLine(dependencies.translator.translate("session.rejected"));
      return;
    }
    dependencies.output.writeLine(
      dependencies.translator.translate("session.confirmed", {
        handle: normalizedAccount.handle
      })
    );
  } catch (error) {
    if (error instanceof AccountConfirmationError && error.code === "ACCOUNT_IDENTITY_MISMATCH") {
      dependencies.output.writeLine(dependencies.translator.translate("session.identityMismatch"));
    }
    throw error;
  } finally {
    repositories.close?.();
  }
}

async function runStatus(
  dependencies: CliDependencies,
  options: SessionCommandOptions
): Promise<void> {
  const dataDirectory = resolveDataDirectory(options);
  const repositories = await openRepositories(dependencies, dataDirectory);
  try {
    dependencies.output.writeLine(dependencies.translator.translate("session.statusHeader"));
    const account = repositories.catalog.getManagedAccount();
    if (account?.confirmedHandle === null || account?.confirmedHandle === undefined) {
      dependencies.output.writeLine(dependencies.translator.translate("session.notConfirmed"));
      return;
    }
    dependencies.output.writeLine(
      dependencies.translator.translate("session.confirmedAccount", {
        handle: account.confirmedHandle
      })
    );
  } finally {
    repositories.close?.();
  }
}

async function runClear(
  dependencies: CliDependencies,
  options: SessionCommandOptions
): Promise<void> {
  const dataDirectory = resolveDataDirectory(options);
  dependencies.output.writeLine(dependencies.translator.translate("session.clearGuidance"));
  const prompt = dependencies.session?.prompt ?? new ReadlineSessionPrompt();
  const confirmed = await prompt.confirm(
    dependencies.translator.translate("session.clearQuestion")
  );
  if (!confirmed) {
    dependencies.output.writeLine(dependencies.translator.translate("session.clearCanceled"));
    return;
  }

  const result = await (dependencies.session?.clearSession?.({
    dataDirectory,
    confirmed: true
  }) ?? clearDedicatedSession({ dataDirectory, confirmed: true }));
  dependencies.output.writeLine(dependencies.translator.translate("session.cleared"));
  dependencies.output.writeLine(
    dependencies.translator.translate("session.clearProfile", {
      profileDirectory: result.profileDirectory
    })
  );
}

function printDetectionResult(dependencies: CliDependencies, detection: AccountDetection): void {
  if (detection.status === "AUTHENTICATED") {
    return;
  }
  const key =
    detection.status === "UNAUTHENTICATED"
      ? detection.reason === "SESSION_EXPIRED"
        ? "session.sessionExpired"
        : "session.loginRequired"
      : detection.status === "SECURITY_CHALLENGE"
        ? "session.challenge"
        : "session.unknown";
  dependencies.output.writeLine(dependencies.translator.translate(key));
}

function resolveDataDirectory(options: SessionCommandOptions): string {
  return resolveApplicationDataDirectory(
    options.dataDir === undefined ? {} : { dataDir: options.dataDir }
  );
}

async function openRepositories(
  dependencies: CliDependencies,
  dataDirectory: string
): Promise<CliRepositories> {
  return openCliRepositories(dependencies, dataDirectory);
}

class ReadlineSessionPrompt implements SessionPrompt {
  async confirm(question: string): Promise<boolean> {
    const readline = createInterface({ input: standardInput, output: standardOutput });
    try {
      const answer = await readline.question(`${question} `);
      return /^(?:s|sim|y|yes)$/iu.test(answer.trim());
    } finally {
      readline.close();
    }
  }
}
