export const messageKeys = [
  "cli.description",
  "cli.dataDirectoryOption",
  "cli.diagnosticsOption",
  "cli.helpUsage",
  "cli.helpArguments",
  "cli.helpOptions",
  "cli.helpCommands",
  "cli.error",
  "cli.nextStep",
  "cli.diagnosticDetails",
  "cli.helpOption",
  "cli.helpCommand",
  "cli.nextImport",
  "cli.nextDryRun",
  "cli.nextSession",
  "cli.nextPlan",
  "cli.nextResume",
  "cli.nextLock",
  "cli.nextGeneral",
  "cli.statusDescription",
  "cli.importDescription",
  "cli.dryRunDescription",
  "cli.typeOption",
  "cli.fromOption",
  "cli.toOption",
  "cli.limitOption",
  "cli.runDescription",
  "cli.resumeDescription",
  "run.planId",
  "run.runId",
  "run.typeCounts",
  "run.total",
  "run.account",
  "run.items",
  "run.warning",
  "run.confirmInstruction",
  "run.confirmQuestion",
  "run.resumeInstruction",
  "run.canceled",
  "run.completed",
  "run.batchCompleted",
  "run.paused",
  "run.interrupted",
  "status.dataDirectory",
  "status.localOnlyNotice",
  "status.account",
  "status.accountMissing",
  "status.imports",
  "status.importLifecycle",
  "status.catalog",
  "status.typeCount",
  "status.emptyCatalog",
  "import.completed",
  "import.adapter",
  "import.inserted",
  "import.reused",
  "import.updated",
  "import.typeCount",
  "import.total",
  "import.empty",
  "import.validationFailure",
  "dryRun.notice",
  "dryRun.noMutation",
  "dryRun.planId",
  "dryRun.types",
  "dryRun.from",
  "dryRun.to",
  "dryRun.typeCount",
  "dryRun.total",
  "dryRun.empty",
  "selection.error",
  "cli.sessionDescription",
  "cli.sessionLoginDescription",
  "cli.sessionStatusDescription",
  "cli.sessionClearDescription",
  "session.localGuidance",
  "session.loginStarted",
  "session.loginWindowGuidance",
  "session.loginAlternativeGuidance",
  "session.profile",
  "session.detectedAccount",
  "session.confirmQuestion",
  "session.confirmed",
  "session.rejected",
  "session.loginRequired",
  "session.sessionExpired",
  "session.challenge",
  "session.unknown",
  "session.identityMismatch",
  "session.statusHeader",
  "session.confirmedAccount",
  "session.notConfirmed",
  "session.clearGuidance",
  "session.clearQuestion",
  "session.clearCanceled",
  "session.cleared",
  "session.clearProfile",
  "cli.reportDescription",
  "progress.header",
  "progress.type",
  "progress.total",
  "progress.pause",
  "report.generated",
  "report.path",
  "report.state",
  "report.total",
  "report.type",
  "report.failure"
] as const;

export type MessageKey = (typeof messageKeys)[number];
export type MessageParameters = Readonly<Record<string, string | number>>;
export type MessageCatalog = Readonly<Record<MessageKey, string>>;

export interface CatalogParity {
  readonly missingKeys: readonly MessageKey[];
  readonly extraKeys: readonly string[];
  readonly valid: boolean;
}

/** Checks a complete catalog without tying future locales to Portuguese text. */
export function checkCatalogParity(catalog: Readonly<Record<string, string>>): CatalogParity {
  const expected = new Set<string>(messageKeys);
  const actual = new Set(Object.keys(catalog));
  const missingKeys = messageKeys.filter((key) => !actual.has(key));
  const extraKeys = [...actual].filter((key) => !expected.has(key)).sort();
  return { missingKeys, extraKeys, valid: missingKeys.length === 0 && extraKeys.length === 0 };
}

export function assertCatalogParity(
  catalog: Readonly<Record<string, string>>
): asserts catalog is MessageCatalog {
  const parity = checkCatalogParity(catalog);
  if (!parity.valid) {
    throw new Error(
      `CATALOG_PARITY_MISMATCH:${parity.missingKeys.join(",")}:${parity.extraKeys.join(",")}`
    );
  }
}
