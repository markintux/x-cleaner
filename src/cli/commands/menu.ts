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
      renderMenu(runs, handle, translate, write, color);
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
      if (!/^[1-9][0-9]*$/u.test(choice)) {
        write(translate("menu.invalidChoice"));
        continue;
      }
      const run = runs[Number(choice) - 1];
      if (run === undefined) {
        write(translate("menu.invalidChoice"));
        continue;
      }
      if (
        handle === null ||
        run.pending === 0 ||
        (run.status !== "PAUSED" && run.status !== "INTERRUPTED")
      ) {
        write(translate("menu.unavailable"));
        continue;
      }
      if (run.overlappingPending > 0) {
        write(translate("menu.overlapBlocked"));
        continue;
      }
      if (run.pauseReason !== null) {
        write(translate("menu.pauseBlocked", { reason: run.pauseReason }));
        continue;
      }

      const defaultLimit = Math.min(5, run.pending);
      const maxLimit = Math.min(maxBatchLimit, run.pending);
      const entered = (
        await prompt.ask(translate("menu.limitQuestion", { defaultLimit, maxLimit }))
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
  runs: readonly RunOverview[],
  handle: string | null,
  translate: CliDependencies["translator"]["translate"],
  write: (line: string) => void,
  color: boolean
): void {
  const widths = [Math.max(2, String(runs.length).length), 10, 6, 6, 6, 13, 12];
  const tableWidth = tableRule(widths, "┌", "┬", "┐").length;
  write(tint(`╭${"─".repeat(tableWidth - 2)}╮`, "36", color));
  write(tint(boxRow(translate("menu.title"), tableWidth), "1;36", color));
  const account =
    handle === null ? translate("menu.accountMissing") : translate("menu.account", { handle });
  write(tint(boxRow(account, tableWidth), "1;32", color));
  write(tint(`╰${"─".repeat(tableWidth - 2)}╯`, "36", color));
  write(translate("menu.heading"));
  if (runs.length === 0) {
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
          translate("menu.columnProgress"),
          translate("menu.columnState")
        ],
        widths
      )
    );
    write(tableRule(widths, "├", "┼", "┤"));
    for (const [index, run] of runs.entries()) {
      const state = menuState(run, translate);
      const row = tableRow(
        [
          String(index + 1),
          run.types.join("+"),
          String(run.completed),
          String(run.pending),
          String(run.failed),
          progressBar(run),
          state
        ],
        widths,
        new Set([0, 2, 3, 4])
      );
      write(tint(row, run.overlappingPending > 0 || run.pauseReason !== null ? "33" : "36", color));
    }
    write(tableRule(widths, "└", "┴", "┘"));
    if (runs.some((run) => run.overlappingPending > 0)) {
      write(translate("menu.overlapNote"));
    }
  }
  write("");
  write(tint(translate("menu.actions"), "1;36", color));
  if (runs.length > 0) write(translate("menu.optionChoose", { count: runs.length }));
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
  if (run.overlappingPending > 0) return translate("menu.stateOverlapping");
  if (run.pauseReason !== null) return translate("menu.statePaused");
  if (run.pending === 0) return translate("menu.stateUnavailable");
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
