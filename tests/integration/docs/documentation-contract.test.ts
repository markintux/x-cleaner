import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(".");

describe("contratos da documentação de beta privado", () => {
  it("cobre o fluxo seguro, limitações, privacidade e release separado", async () => {
    const readme = await read("README.md");
    const security = await read("SECURITY.md");
    const privacy = await read("PRIVACY.md");
    const contributing = await read("CONTRIBUTING.md");
    const troubleshooting = await read("docs/troubleshooting.md");
    const architecture = await read("docs/architecture.md");

    for (const topic of [
      /beta privado/iu,
      /Node\.js 24/iu,
      /Playwright/iu,
      /Archive/iu,
      /dry-run/iu,
      /APAGAR/iu,
      /--limit/iu,
      /resume/iu,
      /Application Support/iu,
      /session clear/iu,
      /irrevers[íi]vel/iu,
      /MIT/iu,
      /n[aã]o [eé] afiliad/iu
    ]) {
      expect(readme).toMatch(topic);
    }
    expect(readme).toMatch(/n[aã]o comprovam uma execu[cç][aã]o real/iu);
    expect(readme).not.toMatch(/compatibilidade do Archive real [eé] garantida/iu);
    expect(readme).not.toMatch(/autom[aá]o.*X.*[eé] est[aá]vel/iu);

    for (const topic of [/vulnerabilidade/iu, /dados sens[ií]veis/iu, /diagn[oó]stic/iu, /Archive/iu, /n[aã]o.*compartilh/iu]) {
      expect(security).toMatch(topic);
    }
    for (const topic of [/local/iu, /SQLite/iu, /browser|navegador/iu, /n[aã]o compartilhe/iu, /sint[eé]tic/iu]) {
      expect(privacy).toMatch(topic);
    }
    for (const topic of [/sint[eé]tic/iu, /seletor/iu, /npm run check/iu, /conta real/iu]) {
      expect(contributing).toMatch(topic);
    }
    for (const topic of [/sess[aã]o expirada/iu, /limite de taxa/iu, /desafio/iu, /desconhecido/iu, /lock/iu, /Archive incompat[ií]vel/iu]) {
      expect(troubleshooting).toMatch(topic);
    }
    for (const topic of [/Core/iu, /BrowserEngine/iu, /XApiEngine/iu, /i18n|cat[aá]logo/iu, /Playwright/iu]) {
      expect(architecture).toMatch(topic);
    }
  });

  it("mantém o CI multiplataforma e sem publicação", async () => {
    const workflow = await read(".github/workflows/ci.yml");
    for (const runner of ["macos-latest", "ubuntu-latest", "windows-latest"]) {
      expect(workflow).toContain(runner);
    }
    for (const command of [
      "npm ci",
      "npm run check:private-artifacts",
      "npm run format:check",
      "npm run lint",
      "npm run typecheck",
      "npm test",
      "npm run test:coverage",
      "npm run build",
      "npm run inspect:package"
    ]) {
      expect(workflow).toContain(command);
    }
    expect(workflow).toMatch(/node-version:\s*24/iu);
    expect(workflow).toMatch(/cache:\s*npm/iu);
    expect(workflow).not.toMatch(/npm\s+(?:publish|version)/iu);
    expect(workflow).not.toMatch(/(?:gh\s+release|softprops\/action-gh-release|npmjs\.com)/iu);
  });
});

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}
