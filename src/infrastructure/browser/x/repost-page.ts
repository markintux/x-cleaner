import type { BrowserPagePort } from "../browser-session.js";
import {
  ReactionPageSupport,
  reactionConfig,
  type ReactionPageEvidence,
  type ReactionPageEvidenceKind,
  type ReactionPageInput,
  type ReactionPageOptions
} from "./reaction-page-support.js";
import { X_SELECTORS, X_TEXT_KEYS } from "./selectors.js";

export type RepostPageEvidence = ReactionPageEvidence;
export type RepostPageEvidenceKind = ReactionPageEvidenceKind;
export type RepostPageInput = ReactionPageInput;
export type RepostPageOptions = ReactionPageOptions;
export type RepostPageResult = RepostPageEvidence;

/** Evidence-only page object for undoing the authenticated account's repost. */
export class RepostPage {
  private readonly support: ReactionPageSupport;

  constructor(page: BrowserPagePort, options?: RepostPageOptions);
  constructor(page: BrowserPagePort, expectedHandle: string, expectedInteractionId: string);
  constructor(
    page: BrowserPagePort,
    optionsOrHandle: RepostPageOptions | string = {},
    expectedInteractionId?: string
  ) {
    const options =
      typeof optionsOrHandle === "string"
        ? {
            expectedHandle: optionsOrHandle,
            ...(expectedInteractionId === undefined ? {} : { expectedInteractionId })
          }
        : optionsOrHandle;
    this.support = new ReactionPageSupport(
      page,
      options,
      reactionConfig(
        X_SELECTORS.repost.undoAction,
        X_TEXT_KEYS.undoRepost,
        X_SELECTORS.repost.removedState,
        "UNDO_REPOST_CONTROL_MISSING",
        "UNDO_REPOST_NOT_CONFIRMED",
        X_SELECTORS.repost.target,
        X_SELECTORS.repost.idAttributes
      )
    );
  }

  async execute(input?: RepostPageInput): Promise<RepostPageEvidence> {
    return this.undoRepost(input);
  }

  async undo(input?: RepostPageInput): Promise<RepostPageEvidence> {
    return this.undoRepost(input);
  }

  async undoRepost(input?: RepostPageInput): Promise<RepostPageEvidence> {
    return this.support.execute(input);
  }
}

export function undoRepost(
  page: BrowserPagePort,
  input: RepostPageInput
): Promise<RepostPageEvidence> {
  return new RepostPage(page, input).undoRepost();
}
