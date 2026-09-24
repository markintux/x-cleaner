import { stdout } from "node:process";

import type {
  BatchConfirmationSummary,
  ConfirmBatchMessages
} from "../application/runs/confirm-batch.js";
import type { Translator } from "../i18n/translator.js";

/** Terminal-only presentation; confirmation and batch persistence stay in Core. */
export function createBatchReviewMessages(translator: Translator): ConfirmBatchMessages {
  const translate = translator.translate.bind(translator);
  const color = stdout.isTTY === true && process.env.NO_COLOR === undefined;
  const headerLines = (summary: BatchConfirmationSummary) => [
    translate("run.reviewTitle"),
    translate("run.typeCounts", {
      posts: summary.countsByType.POST,
      replies: summary.countsByType.REPLY,
      reposts: summary.countsByType.REPOST,
      likes: summary.countsByType.LIKE
    }),
    translate("run.total", { count: summary.totalCount }),
    translate("run.account", { handle: summary.handle })
  ];
  const headerWidth = (summary: BatchConfirmationSummary) =>
    Math.max(72, ...headerLines(summary).map((line) => line.length + 4));

  return {
    types: (summary) => {
      const [title, counts] = headerLines(summary);
      const width = headerWidth(summary);
      return [
        "",
        tint(boxRule(width, "╭", "╮"), "36", color),
        tint(boxRow(title ?? "", width), "1;36", color),
        tint(boxRule(width, "├", "┤"), "36", color),
        boxRow(counts ?? "", width)
      ].join("\n");
    },
    total: (summary) => boxRow(headerLines(summary)[2] ?? "", headerWidth(summary)),
    account: (summary) =>
      [
        tint(boxRow(headerLines(summary)[3] ?? "", headerWidth(summary)), "1;32", color),
        tint(boxRule(headerWidth(summary), "╰", "╯"), "36", color)
      ].join("\n"),
    items: (summary) => {
      const itemRows = summary.items.map((item, index) => [
        String(index + 1),
        item.type,
        item.xInteractionId,
        item.interactionCreatedAt ?? translate("run.dateUnknown")
      ]);
      const headers = [
        translate("run.columnNumber"),
        translate("run.columnType"),
        translate("run.columnId"),
        translate("run.columnDate")
      ];
      const widths = headers.map((header, index) =>
        Math.max(header.length, ...itemRows.map((row) => row[index]?.length ?? 0))
      );
      const table = [
        tableRule(widths, "┌", "┬", "┐"),
        tableRow(headers, widths),
        tableRule(widths, "├", "┼", "┤"),
        ...itemRows.map((row) => tableRow(row, widths)),
        tableRule(widths, "└", "┴", "┘")
      ];
      return `\n${translate("run.items", { items: table.join("\n") })}`;
    },
    warning: (() => {
      const warning = translate("run.warning");
      const width = Math.max(72, warning.length + 4);
      return [
        "",
        tint(boxRule(width, "╭", "╮"), "1;31", color),
        tint(boxRow(warning, width), "1;31", color),
        tint(boxRule(width, "╰", "╯"), "1;31", color)
      ].join("\n");
    })(),
    instruction: [
      tint(translate("run.confirmInstruction"), "1;33", color),
      translate("run.cancelHint")
    ].join("\n"),
    question: translate("run.confirmQuestion")
  };
}

function boxRule(width: number, left: string, right: string): string {
  return `${left}${"─".repeat(width - 2)}${right}`;
}

function boxRow(value: string, width: number): string {
  return `│ ${value.padEnd(width - 4)} │`;
}

function tableRule(widths: readonly number[], left: string, middle: string, right: string): string {
  return `${left}${widths.map((width) => "─".repeat(width + 2)).join(middle)}${right}`;
}

function tableRow(values: readonly string[], widths: readonly number[]): string {
  return `│ ${values.map((value, index) => value.padEnd(widths[index] ?? 0)).join(" │ ")} │`;
}

function tint(value: string, colorCode: string, enabled: boolean): string {
  return enabled ? `\u001b[${colorCode}m${value}\u001b[0m` : value;
}
