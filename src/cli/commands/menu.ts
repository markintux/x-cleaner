import { stdout } from "node:process";

import { createResumeCommand, type RunCommandResult } from "./run.js";
import { createStatusCommand } from "./status.js";
import {
  openCliRepositories,
  resolveCliDataDirectory,
  type CliDependencies
} from "../dependencies.js";
import type { RunOverview } from "../../application/ports/run-repository.js";
import { ReadlinePrompt } from "../prompt.js";
import { ArchiveVerification } from "../../application/runs/archive-verification.js";
import { groupRunsByType, type RunGroup } from "../run-groups.js";
import { SkipPausedItem } from "../../application/runs/skip-paused-item.js";
import type { Prompt } from "../../application/ports/prompt.js";
import { recordAudit } from "../../application/ports/audit-logger.js";

const maxBatchLimit = 25;

export interface MenuCommandOptions {
  readonly dataDir?: string;
}

export function createMenuCommand(
  dependencies: CliDependencies
): (options: MenuCommandOptions) => Promise<void> {
  return async (options) => {
    const dataDirectory = resolveCliDataDirectory(dependencies, options.dataDir);
    const translate = dependencies.translator.translate.bind(dependencies.translator);
    const write = dependencies.output.writeLine.bind(dependencies.output);
    const color = stdout.isTTY === true && process.env.NO_COLOR === undefined;
    const prompt = dependencies.prompt ?? new ReadlinePrompt({ writeLine: write });
    while (true) {
      const { runs, handle } = await loadMenuState(dependencies, dataDirectory);
      const groups = groupRunsByType(runs);
      renderMenu(groups, handle, translate, write, color);
      const choice = (await prompt.ask(translate("menu.choose"))).trim().toLowerCase();
      if (choice === "0" || choice === "s") {
        write(translate("menu.goodbye"));
        return;
      }
      if (choice === "e") {
        write("");
        await createStatusCommand(dependencies)(
          options.dataDir === undefined
            ? { presentation: "menu" }
            : { dataDir: options.dataDir, presentation: "menu" }
        );
        await prompt.ask(translate("menu.backToTable"));
        write("");
        continue;
      }
      if (choice === "h") {
        renderRunHistory(runs, translate, write, color);
        await prompt.ask(translate("menu.backToTable"));
        continue;
      }
      if (!/^[1-9][0-9]*$/u.test(choice)) {
        write(translate("menu.invalidChoice"));
        continue;
      }
      const group = groups[Number(choice) - 1];
      let run = group?.current;
      if (run === undefined || group === undefined) {
        write(translate("menu.invalidChoice"));
        continue;
      }
      if (
        group.runs.length > 1 ||
        run.types.length > 1 ||
        run.repeatedItems > 0 ||
        run.archivedAt !== null
      ) {
        const reviewed = await reviewGroup(group, translate, write, color, prompt);
        run = reviewed.run;
        if (reviewed.action === "c") {
          await archiveVerificationFromMenu(dependencies, dataDirectory, run.runId, prompt);
          continue;
        }
        if (reviewed.action !== "r") continue;
      }
      if (
        handle === null ||
        run.pending === 0 ||
        run.archivedAt !== null ||
        (run.status !== "PAUSED" && run.status !== "INTERRUPTED")
      ) {
        write(translate("menu.unavailable"));
        continue;
      }
      if (run.pauseReason !== null) {
        write("");
        write(translate("menu.pauseBlocked", { reason: run.pauseReason }));
        const repositories = await openCliRepositories(dependencies, dataDirectory);
        try {
          const lastError = repositories.runs
            ?.listRunItems(run.runId)
            .filter((item) => item.status === "PENDING" && item.lastErrorCode !== null)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.lastErrorCode;
          if (lastError != null) write(translate("menu.pauseError", { error: lastError }));
        } finally {
          repositories.close?.();
        }
        const help = {
          UNKNOWN_UI: "menu.pauseHelpUnknown",
          SESSION_EXPIRED: "menu.pauseHelpSession",
          SECURITY_CHALLENGE: "menu.pauseHelpChallenge",
          RATE_LIMIT: "menu.pauseHelpRateLimit"
        } as const;
        write("");
        write(translate(help[run.pauseReason]));
        write("");
        const recovery = (
          await prompt.ask(
            translate(
              run.pauseReason === "UNKNOWN_UI"
                ? "menu.pauseActionsQuestion"
                : "menu.pauseRetryQuestion"
            )
          )
        )
          .trim()
          .toLowerCase();
        write("");
        if (recovery === "p" && run.pauseReason === "UNKNOWN_UI") {
          await skipPausedItemFromMenu(dependencies, dataDirectory, run.runId, prompt);
          write("");
          continue;
        }
        if (recovery !== "t") continue;
      }

      const recoveringPause = run.pauseReason !== null;
      const defaultLimit = recoveringPause ? 1 : Math.min(5, run.pending);
      const maxLimit = recoveringPause ? 1 : Math.min(maxBatchLimit, run.pending);
      if (run.overlappingPending > 0) {
        renderOverlapPreparation(run, handle, defaultLimit, maxLimit, translate, write, color);
      }
      const entered = (
        recoveringPause
          ? "1"
          : await prompt.ask(translate("menu.limitQuestion", { defaultLimit, maxLimit }))
      ).trim();
      const limit = entered === "" ? defaultLimit : Number(entered);
      if (
        !/^(?:[1-9][0-9]*)?$/u.test(entered) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > maxLimit
      ) {
        write(translate("menu.invalidLimit", { maxLimit }));
        continue;
      }
      write(translate("menu.review", { types: run.types.join(" + "), limit }));
      const result = await createResumeCommand(dependencies)(run.runId, {
        ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
        limit,
        presentation: "menu"
      });
      if (result.canceled) {
        write(translate("menu.canceled"));
      } else if (result.summary !== undefined) {
        renderBatchResult(result, translate, write, color);
      }
      const next = (await prompt.ask(translate("menu.afterBatchQuestion"))).trim().toLowerCase();
      if (next === "0" || next === "s") {
        write(translate("menu.goodbye"));
        return;
      }
      write("");
    }
  };
}

async function reviewGroup(
  group: RunGroup,
  translate: CliDependencies["translator"]["translate"],
  write: (line: string) => void,
  color: boolean,
  prompt: Prompt
): Promise<{ readonly action: string; readonly run: RunOverview }> {
  let run = group.current;
  while (true) {
    renderOverlapNotice(run, translate, write, color);
    const resumable =
      run.archivedAt === null &&
      run.pending > 0 &&
      (run.status === "PAUSED" || run.status === "INTERRUPTED");
    const question = resumable
      ? translate(run.repeatedItems > 0 ? "menu.verificationActions" : "menu.executionActions")
      : translate("menu.historyActions");
    const action = (await prompt.ask(question)).trim().toLowerCase();
    if (action === "h") {
      renderRunHistory(group.runs, translate, write, color);
      const selection = (
        await prompt.ask(translate("menu.historyChoose", { count: group.runs.length }))
      ).trim();
      if (/^[1-9][0-9]*$/u.test(selection)) {
        const selected = group.runs[Number(selection) - 1];
        if (selected !== undefined) run = selected;
        else write(translate("menu.invalidChoice"));
      } else if (selection !== "") write(translate("menu.invalidChoice"));
      continue;
    }
    if (resumable && (action === "r" || (action === "c" && run.repeatedItems > 0)))
      return { action, run };
    return { action: "", run };
  }
}

async function archiveVerificationFromMenu(
  dependencies: CliDependencies,
  dataDirectory: string,
  runId: string,
  prompt: Prompt
): Promise<void> {
  const repositories = await openCliRepositories(dependencies, dataDirectory);
  const translate = dependencies.translator.translate.bind(dependencies.translator);
  const write = dependencies.output.writeLine.bind(dependencies.output);
  try {
    const lock = dependencies.run?.lock ?? repositories.lock;
    if (repositories.runs === undefined || lock === undefined)
      throw new Error("ARCHIVING_NOT_CONFIGURED");
    const clock = dependencies.run?.clock ?? dependencies.clock;
    const service = new ArchiveVerification(
      { ...repositories, runs: repositories.runs, lock },
      clock?.now.bind(clock)
    );
    const reviewed = service.review(runId);
    write("");
    const width = 72;
    write(
      tint(
        `╭${"─".repeat(width - 2)}╮`,
        "33",
        stdout.isTTY === true && process.env.NO_COLOR === undefined
      )
    );
    write(boxRow(translate("menu.archiveTitle"), width));
    write(`├${"─".repeat(width - 2)}┤`);
    for (const line of wrapText(
      translate("menu.archiveWarning", { count: reviewed.overview.pending }),
      width - 4
    )) {
      write(boxRow(line, width));
    }
    write(`╰${"─".repeat(width - 2)}╯`);
    write("");
    const confirmation = await prompt.ask(translate("menu.archiveQuestion"));
    if (confirmation !== "ENCERRAR") {
      write(translate("menu.archiveCanceled"));
      return;
    }
    await service.execute(reviewed, confirmation);
    await recordAudit(dependencies.auditLogger ?? repositories.auditLogger, {
      event: "run.verification.archived",
      timestamp: new Date().toISOString(),
      runId,
      pending: reviewed.overview.pending
    });
    write(translate("menu.archiveDone"));
  } catch {
    write(translate("menu.archiveUnavailable"));
  } finally {
    repositories.close?.();
  }
}

function renderRunHistory(
  runs: readonly RunOverview[],
  translate: CliDependencies["translator"]["translate"],
  write: (line: string) => void,
  color: boolean
): void {
  const widths = [3, 10, 24, 12, 8, 9, 18];
  const width = tableRule(widths, "┌", "┬", "┐").length;
  write("");
  write(tint(`╭${"─".repeat(width - 2)}╮`, "36", color));
  write(tint(boxRow(translate("menu.historyTitle"), width), "1;36", color));
  write(tint(`╰${"─".repeat(width - 2)}╯`, "36", color));
  write(tableRule(widths, "┌", "┬", "┐"));
  write(
    tableRow(
      [
        translate("menu.columnNumber"),
        translate("menu.columnTypes"),
        translate("menu.historyDate"),
        translate("menu.historyPurpose"),
        translate("menu.historyProcessed"),
        translate("menu.historyPending"),
        translate("menu.columnState")
      ],
      widths
    )
  );
  write(tableRule(widths, "├", "┼", "┤"));
  for (const [index, run] of runs.entries()) {
    write(
      tableRow(
        [
          String(index + 1),
          run.types.join("+"),
          run.createdAt,
          translate(run.repeatedItems > 0 ? "menu.historyVerification" : "menu.historyCleaning"),
          String(run.processed),
          String(run.pending),
          run.archivedAt !== null ? translate("menu.stateArchived") : menuState(run, translate)
        ],
        widths
      )
    );
  }
  write(tableRule(widths, "└", "┴", "┘"));
  for (const line of wrapText(translate("menu.historyHint"), width)) write(line);
}

async function skipPausedItemFromMenu(
  dependencies: CliDependencies,
  dataDirectory: string,
  runId: string,
  prompt: Prompt
): Promise<void> {
  const repositories = await openCliRepositories(dependencies, dataDirectory);
  const write = dependencies.output.writeLine.bind(dependencies.output);
  const translate = dependencies.translator.translate.bind(dependencies.translator);
  try {
    const lock = dependencies.run?.lock ?? repositories.lock;
    if (repositories.runs === undefined || repositories.audit === undefined || lock === undefined) {
      throw new Error("EXECUTION_SERVICES_NOT_CONFIGURED");
    }
    const service = new SkipPausedItem({
      ...repositories,
      runs: repositories.runs,
      audit: repositories.audit,
      lock
    });
    const reviewed = service.review(runId);
    const run = repositories.runs.getRun(runId)!;
    write(
      translate("menu.skipReview", {
        handle: run.boundHandle,
        type: reviewed.type,
        id: reviewed.xInteractionId,
        date: reviewed.interactionCreatedAt ?? translate("run.dateUnknown"),
        error: reviewed.item.lastErrorCode ?? "UNKNOWN_UI"
      })
    );
    write("");
    write(translate("menu.skipWarning"));
    write("");
    const answer = await prompt.ask(translate("menu.skipQuestion"));
    if (answer !== "PULAR") {
      write(translate("menu.skipCanceled"));
      return;
    }
    await service.execute(runId, reviewed, answer);
    await recordAudit(dependencies.auditLogger ?? repositories.auditLogger, {
      event: "run.item.skipped",
      timestamp: new Date().toISOString(),
      runId,
      runItemId: reviewed.item.id,
      outcome: "SKIPPED",
      errorCode: reviewed.item.lastErrorCode
    });
    write(translate("menu.skipDone"));
  } catch {
    write(translate("menu.skipUnavailable"));
  } finally {
    repositories.close?.();
  }
}

function renderOverlapNotice(
  run: RunOverview,
  translate: CliDependencies["translator"]["translate"],
  write: (line: string) => void,
  color: boolean
): void {
  const width = 72;
  write("");
  write(tint(`╭${"─".repeat(width - 2)}╮`, "33", color));
  write(tint(boxRow(run.types.join(" + "), width), "1;33", color));
  for (const line of wrapText(
    translate(run.repeatedItems > 0 ? "menu.verificationTitle" : "menu.historyCleaning"),
    width - 4
  )) {
    write(tint(boxRow(line, width), "1;33", color));
  }
  write(`├${"─".repeat(width - 2)}┤`);
  const description =
    run.archivedAt !== null
      ? translate("menu.archiveDone")
      : run.repeatedItems > 0
        ? translate("menu.verificationPending", { count: run.pending }) +
          "\n" +
          translate("menu.overlapWarning", { count: run.overlappingPending })
        : translate("menu.cleaningPending", { count: run.pending });
  if (run.types.length > 1) {
    for (const line of wrapText(
      translate("menu.sharedPlanNote", { types: run.types.join(" + ") }),
      width - 4
    ))
      write(boxRow(line, width));
  }
  for (const paragraph of description.split("\n")) {
    for (const line of wrapText(paragraph, width - 4)) write(boxRow(line, width));
  }
  write(tint(`╰${"─".repeat(width - 2)}╯`, "33", color));
  write("");
}

function renderOverlapPreparation(
  run: RunOverview,
  handle: string,
  defaultLimit: number,
  maxLimit: number,
  translate: CliDependencies["translator"]["translate"],
  write: (line: string) => void,
  color: boolean
): void {
  const widths = [24, 41];
  const width = tableRule(widths, "┌", "┬", "┐").length;
  const rows = [
    [translate("menu.statusAccount"), `@${handle}`],
    [translate("menu.columnTypes"), run.types.join(" + ")],
    [translate("menu.preparePending"), String(run.pending)],
    [translate("menu.prepareRepeated"), String(run.overlappingPending)],
    [translate("menu.prepareQuantity"), translate("menu.prepareRange", { maxLimit })],
    [translate("menu.prepareDefault"), translate("menu.prepareDefaultValue", { defaultLimit })]
  ];
  write("");
  write(tint(`╭${"─".repeat(width - 2)}╮`, "36", color));
  write(tint(boxRow(translate("menu.prepareTitle"), width), "1;36", color));
  write(tint(`╰${"─".repeat(width - 2)}╯`, "36", color));
  write(tableRule(widths, "┌", "┬", "┐"));
  for (const row of rows) write(tableRow(row, widths));
  write(tableRule(widths, "└", "┴", "┘"));
  write("");
  for (const line of translate("menu.prepareSteps").split("\n")) write(line);
  write("");
}

function wrapText(value: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/u)) {
    if (line.length > 0 && line.length + word.length + 1 > width) {
      lines.push(line);
      line = "";
    }
    line = line.length === 0 ? word : `${line} ${word}`;
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

function renderBatchResult(
  result: RunCommandResult,
  translate: CliDependencies["translator"]["translate"],
  write: (line: string) => void,
  color: boolean
): void {
  if (result.summary === undefined) return;
  const { summary } = result;
  const width = 72;
  const state =
    summary.pauseReason !== null
      ? translate("menu.resultPaused", { reason: summary.pauseReason })
      : summary.status === "INTERRUPTED"
        ? translate("menu.resultInterrupted")
        : summary.remaining === 0
          ? translate("menu.resultFinished")
          : translate("menu.resultBatchFinished");
  write("");
  write(tint(`╭${"─".repeat(width - 2)}╮`, "36", color));
  write(tint(boxRow(translate("menu.resultTitle"), width), "1;36", color));
  write(tint(boxRow(state, width), summary.pauseReason === null ? "1;32" : "1;33", color));
  write(`├${"─".repeat(width - 2)}┤`);
  write(
    boxRow(
      translate("menu.resultBatchCounts", {
        processed: result.processedCount,
        completed: summary.completedInBatch
      }),
      width
    )
  );
  write(
    boxRow(
      translate("menu.resultPlanCounts", {
        failed: summary.failed,
        remaining: summary.remaining
      }),
      width
    )
  );
  write(tint(boxRow(translate("menu.resultVerify"), width), "33", color));
  write(tint(`╰${"─".repeat(width - 2)}╯`, "36", color));
}

async function loadMenuState(dependencies: CliDependencies, dataDirectory: string) {
  const repositories = await openCliRepositories(dependencies, dataDirectory);
  try {
    if (repositories.runs?.listRunOverviews === undefined) {
      throw new Error("RUN_OVERVIEW_UNAVAILABLE");
    }
    return {
      runs: repositories.runs.listRunOverviews(),
      handle: repositories.catalog.getManagedAccount()?.confirmedHandle ?? null
    };
  } finally {
    repositories.close?.();
  }
}

function renderMenu(
  groups: readonly RunGroup[],
  handle: string | null,
  translate: CliDependencies["translator"]["translate"],
  write: (line: string) => void,
  color: boolean
): void {
  const widths = [Math.max(2, String(groups.length).length), 10, 8, 6, 6, 7, 13, 18];
  const tableWidth = tableRule(widths, "┌", "┬", "┐").length;
  write(tint(`╭${"─".repeat(tableWidth - 2)}╮`, "36", color));
  write(tint(boxRow(translate("menu.title"), tableWidth), "1;36", color));
  const account =
    handle === null ? translate("menu.accountMissing") : translate("menu.account", { handle });
  write(tint(boxRow(account, tableWidth), "1;32", color));
  write(tint(`╰${"─".repeat(tableWidth - 2)}╯`, "36", color));
  write(translate("menu.heading"));
  if (groups.length === 0) {
    write(translate("menu.empty"));
  } else {
    write(tableRule(widths, "┌", "┬", "┐"));
    write(
      tableRow(
        [
          translate("menu.columnNumber"),
          translate("menu.columnTypes"),
          translate("menu.columnCompleted"),
          translate("menu.columnPending"),
          translate("menu.columnFailed"),
          translate("menu.columnSkipped"),
          translate("menu.columnProgress"),
          translate("menu.columnState")
        ],
        widths
      )
    );
    write(tableRule(widths, "├", "┼", "┤"));
    for (const [index, group] of groups.entries()) {
      const run = group.current;
      const counts = group.counts;
      const state =
        run.archivedAt !== null
          ? translate("menu.stateArchived")
          : run.types.length > 1 &&
              run.pending > 0 &&
              run.pauseReason === null &&
              run.status === "PAUSED"
            ? translate("menu.stateSharedPlan")
            : menuState({ ...run, ...counts }, translate);
      const row = tableRow(
        [
          String(index + 1),
          group.type,
          String(counts.processed),
          String(counts.pending),
          String(counts.failed),
          String(counts.skipped),
          progressBar({ ...run, ...counts }),
          state
        ],
        widths,
        new Set([0, 2, 3, 4, 5])
      );
      write(tint(row, run.overlappingPending > 0 || run.pauseReason !== null ? "33" : "36", color));
    }
    write(tableRule(widths, "└", "┴", "┘"));
    if (
      groups.some((group) => group.current.repeatedItems > 0 && group.current.archivedAt === null)
    ) {
      for (const line of wrapText(translate("menu.verificationNote"), tableWidth)) write(line);
    }
  }
  write("");
  write(tint(translate("menu.actions"), "1;36", color));
  if (groups.length > 0) write(translate("menu.optionChoose", { count: groups.length }));
  write(translate("menu.optionHistory"));
  write(translate("menu.optionStatus"));
  write(translate("menu.optionExit"));
}

function boxRow(value: string, width: number): string {
  const innerWidth = width - 4;
  const clipped = value.length > innerWidth ? `${value.slice(0, innerWidth - 1)}…` : value;
  return `│ ${clipped.padEnd(innerWidth)} │`;
}

function progressBar(run: RunOverview): string {
  const fraction = run.total === 0 ? 0 : Math.min(1, run.processed / run.total);
  const units = run.processed > 0 ? Math.max(1, Math.round(fraction * 64)) : 0;
  const full = Math.floor(units / 8);
  const partial = units % 8;
  const fragments = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
  const partialGlyph = fragments[partial] ?? "";
  const empty = 8 - full - (partial > 0 ? 1 : 0);
  const percent = `${Math.round(fraction * 100)}%`.padStart(4);
  return `${"█".repeat(full)}${partialGlyph}${"░".repeat(empty)} ${percent}`;
}

function tint(value: string, colorCode: string, enabled: boolean): string {
  return enabled ? `\u001b[${colorCode}m${value}\u001b[0m` : value;
}

function menuState(
  run: RunOverview,
  translate: CliDependencies["translator"]["translate"]
): string {
  if (run.pauseReason !== null) return translate("menu.statePaused");
  if (run.status === "RUNNING") return translate("menu.stateRunning");
  if (run.pending === 0)
    return translate(run.processed === run.total ? "menu.stateFinished" : "menu.stateUnavailable");
  if (run.repeatedItems > 0) return translate("menu.stateVerification");
  if (run.status === "INTERRUPTED") return translate("menu.stateInterrupted");
  return run.status === "PAUSED"
    ? translate("menu.stateReady")
    : translate("menu.stateUnavailable");
}

function tableRule(widths: readonly number[], left: string, middle: string, right: string): string {
  return `${left}${widths.map((width) => "─".repeat(width + 2)).join(middle)}${right}`;
}

function tableRow(
  values: readonly string[],
  widths: readonly number[],
  rightAligned = new Set<number>()
): string {
  return `│ ${values
    .map((value, index) => {
      const width = widths[index] ?? 0;
      const clipped = value.length > width ? `${value.slice(0, width - 1)}…` : value;
      return rightAligned.has(index) ? clipped.padStart(width) : clipped.padEnd(width);
    })
    .join(" │ ")} │`;
}
