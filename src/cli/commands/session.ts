import { Command } from "commander";

import {
  AccountConfirmationError,
  ConfirmAccount
} from "../../application/session/confirm-account.js";
import { normalizeAccountHandle, type AccountDetection } from "../../domain/account.js";
import type { CliDependencies, CliRepositories, SessionPrompt } from "../dependencies.js";
import { openCliRepositories, resolveCliDataDirectory } from "../dependencies.js";
import { recordAudit } from "../../application/ports/audit-logger.js";
import { createHash } from "node:crypto";
import { ReadlinePrompt } from "../prompt.js";

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
  const dataDirectory = resolveDataDirectory(dependencies, options);
  const auditLogger = dependencies.auditLogger ?? dependencies.auditLoggerFactory?.(dataDirectory);
  const now = dependencies.clock?.now.bind(dependencies.clock) ?? defaultNow;
  dependencies.output.writeLine(dependencies.translator.translate("session.localGuidance"));
  dependencies.output.writeLine(dependencies.translator.translate("session.loginStarted"));
  dependencies.output.writeLine(dependencies.translator.translate("session.loginWindowGuidance"));
  dependencies.output.writeLine(
    dependencies.translator.translate("session.loginAlternativeGuidance")
  );

  const loginSessionFactory = dependencies.session?.createLoginSession;
  if (loginSessionFactory === undefined) throw new Error("SESSION_SERVICE_NOT_CONFIGURED");
  const loginSession = await loginSessionFactory(dataDirectory);
  const result = await loginSession.execute();
  await recordAudit(auditLogger, {
    event: "account.detected",
    timestamp: now(),
    status: result.detection.status,
    handle: result.account?.handle ?? null
  });
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
  const prompt = dependencies.session?.prompt ?? resolveSessionPrompt(dependencies);
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
      : new ConfirmAccount(repositories.catalog, { now }).execute({
          account: normalizedAccount,
          confirmed
        });
    if (!confirmation.confirmed) {
      await recordAudit(auditLogger, {
        event: "account.rejected",
        timestamp: now(),
        outcome: "CANCELED"
      });
      dependencies.output.writeLine(dependencies.translator.translate("session.rejected"));
      return;
    }
    await recordAudit(auditLogger, {
      event: "account.confirmed",
      timestamp: confirmation.account?.confirmedAt ?? now(),
      handle: normalizedAccount.handle,
      accountId: confirmation.account?.id ?? null,
      outcome: "CONFIRMED"
    });
    dependencies.output.writeLine(
      dependencies.translator.translate("session.confirmed", {
        handle: normalizedAccount.handle
      })
    );
  } catch (error) {
    if (error instanceof AccountConfirmationError && error.code === "ACCOUNT_IDENTITY_MISMATCH") {
      await recordAudit(auditLogger, {
        event: "account.rejected",
        timestamp: now(),
        outcome: "IDENTITY_MISMATCH"
      });
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
  const dataDirectory = resolveDataDirectory(dependencies, options);
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
  const dataDirectory = resolveDataDirectory(dependencies, options);
  const auditLogger = dependencies.auditLogger ?? dependencies.auditLoggerFactory?.(dataDirectory);
  dependencies.output.writeLine(dependencies.translator.translate("session.clearGuidance"));
  const prompt = dependencies.session?.prompt ?? resolveSessionPrompt(dependencies);
  const confirmed = await prompt.confirm(
    dependencies.translator.translate("session.clearQuestion")
  );
  if (!confirmed) {
    dependencies.output.writeLine(dependencies.translator.translate("session.clearCanceled"));
    return;
  }

  const clearSession = dependencies.session?.clearSession;
  if (clearSession === undefined) throw new Error("SESSION_SERVICE_NOT_CONFIGURED");
  const result = await clearSession({ dataDirectory, confirmed: true });
  await recordAudit(auditLogger, {
    event: "session.cleared",
    timestamp: result.clearedAt,
    dataDirectoryId: createHash("sha256").update(dataDirectory).digest("hex").slice(0, 16)
  });
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

function resolveDataDirectory(
  dependencies: CliDependencies,
  options: SessionCommandOptions
): string {
  return resolveCliDataDirectory(dependencies, options.dataDir);
}

async function openRepositories(
  dependencies: CliDependencies,
  dataDirectory: string
): Promise<CliRepositories> {
  return openCliRepositories(dependencies, dataDirectory);
}

function resolveSessionPrompt(dependencies: CliDependencies): SessionPrompt {
  const configured = dependencies.prompt as SessionPrompt | undefined;
  if (configured !== undefined && typeof configured.confirm === "function") {
    return configured;
  }
  return new ReadlinePrompt({ writeLine: (message) => dependencies.output.writeLine(message) });
}

function defaultNow(): string {
  return new Date().toISOString();
}
