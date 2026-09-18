import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createProgram } from "../../../src/cli/create-program.js";
import type { CliOutput } from "../../../src/cli/dependencies.js";
import { xUserId } from "../../../src/domain/interaction.js";
import { migrations } from "../../../src/infrastructure/database/migrations/index.js";
import { SqliteDatabase } from "../../../src/infrastructure/database/database.js";
import { Migrator } from "../../../src/infrastructure/database/migrator.js";
import { SqliteCatalogRepository } from "../../../src/infrastructure/database/repositories/sqlite-catalog-repository.js";
import { createTranslator } from "../../../src/i18n/translator.js";

describe("x-cleaner session", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    );
  });

  it("orienta o login visível, confirma a conta e não expõe senha", async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-session-"));
    temporaryDirectories.push(dataDirectory);
    const lines: string[] = [];
    const promptQuestions: string[] = [];
    const output: CliOutput = { writeLine: (message) => lines.push(message) };
    const program = createProgram({
      output,
      translator: createTranslator(),
      session: {
        createLoginSession: () => ({
          execute: async () => ({
            detection: {
              status: "AUTHENTICATED",
              outcome: "AUTHENTICATED",
              state: "AUTHENTICATED",
              account: { handle: "@Exemplo", xUserId: xUserId("9007199254740993") }
            },
            account: { handle: "@Exemplo", xUserId: xUserId("9007199254740993") },
            profileDirectory: path.join(dataDirectory, "browser-profile")
          })
        }),
        prompt: {
          confirm: async (question) => {
            promptQuestions.push(question);
            return true;
          }
        }
      }
    });
    program.exitOverride();

    await program.parseAsync(["session", "login", "--data-dir", dataDirectory], { from: "user" });

    expect(lines.join("\n")).toContain("site oficial do X");
    expect(lines.join("\n")).toContain("Conta detectada: @exemplo");
    expect(lines.join("\n")).toContain("confirmada");
    expect(promptQuestions).toHaveLength(1);
    expect(promptQuestions[0]).not.toMatch(/senha|password/iu);
    expect(program.helpInformation()).not.toMatch(/password/iu);

    const database = new SqliteDatabase(path.join(dataDirectory, "state.sqlite"));
    new Migrator(database).migrate(migrations);
    const account = new SqliteCatalogRepository(database).getManagedAccount();
    database.close();
    expect(account).toMatchObject({ confirmedHandle: "exemplo", xUserId: "9007199254740993" });
  });

  it("rejeita a confirmação sem criar uma conta vinculada", async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-session-"));
    temporaryDirectories.push(dataDirectory);
    const lines: string[] = [];
    const program = createProgram({
      output: { writeLine: (message) => lines.push(message) },
      translator: createTranslator(),
      session: {
        createLoginSession: () => ({
          execute: async () => authenticatedResult(dataDirectory, "conta")
        }),
        prompt: { confirm: async () => false }
      }
    });
    program.exitOverride();

    await program.parseAsync(["session", "login", "--data-dir", dataDirectory], { from: "user" });

    expect(lines.join("\n")).toContain("não confirmada");
    const database = new SqliteDatabase(path.join(dataDirectory, "state.sqlite"));
    new Migrator(database).migrate(migrations);
    expect(new SqliteCatalogRepository(database).getManagedAccount()).toBeNull();
    database.close();
  });

  it("bloqueia identidade diferente sem substituir a conta existente", async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-session-"));
    temporaryDirectories.push(dataDirectory);
    const database = new SqliteDatabase(path.join(dataDirectory, "state.sqlite"));
    new Migrator(database).migrate(migrations);
    new SqliteCatalogRepository(database).upsertManagedAccount({
      id: "account-a",
      xUserId: xUserId("111"),
      archiveHandle: "conta-a",
      confirmedHandle: "conta-a",
      confirmedAt: "2026-01-01T00:00:00.000Z"
    });
    database.close();

    const lines: string[] = [];
    const program = createProgram({
      output: { writeLine: (message) => lines.push(message) },
      translator: createTranslator(),
      session: {
        createLoginSession: () => ({
          execute: async () => authenticatedResult(dataDirectory, "conta_b", "222")
        }),
        prompt: { confirm: async () => true }
      }
    });
    program.exitOverride();

    await expect(
      program.parseAsync(["session", "login", "--data-dir", dataDirectory], { from: "user" })
    ).rejects.toThrow("ACCOUNT_IDENTITY_MISMATCH");
    expect(lines.join("\n")).toContain("não corresponde");

    const checkDatabase = new SqliteDatabase(path.join(dataDirectory, "state.sqlite"));
    new Migrator(checkDatabase).migrate(migrations);
    expect(new SqliteCatalogRepository(checkDatabase).getManagedAccount()).toMatchObject({
      id: "account-a",
      confirmedHandle: "conta-a",
      xUserId: "111"
    });
    checkDatabase.close();
  });

  it("limpa apenas o perfil dedicado e preserva o restante do diretório", async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-session-"));
    temporaryDirectories.push(dataDirectory);
    const profileDirectory = path.join(dataDirectory, "browser-profile");
    await mkdir(profileDirectory, { recursive: true });
    await writeFile(path.join(profileDirectory, "Cookies"), "synthetic-cookie");
    const preservedFiles = [
      "state.sqlite",
      "archive.zip",
      "run.ndjson",
      "checkpoint.json",
      "report.json"
    ];
    await Promise.all(
      preservedFiles.map((file) => writeFile(path.join(dataDirectory, file), file))
    );
    const lines: string[] = [];
    const program = createProgram({
      output: { writeLine: (message) => lines.push(message) },
      translator: createTranslator(),
      session: { prompt: { confirm: async () => true } }
    });
    program.exitOverride();

    await program.parseAsync(["session", "clear", "--data-dir", dataDirectory], { from: "user" });

    await expect(access(profileDirectory)).rejects.toThrow();
    await Promise.all(
      preservedFiles.map(async (file) => {
        await expect(readFile(path.join(dataDirectory, file), "utf8")).resolves.toBe(file);
      })
    );
    expect(lines.join("\n")).toContain("preservados");
  });
});

function authenticatedResult(
  dataDirectory: string,
  handle: string,
  userId = "123"
): {
  readonly detection: {
    readonly status: "AUTHENTICATED";
    readonly outcome: "AUTHENTICATED";
    readonly state: "AUTHENTICATED";
    readonly account: { readonly handle: string; readonly xUserId: ReturnType<typeof xUserId> };
  };
  readonly account: { readonly handle: string; readonly xUserId: ReturnType<typeof xUserId> };
  readonly profileDirectory: string;
} {
  const account = { handle, xUserId: xUserId(userId) };
  return {
    detection: {
      status: "AUTHENTICATED",
      outcome: "AUTHENTICATED",
      state: "AUTHENTICATED",
      account
    },
    account,
    profileDirectory: path.join(dataDirectory, "browser-profile")
  };
}
