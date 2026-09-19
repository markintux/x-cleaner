import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("limites arquiteturais", () => {
  it("mantém serviços de aplicação independentes dos adapters concretos", async () => {
    for (const file of await typescriptFiles("src/application")) {
      const source = await readFile(path.resolve(file), "utf8");
      expect(source, file).not.toMatch(/from\s+["'][^"']*infrastructure\//u);
      expect(source, file).not.toMatch(/from\s+["'](?:playwright|node:sqlite)["']/u);
      expect(source, file).not.toMatch(/from\s+["']node:(?:fs|path)["']/u);
    }
  });

  it("mantém a composição concreta fora dos comandos da CLI", async () => {
    for (const file of await typescriptFiles("src/cli")) {
      const source = await readFile(path.resolve(file), "utf8");
      expect(source, file).not.toMatch(/from\s+["'][^"']*infrastructure\//u);
    }
  });
});

async function typescriptFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await typescriptFiles(target)));
    if (entry.isFile() && entry.name.endsWith(".ts")) files.push(target);
  }
  return files;
}
