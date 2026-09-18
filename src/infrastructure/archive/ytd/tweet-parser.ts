import type { InteractionType } from "../../../domain/interaction.js";

import type { NormalizedArchiveInteraction } from "./types.js";
import {
  booleanEvidence,
  firstString,
  hasPresentValue,
  interactionId,
  normalizeDate,
  preview,
  unwrapRecord,
  YtdParserError
} from "./values.js";

export interface TweetParserOptions {
  readonly sourceRelativePath: string;
}

export class TweetParser {
  parse(
    records: readonly unknown[],
    options: TweetParserOptions | string
  ): readonly NormalizedArchiveInteraction[] {
    const sourceRelativePath = typeof options === "string" ? options : options.sourceRelativePath;
    return records.map((value, index) => {
      const tweet = unwrapRecord(value, "tweet");
      const xInteractionId = interactionId(tweet, ["id_str", "id", "tweetId", "tweet_id"]);
      if (xInteractionId === null) {
        throw new YtdParserError("MALFORMED_ARCHIVE_RECORD");
      }

      return {
        xInteractionId,
        type: classifyTweet(tweet),
        interactionCreatedAt: normalizeDate(tweet, ["created_at", "createdAt", "created_at_utc"]),
        contentPreview: preview(tweet, ["full_text", "text", "content", "note_text"]),
        sourceRelativePath,
        sourceRecordKey: String(index)
      };
    });
  }

  parseRecords(
    records: readonly unknown[],
    sourceRelativePath: string
  ): readonly NormalizedArchiveInteraction[] {
    return this.parse(records, sourceRelativePath);
  }
}

export function parseTweets(
  records: readonly unknown[],
  sourceRelativePath: string
): readonly NormalizedArchiveInteraction[] {
  return new TweetParser().parse(records, sourceRelativePath);
}

function classifyTweet(tweet: Record<string, unknown>): InteractionType {
  const explicitType = firstString(tweet, ["interaction_type", "interactionType", "archive_type"]);
  if (explicitType !== null) {
    const normalized = explicitType.toUpperCase();
    if (normalized === "POST" || normalized === "REPLY" || normalized === "REPOST") {
      return normalized;
    }
    throw new YtdParserError("MALFORMED_ARCHIVE_RECORD");
  }

  // These fields are archive evidence. The text prefix "RT @" is deliberately
  // not used because it is content, not proof that X recorded a repost.
  if (
    hasPresentValue(tweet, [
      "retweeted_status_id_str",
      "retweeted_status_id",
      "retweeted_status",
      "retweetedStatusId",
      "retweet_id"
    ]) ||
    booleanEvidence(tweet, ["is_retweet", "isRetweet", "retweeted"])
  ) {
    return "REPOST";
  }

  if (
    hasPresentValue(tweet, [
      "in_reply_to_status_id_str",
      "in_reply_to_status_id",
      "in_reply_to_user_id_str",
      "in_reply_to_user_id",
      "in_reply_to_screen_name",
      "inReplyToStatusId"
    ])
  ) {
    return "REPLY";
  }

  return "POST";
}
