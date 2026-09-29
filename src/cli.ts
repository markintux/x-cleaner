#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createCompositionRoot, type CompositionRoot } from "./composition-root.js";
import { createProgram, isSuccessfulCommanderExit, reportCliError } from "./cli/create-program.js";

export async function runCli(
  arguments_: readonly string[] = process.argv,
  root: CompositionRoot = createCompositionRoot()
): Promise<number> {
  const program = createProgram(root.dependencies);
  program.exitOverride();
  try {
    await program.parseAsync([...arguments_]);
    return 0;
  } catch (error) {
    if (isSuccessfulCommanderExit(error)) return 0;
    const diagnostics = Boolean(program.opts<{ diagnostics?: boolean }>().diagnostics);
    return reportCliError(error, root.dependencies, diagnostics);
  } finally {
    await root.close();
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && isMainModule(entryPoint)) {
  process.exitCode = await runCli();
}

function isMainModule(entryPoint: string): boolean {
  try {
    return realpathSync(entryPoint) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
