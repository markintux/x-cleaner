import { describe, expect, it } from "vitest";

import {
  assertNonEmptySelection,
  SelectionValidationError,
  validateSelection
} from "../../../src/domain/selection.js";

function expectSelectionError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("EXPECTED_SELECTION_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(SelectionValidationError);
    expect((error as SelectionValidationError).code).toBe(code);
  }
}

describe("selection filters", () => {
  it("aceita um ou mais tipos suportados e remove repetições", () => {
    expect(validateSelection({ types: ["POST", "like", "POST"] })).toEqual({
      types: ["POST", "LIKE"],
      fromAt: null,
      toAt: null
    });
  });

  it("normaliza limites de data inclusivos para UTC", () => {
    expect(
      validateSelection({
        types: ["POST"],
        from: "2026-01-02",
        to: "2026-01-02"
      })
    ).toEqual({
      types: ["POST"],
      fromAt: "2026-01-02T00:00:00.000Z",
      toAt: "2026-01-02T23:59:59.999Z"
    });
    expect(validateSelection({ types: ["LIKE"], from: "2026-01-02T03:04:05-03:00" }).fromAt).toBe(
      "2026-01-02T06:04:05.000Z"
    );
  });

  it("rejeita tipos não suportados, datas inválidas e intervalos invertidos", () => {
    expectSelectionError(
      () => validateSelection({ types: ["BOOKMARK"] }),
      "SELECTION_TYPE_UNSUPPORTED"
    );
    expectSelectionError(
      () => validateSelection({ types: ["POST"], from: "2026-02-30" }),
      "SELECTION_DATE_INVALID"
    );
    expectSelectionError(
      () => validateSelection({ types: ["POST"], from: "2026-02-30T00:00:00Z" }),
      "SELECTION_DATE_INVALID"
    );
    expectSelectionError(
      () =>
        validateSelection({
          types: ["POST"],
          from: "2026-02-03",
          to: "2026-02-02"
        }),
      "SELECTION_DATE_RANGE_INVERTED"
    );
  });

  it("rejeita filtros sem tipos e resultados vazios", () => {
    expectSelectionError(() => validateSelection({ types: [] }), "SELECTION_EMPTY");
    expectSelectionError(() => assertNonEmptySelection([]), "SELECTION_EMPTY");
  });
});
