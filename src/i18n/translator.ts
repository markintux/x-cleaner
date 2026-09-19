import {
  assertCatalogParity,
  type MessageCatalog,
  type MessageKey,
  type MessageParameters
} from "./catalog.js";
import { ptBR } from "./pt-BR.js";

const parameterPattern = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

export interface Translator {
  translate(key: MessageKey, parameters?: MessageParameters): string;
}

export function createTranslator(catalog: MessageCatalog = ptBR): Translator {
  assertCatalogParity(catalog);
  return {
    translate(key, parameters = {}) {
      return catalog[key].replace(parameterPattern, (match, parameter: string) => {
        const value = parameters[parameter];
        return value === undefined ? match : String(value);
      });
    }
  };
}
