import { describe, expect, it } from "vitest";

import { resolveApplicationDataDirectory } from "../../../src/platform/application-data.js";

describe("resolveApplicationDataDirectory", () => {
  it("usa a convenção por usuário no macOS", () => {
    expect(
      resolveApplicationDataDirectory({
        platform: "darwin",
        homeDirectory: "/Users/ana",
        environment: {}
      })
    ).toBe("/Users/ana/Library/Application Support/x-cleaner");
  });

  it("usa XDG_DATA_HOME no Linux e não o repositório", () => {
    expect(
      resolveApplicationDataDirectory({
        platform: "linux",
        homeDirectory: "/home/ana",
        environment: { XDG_DATA_HOME: "/var/local/ana" }
      })
    ).toBe("/var/local/ana/x-cleaner");
  });

  it("usa o diretório de dados padrão do Linux quando XDG_DATA_HOME não existe", () => {
    expect(
      resolveApplicationDataDirectory({
        platform: "linux",
        homeDirectory: "/home/ana",
        environment: {}
      })
    ).toBe("/home/ana/.local/share/x-cleaner");
  });

  it("usa LOCALAPPDATA no Windows", () => {
    expect(
      resolveApplicationDataDirectory({
        platform: "win32",
        homeDirectory: "C:\\Users\\Ana",
        environment: { LOCALAPPDATA: "C:\\Users\\Ana\\AppData\\Local" }
      })
    ).toBe("C:\\Users\\Ana\\AppData\\Local\\x-cleaner");
  });

  it.each([
    ["darwin", "/tmp/teste", "dados-isolados", "/tmp/teste/dados-isolados"],
    ["linux", "/tmp/teste", "dados-isolados", "/tmp/teste/dados-isolados"],
    ["win32", "C:\\teste", "dados-isolados", "C:\\teste\\dados-isolados"]
  ] as const)(
    "resolve uma substituição explícita isolada no %s",
    (platform, cwd, dataDir, expected) => {
      expect(resolveApplicationDataDirectory({ platform, cwd, dataDir })).toBe(expected);
    }
  );
});
