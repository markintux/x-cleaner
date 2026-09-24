import type {
  ExecutionProgressEvent,
  ExecutionProgressReporter
} from "../application/ports/execution-progress.js";
import type { Translator } from "../i18n/translator.js";
import { createTranslator } from "../i18n/translator.js";

export interface CliExecutionProgressOptions {
  readonly translator?: Translator;
  readonly writeLine: (message: string) => void;
  readonly compact?: boolean;
}

const UNKNOWN = "?";

/**
 * Renders the live execution feed. It shows the persisted boundary an operator
 * needs before sending a manual interrupt, and prints no interaction content.
 */
export class CliExecutionProgress implements ExecutionProgressReporter {
  readonly #translator: Translator;
  readonly #writeLine: (message: string) => void;
  readonly #compact: boolean;

  constructor(options: CliExecutionProgressOptions) {
    this.#translator = options.translator ?? createTranslator();
    this.#writeLine = options.writeLine;
    this.#compact = options.compact ?? false;
  }

  report(event: ExecutionProgressEvent): void {
    if (this.#compact && event.kind === "ITEM_STARTED") return;
    this.#writeLine(this.line(event));
  }

  private line(event: ExecutionProgressEvent): string {
    if (event.kind === "WAITING") {
      if (this.#compact) {
        return this.#translator.translate("menu.progressWaiting", {
          seconds: Math.round(event.milliseconds / 1000)
        });
      }
      return this.#translator.translate("run.progressWaiting", {
        seconds: Math.round(event.milliseconds / 1000),
        position: event.nextPosition,
        total: event.total ?? UNKNOWN
      });
    }
    const common = {
      position: event.position,
      total: event.total ?? UNKNOWN,
      type: event.type ?? UNKNOWN,
      xInteractionId: event.xInteractionId ?? UNKNOWN,
      attemptNumber: event.attemptNumber
    };
    if (event.kind === "ITEM_STARTED") {
      return this.#translator.translate("run.progressItemStarted", common);
    }
    if (this.#compact) {
      return this.#translator.translate(
        event.errorCode === null ? "menu.progressFinished" : "menu.progressFailed",
        {
          position: event.position,
          total: event.total ?? UNKNOWN,
          type: event.type ?? UNKNOWN,
          outcome: event.outcome,
          errorCode: event.errorCode ?? UNKNOWN
        }
      );
    }
    return this.#translator.translate(
      event.errorCode === null ? "run.progressItemFinished" : "run.progressItemFailed",
      {
        ...common,
        outcome: event.outcome,
        status: event.status,
        durationMs: event.durationMs,
        errorCode: event.errorCode ?? UNKNOWN
      }
    );
  }
}
