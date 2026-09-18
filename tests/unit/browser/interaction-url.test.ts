import { describe, expect, it } from "vitest";

import {
  InteractionUrlError,
  buildInteractionUrl,
  buildStatusUrl,
  interactionUrl
} from "../../../src/infrastructure/browser/x/interaction-url.js";

describe("URLs de status do X", () => {
  it("reconstrói somente o formato canônico com ID decimal e handle confirmado", () => {
    expect(buildInteractionUrl("@Dono_Conta", "9007199254740993")).toBe(
      "https://x.com/dono_conta/status/9007199254740993"
    );
    expect(buildStatusUrl("dono_conta", "12")).toBe("https://x.com/dono_conta/status/12");
    expect(interactionUrl("dono_conta", "12")).toBe("https://x.com/dono_conta/status/12");
    expect(buildInteractionUrl("12", "dono_conta")).toBe("https://x.com/dono_conta/status/12");
  });

  it.each([
    ["https://evil.example/owner", "12"],
    ["owner/status/12", "12"],
    ["owner?redirect=https://evil.example", "12"],
    ["owner", "12/other"],
    ["owner", "-1"],
    ["owner", "1.5"],
    ["owner", ""]
  ])("rejeita entrada hostil %j", (handle, id) => {
    expect(() => buildInteractionUrl(handle, id)).toThrow(InteractionUrlError);
  });
});
