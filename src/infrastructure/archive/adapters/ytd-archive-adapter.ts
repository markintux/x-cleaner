import type { ArchiveSource } from "../../../application/ports/archive-source.js";

import { AccountParser } from "../ytd/account-parser.js";
import {
  JavaScriptAssignmentDecoder,
  type DecodedYtdAssignment
} from "../ytd/javascript-assignment-decoder.js";
import { LikeParser } from "../ytd/like-parser.js";
import { TweetParser } from "../ytd/tweet-parser.js";
import type { ParsedAccount, ParsedArchive, NormalizedArchiveInteraction } from "../ytd/types.js";

export const YTD_ADAPTER_KEY = "x-archive-ytd-v1";

export interface YtdAssignmentEvidence {
  readonly entry: string;
  readonly assignment: DecodedYtdAssignment;
}

export interface ArchiveAdapter {
  readonly key: string;
  discover(source: ArchiveSource): Promise<readonly YtdAssignmentEvidence[]>;
  parse(source: ArchiveSource, evidence?: readonly YtdAssignmentEvidence[]): Promise<ParsedArchive>;
}

export class YtdArchiveAdapter implements ArchiveAdapter {
  readonly key = YTD_ADAPTER_KEY;
  readonly #decoder = new JavaScriptAssignmentDecoder();
  readonly #accountParser = new AccountParser();
  readonly #tweetParser = new TweetParser();
  readonly #likeParser = new LikeParser();

  async discover(source: ArchiveSource): Promise<readonly YtdAssignmentEvidence[]> {
    const evidence: YtdAssignmentEvidence[] = [];
    for (const entry of await source.entries()) {
      if (!/\.(?:js|json)$/iu.test(entry.name)) continue;

      let text: string;
      try {
        text = await source.readText(entry.name);
      } catch (error) {
        // Extracted archives may contain media and other binary files. They
        // are not archive assignments and do not participate in detection.
        if (error instanceof Error && error.message === "ARCHIVE_INVALID_UTF8") {
          continue;
        }
        throw error;
      }
      if (!/^\s*\uFEFF?\s*window\.YTD\./u.test(text)) {
        continue;
      }
      const assignment = this.#decoder.decodeAssignment(text);
      if (isSupportedCategory(assignment.category)) {
        evidence.push({ entry: entry.name, assignment });
      }
    }
    return evidence;
  }

  async parse(
    source: ArchiveSource,
    evidence?: readonly YtdAssignmentEvidence[]
  ): Promise<ParsedArchive> {
    const assignments = evidence ?? (await this.discover(source));
    let account: ParsedAccount = { xUserId: null, handle: null };
    const interactions: NormalizedArchiveInteraction[] = [];

    for (const item of assignments) {
      switch (canonicalCategory(item.assignment.category)) {
        case "account":
          account = mergeAccounts(account, this.#accountParser.parse(item.assignment.values));
          break;
        case "tweets":
          interactions.push(...this.#tweetParser.parse(item.assignment.values, item.entry));
          break;
        case "like":
          interactions.push(...this.#likeParser.parse(item.assignment.values, item.entry));
          break;
        default:
          break;
      }
    }

    return { account, interactions };
  }
}

export function isSupportedCategory(category: string): boolean {
  return canonicalCategory(category) !== null;
}

export function canonicalCategory(category: string): "account" | "tweets" | "like" | null {
  switch (category.toLowerCase()) {
    case "account":
    case "accounts":
      return "account";
    case "tweet":
    case "tweets":
      return "tweets";
    case "like":
    case "likes":
      return "like";
    default:
      return null;
  }
}

function mergeAccounts(left: ParsedAccount, right: ParsedAccount): ParsedAccount {
  return {
    xUserId: left.xUserId ?? right.xUserId,
    handle: left.handle ?? right.handle
  };
}
