import { describe, expect, it } from "vitest";

import {
  JavaScriptAssignmentDecoder,
  decodeJavaScriptAssignment
} from "../../../src/infrastructure/archive/ytd/javascript-assignment-decoder.js";

describe("JavaScriptAssignmentDecoder", () => {
  it("decodifica somente o array JSON de um wrapper YTD", () => {
    expect(
      decodeJavaScriptAssignment('window.YTD.tweets.part0 = [{"tweet":{"id_str":"123"}}];')
    ).toEqual([{ tweet: { id_str: "123" } }]);
  });

  it("aceita BOM e expõe a categoria do wrapper", () => {
    const decoded = new JavaScriptAssignmentDecoder().decodeAssignment(
      '\uFEFF window.YTD.account.part0 = [{"account":{}}]'
    );

    expect(decoded.category).toBe("account");
    expect(decoded.path).toBe("account.part0");
    expect(decoded.values).toEqual([{ account: {} }]);
  });

  it.each([
    'window.YTD.tweets.part0 = [{"tweet":{}}]; globalThis.pwned = true',
    'window.YTD.tweets.part0 = [{"tweet":{}}];;',
    'window.YTD.tweets.part0 = (() => [{"tweet":{}}])();',
    'window.YTD.tweets.part0 = [{"tweet":{}}] trailing'
  ])("rejeita conteúdo executável ou trailing: %s", (source) => {
    expect(() => decodeJavaScriptAssignment(source)).toThrow();
  });

  it("rejeita wrappers que não contêm um array JSON", () => {
    expect(() => decodeJavaScriptAssignment("window.YTD.tweets.part0 = {};")).toThrow(
      "UNSAFE_ARCHIVE_JAVASCRIPT"
    );
    expect(() => decodeJavaScriptAssignment("const x = []; ")).toThrow("MALFORMED_ARCHIVE_WRAPPER");
  });
});
