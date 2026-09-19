import type { InteractionType } from "../domain/interaction.js";
import type { ProgressCounts, RunProgress } from "../application/progress/get-run-progress.js";
import type { Translator } from "../i18n/translator.js";
import { createTranslator } from "../i18n/translator.js";

const orderedTypes: readonly InteractionType[] = ["POST", "REPLY", "REPOST", "LIKE"];

export interface ProgressRendererOptions {
  readonly translator?: Translator;
  readonly includeZeroTypes?: boolean;
}

/** Renders only aggregate progress; interaction content is not part of this API. */
export class ProgressRenderer {
  readonly #translator: Translator;
  readonly #includeZeroTypes: boolean;

  constructor(options: ProgressRendererOptions = {}) {
    this.#translator = options.translator ?? createTranslator();
    this.#includeZeroTypes = options.includeZeroTypes ?? true;
  }

  render(progress: RunProgress): readonly string[] {
    const lines = [this.#translator.translate("progress.header", { state: progress.state })];
    for (const type of orderedTypes) {
      const counts = progress.byType[type];
      if (!this.#includeZeroTypes && counts.total === 0) continue;
      lines.push(this.typeLine(type, counts));
    }
    lines.push(this.totalLine(progress.counts));
    if (progress.pauseReason !== null) {
      lines.push(this.#translator.translate("progress.pause", { reason: progress.pauseReason }));
    }
    return lines;
  }

  renderText(progress: RunProgress): string {
    return this.render(progress).join("\n");
  }

  private typeLine(type: InteractionType, counts: ProgressCounts): string {
    return this.#translator.translate("progress.type", {
      type,
      completed: counts.completed,
      remaining: counts.remaining,
      skipped: counts.skipped,
      terminal: counts.terminalNonError,
      failed: counts.failed,
      retry: counts.retry
    });
  }

  private totalLine(counts: ProgressCounts): string {
    return this.#translator.translate("progress.total", {
      total: counts.total,
      completed: counts.completed,
      remaining: counts.remaining,
      skipped: counts.skipped,
      terminal: counts.terminalNonError,
      failed: counts.failed,
      paused: counts.paused,
      retry: counts.retry
    });
  }
}

export function renderProgress(
  progress: RunProgress,
  options: ProgressRendererOptions = {}
): readonly string[] {
  return new ProgressRenderer(options).render(progress);
}
