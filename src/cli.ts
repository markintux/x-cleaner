#!/usr/bin/env node
import { createProgram } from "./cli/create-program.js";
import { consoleOutput } from "./cli/dependencies.js";
import { createTranslator } from "./i18n/translator.js";

const program = createProgram({
  output: consoleOutput,
  translator: createTranslator()
});

await program.parseAsync();
