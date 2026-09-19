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

export type LikePageEvidence = ReactionPageEvidence;
export type LikePageEvidenceKind = ReactionPageEvidenceKind;
export type LikePageInput = ReactionPageInput;
export type LikePageOptions = ReactionPageOptions;
export type LikePageResult = LikePageEvidence;

/** Evidence-only page object for removing one like at a time. */
export class LikePage {
  private readonly support: ReactionPageSupport;

  constructor(page: BrowserPagePort, options?: LikePageOptions);
  constructor(page: BrowserPagePort, expectedHandle: string, expectedInteractionId: string);
  constructor(
    page: BrowserPagePort,
    optionsOrHandle: LikePageOptions | string = {},
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
        X_SELECTORS.like.unlikeAction,
        X_TEXT_KEYS.unlike,
        X_SELECTORS.like.removedState,
        "UNLIKE_CONTROL_MISSING",
        "UNLIKE_NOT_CONFIRMED",
        X_SELECTORS.like.target,
        X_SELECTORS.like.idAttributes
      )
    );
  }

  async execute(input?: LikePageInput): Promise<LikePageEvidence> {
    return this.unlike(input);
  }

  async remove(input?: LikePageInput): Promise<LikePageEvidence> {
    return this.unlike(input);
  }

  async unlike(input?: LikePageInput): Promise<LikePageEvidence> {
    return this.support.execute(input);
  }
}

export function unlike(page: BrowserPagePort, input: LikePageInput): Promise<LikePageEvidence> {
  return new LikePage(page, input).unlike();
}
