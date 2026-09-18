import { describe, expect, it } from "vitest";

import { parseAccount } from "../../../src/infrastructure/archive/ytd/account-parser.js";
import { parseLikes } from "../../../src/infrastructure/archive/ytd/like-parser.js";
import { parseTweets } from "../../../src/infrastructure/archive/ytd/tweet-parser.js";

describe("parsers YTD sintéticos", () => {
  it("extrai a conta sem inventar ID ou handle", () => {
    expect(
      parseAccount([{ account: { accountId: "90071992547409931234", userName: "@synthetic" } }])
    ).toEqual({ xUserId: "90071992547409931234", handle: "synthetic" });
    expect(parseAccount([{ account: {} }])).toEqual({ xUserId: null, handle: null });
    expect(() => parseAccount([{ account: { accountId: 123 } }])).toThrow(
      "UNSUPPORTED_ARCHIVE_IDENTIFIER"
    );
  });

  it("classifica post, resposta e repost por evidência explícita", () => {
    const interactions = parseTweets(
      [
        { tweet: { id_str: "101", full_text: "post" } },
        { tweet: { id_str: "102", in_reply_to_status_id_str: "99" } },
        { tweet: { id_str: "103", retweeted_status_id_str: "98" } }
      ],
      "nested/records.js"
    );

    expect(interactions.map((interaction) => interaction.type)).toEqual([
      "POST",
      "REPLY",
      "REPOST"
    ]);
    expect(
      interactions.every((interaction) => interaction.sourceRelativePath === "nested/records.js")
    ).toBe(true);
  });

  it("preserva data ausente como null e limita preview por code points Unicode", () => {
    const preview = "😀".repeat(280) + "não deve aparecer";
    const [interaction] = parseTweets(
      [{ tweet: { id_str: "104", full_text: preview } }],
      "tweets.js"
    );

    expect(interaction?.interactionCreatedAt).toBeNull();
    expect(interaction?.contentPreview).toBe("😀".repeat(280));
    expect(Array.from(interaction?.contentPreview ?? [])).toHaveLength(280);
  });

  it("normaliza likes pelo ID declarado ou por URL X suportada", () => {
    const interactions = parseLikes(
      [
        { like: { tweetId: "90071992547409931238" } },
        { like: { expandedUrl: "https://x.com/synthetic/status/90071992547409931239" } }
      ],
      "likes.js"
    );

    expect(
      interactions.map((interaction) => [interaction.type, interaction.xInteractionId])
    ).toEqual([
      ["LIKE", "90071992547409931238"],
      ["LIKE", "90071992547409931239"]
    ]);
    expect(interactions.every((interaction) => interaction.interactionCreatedAt === null)).toBe(
      true
    );
    expect(() => parseLikes([{ like: { tweetId: 123 } }], "likes.js")).toThrow(
      "UNSUPPORTED_ARCHIVE_IDENTIFIER"
    );
    expect(() =>
      parseLikes([{ like: { expandedUrl: "https://evil.example/status/123" } }], "likes.js")
    ).toThrow("UNSUPPORTED_ARCHIVE_IDENTIFIER");
  });
});
