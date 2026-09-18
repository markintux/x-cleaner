import type { NormalizedArchiveInteraction } from "./types.js";
import {
  firstString,
  interactionId,
  normalizeDate,
  preview,
  unwrapRecord,
  YtdParserError
} from "./values.js";

export interface LikeParserOptions {
  readonly sourceRelativePath: string;
}

export class LikeParser {
  parse(
    records: readonly unknown[],
    options: LikeParserOptions | string
  ): readonly NormalizedArchiveInteraction[] {
    const sourceRelativePath = typeof options === "string" ? options : options.sourceRelativePath;
    return records.map((value, index) => {
      const like = unwrapRecord(value, "like");
      const xInteractionId =
        interactionId(like, ["tweetId", "tweet_id", "tweetIdStr", "id_str"], false) ??
        idFromSupportedUrl(like);
      if (xInteractionId === null) {
        throw new YtdParserError("UNSUPPORTED_ARCHIVE_IDENTIFIER");
      }

      return {
        xInteractionId,
        type: "LIKE" as const,
        // Older like exports do not contain a trustworthy creation date.
        interactionCreatedAt: normalizeDate(like, ["created_at", "createdAt"]),
        contentPreview: preview(like, ["fullText", "full_text", "text"]),
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

export function parseLikes(
  records: readonly unknown[],
  sourceRelativePath: string
): readonly NormalizedArchiveInteraction[] {
  return new LikeParser().parse(records, sourceRelativePath);
}

function idFromSupportedUrl(record: Record<string, unknown>) {
  const value = firstString(record, ["expandedUrl", "expanded_url", "url"]);
  if (value === null) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname !== "x.com" &&
    hostname !== "www.x.com" &&
    hostname !== "twitter.com" &&
    hostname !== "www.twitter.com" &&
    hostname !== "mobile.twitter.com"
  ) {
    return null;
  }
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  const statusIndex = segments.findIndex(
    (segment) => segment === "status" || segment === "statuses"
  );
  const candidate = statusIndex >= 0 ? segments[statusIndex + 1] : undefined;
  return candidate !== undefined && /^\d+$/u.test(candidate)
    ? (candidate as NormalizedArchiveInteraction["xInteractionId"])
    : null;
}
