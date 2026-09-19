import { describe, expect, it } from "vitest";

import { maskHandle, redact } from "../../../src/infrastructure/logging/redactor.js";

describe("redator de logs", () => {
  it("remove recursivamente segredos e conteúdo privado", () => {
    const canaries = {
      password: "CANARY_PASSWORD_123",
      cookie: "CANARY_COOKIE_123",
      authorization: "CANARY_AUTH_123",
      csrf: "CANARY_CSRF_123",
      session: "CANARY_SESSION_123",
      email: "canary@example.invalid",
      rawHtml: "<p>CANARY_HTML_123</p>",
      fullContent: "CANARY_FULL_CONTENT_123"
    };
    const result = redact({
      safe: "kept",
      nested: { values: [canaries, { type: "POST", count: 2 }] },
      contentPreview: "CANARY_PREVIEW_123"
    });
    const serialized = JSON.stringify(result);

    expect(serialized).toContain("kept");
    expect(serialized).toContain('"type":"POST"');
    for (const canary of Object.values(canaries)) {
      expect(serialized).not.toContain(canary);
    }
    expect(serialized).not.toContain("CANARY_PREVIEW_123");
  });

  it("mascara handles com o formato estruturado exato", () => {
    expect(maskHandle("abcdef")).toBe("@ab***ef");
    expect(maskHandle("@abcdefgh")).toBe("@ab***gh");
    expect(maskHandle("abcde")).toBe("@[redacted]");
    expect(redact({ handle: "abcdef", confirmedHandle: "abcde" })).toEqual({
      handle: "@ab***ef",
      confirmedHandle: "@[redacted]"
    });
  });
});
