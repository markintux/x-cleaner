import type { InteractionType, XInteractionId } from "../../domain/interaction.js";
import type { AttemptOutcome } from "../../domain/result.js";
import type { CleaningRunItemStatus } from "../../domain/run.js";

export interface ExecutionProgressItem {
  /** Position of this item inside the confirmed batch, starting at 1. */
  readonly position: number;
  /** Confirmed batch limit, or null when the batch was confirmed without one. */
  readonly total: number | null;
  readonly sequence: number;
  readonly type: InteractionType | null;
  readonly xInteractionId: XInteractionId | null;
  readonly attemptNumber: number;
}

export type ExecutionProgressEvent =
  | ({ readonly kind: "ITEM_STARTED" } & ExecutionProgressItem)
  | ({
      readonly kind: "ITEM_FINISHED";
      readonly outcome: AttemptOutcome;
      readonly status: CleaningRunItemStatus;
      readonly errorCode: string | null;
      readonly durationMs: number;
    } & ExecutionProgressItem)
  | {
      readonly kind: "WAITING";
      readonly milliseconds: number;
      readonly nextPosition: number;
      readonly total: number | null;
    };

/**
 * A language-neutral execution feed. It exists so an operator can see the
 * persisted boundary a manual interrupt is supposed to land on; it carries no
 * post content and never influences the durable outcome.
 */
export interface ExecutionProgressReporter {
  report(event: ExecutionProgressEvent): void;
}

/** Progress rendering must never turn a safe domain transition into a failure. */
export function reportProgress(
  reporter: ExecutionProgressReporter | undefined,
  event: ExecutionProgressEvent
): void {
  if (reporter === undefined) return;
  try {
    reporter.report(event);
  } catch {
    // The durable SQLite state remains authoritative when rendering fails.
  }
}
