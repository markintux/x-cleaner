import type { Translator } from "../i18n/translator.js";

export interface CliOutput {
  writeLine(message: string): void;
}

export interface CliDependencies {
  readonly output: CliOutput;
  readonly translator: Translator;
}

export const consoleOutput: CliOutput = {
  writeLine(message) {
    process.stdout.write(`${message}\n`);
  }
};
