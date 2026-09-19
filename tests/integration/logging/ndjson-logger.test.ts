import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  auditEventNames,
  NdjsonLogger,
  resolveUnderDirectory
} from "../../../src/infrastructure/logging/ndjson-logger.js";

describe("logger NDJSON local", () => {
  it("grava eventos válidos, redige canários e preserva a fronteira local", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-phase-12-log-"));
    try {
      const logger = new NdjsonLogger(directory, "logs/audit.ndjson");
      await Promise.all([
        logger.log({
          event: "account.confirmed",
          timestamp: "2026-09-18T12:00:00.000Z",
          handle: "abcdef",
          password: "CANARY_PASSWORD",
          nested: { cookie: "CANARY_COOKIE", email: "canary@example.invalid" }
        }),
        logger.log({
          event: "run.completed",
          runId: "run-synthetic",
          counts: { completed: 2 }
        })
      ]);
      const bytes = await readFile(logger.outputPath);
      const text = bytes.toString("utf8");
      const lines = text
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({ event: "account.confirmed", handle: "@ab***ef" });
      expect(text).not.toContain("CANARY_PASSWORD");
      expect(text).not.toContain("CANARY_COOKIE");
      expect(text).not.toContain("canary@example.invalid");
      expect(path.relative(directory, logger.outputPath).replaceAll(path.sep, "/")).toBe(
        "logs/audit.ndjson"
      );
      expect(bytes.toString("utf8")).toContain("\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejeita saída absoluta ou que escape do diretório de dados", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-phase-12-log-path-"));
    try {
      expect(() => new NdjsonLogger(directory, path.join(directory, "outside.ndjson"))).toThrow(
        "INVALID_AUDIT_OUTPUT_PATH"
      );
      expect(() => new NdjsonLogger(directory, "../outside.ndjson")).toThrow(
        "INVALID_AUDIT_OUTPUT_PATH"
      );
      expect(() => new NdjsonLogger(directory, "C:outside.ndjson")).toThrow(
        "INVALID_AUDIT_OUTPUT_PATH"
      );
      expect(() => resolveUnderDirectory(directory, "C:outside.ndjson")).toThrow(
        "INVALID_AUDIT_OUTPUT_PATH"
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("registra cada gatilho de auditoria documentado como objeto independente", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-phase-12-audit-events-"));
    try {
      const logger = new NdjsonLogger(directory);
      for (const event of auditEventNames) {
        await logger.append({ event, timestamp: "2026-09-18T12:00:00.000Z" });
      }
      const lines = (await readFile(logger.outputPath, "utf8"))
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as { event: string });
      expect(lines.map((line) => line.event)).toEqual([...auditEventNames]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
