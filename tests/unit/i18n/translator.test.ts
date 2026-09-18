import { describe, expect, it } from "vitest";

import type { MessageCatalog } from "../../../src/i18n/catalog.js";
import { ptBR } from "../../../src/i18n/pt-BR.js";
import { createTranslator } from "../../../src/i18n/translator.js";

describe("createTranslator", () => {
  it("usa o catálogo português padrão e substitui parâmetros", () => {
    const translator = createTranslator();

    expect(translator.translate("status.dataDirectory", { dataDirectory: "/tmp/x-cleaner" })).toBe(
      "Diretório local de dados: /tmp/x-cleaner"
    );
    expect(translator.translate("status.localOnlyNotice")).toContain("somente neste computador");
  });

  it("aceita um catálogo injetado sem acoplar valores persistidos à apresentação", () => {
    const alternateCatalog: MessageCatalog = {
      ...ptBR,
      "status.dataDirectory": "Workspace: {dataDirectory}"
    };

    expect(
      createTranslator(alternateCatalog).translate("status.dataDirectory", {
        dataDirectory: "/tmp/a"
      })
    ).toBe("Workspace: /tmp/a");
  });
});
