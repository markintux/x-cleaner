import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  sanitizeFailureCode,
  type RunReport
} from "../../application/reports/generate-run-report.js";
import type { ReportRepository } from "../../application/ports/report-repository.js";
import type { GeneratedReport } from "../../domain/result.js";
import { resolveUnderDirectory, validateRelativePath } from "../logging/ndjson-logger.js";

export interface JsonReportWriterOptions {
  readonly reports?: ReportRepository;
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly relativePath?: string;
}

type ReportRepositoryOrOptions = JsonReportWriterOptions | ReportRepository;

export interface WrittenJsonReport {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly report: GeneratedReport;
}

/** Atomically writes the exact UTF-8 bytes represented by a privacy-safe report. */
export class JsonReportWriter {
  readonly #dataDirectory: string;
  readonly #reports: ReportRepository | undefined;
  readonly #now: () => string;
  readonly #idFactory: () => string;
  readonly #relativePath: string | undefined;

  constructor(dataDirectory: string, options?: ReportRepositoryOrOptions);
  constructor(options: JsonReportWriterOptions & { readonly dataDirectory: string });
  constructor(
    dataDirectoryOrOptions: string | (JsonReportWriterOptions & { readonly dataDirectory: string }),
    options: ReportRepositoryOrOptions = {}
  ) {
    const normalizedOptions: JsonReportWriterOptions =
      "upsertGeneratedReport" in options ? { reports: options } : options;
    const resolved =
      typeof dataDirectoryOrOptions === "string"
        ? { dataDirectory: dataDirectoryOrOptions, ...normalizedOptions }
        : dataDirectoryOrOptions;
    this.#dataDirectory = path.resolve(resolved.dataDirectory);
    this.#reports = resolved.reports;
    this.#now = resolved.now ?? (() => new Date().toISOString());
    this.#idFactory = resolved.idFactory ?? randomUUID;
    this.#relativePath =
      resolved.relativePath === undefined ? undefined : validateRelativePath(resolved.relativePath);
  }

  async write(report: RunReport, relativePath?: string): Promise<WrittenJsonReport> {
    const selectedPath = validateRelativePath(
      relativePath ?? this.#relativePath ?? `reports/${safeFilePart(report.runId)}.json`
    );
    const absolutePath = resolveUnderDirectory(this.#dataDirectory, selectedPath);
    const safeReport: RunReport = {
      ...report,
      failureSummaries: report.failureSummaries.map(sanitizeFailureCode)
    };
    const bytes = Buffer.from(`${JSON.stringify(safeReport, null, 2)}\n`, "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await mkdir(path.dirname(absolutePath), { recursive: true });
    const temporaryPath = `${absolutePath}.${process.pid}.${this.#idFactory()}.tmp`;
    try {
      await writeFile(temporaryPath, bytes, { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, absolutePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }

    const generatedAt = this.#now();
    const existing = this.#reports?.getGeneratedReport(report.runId) ?? null;
    const metadata: GeneratedReport = {
      id: existing?.id ?? this.#idFactory(),
      runId: report.runId,
      relativePath: selectedPath,
      sha256,
      summaryJson: JSON.stringify(safeReport),
      generatedAt,
      createdAt: existing?.createdAt ?? generatedAt,
      updatedAt: generatedAt
    };
    const persisted = this.#reports?.upsertGeneratedReport(metadata) ?? metadata;
    return {
      relativePath: selectedPath,
      absolutePath,
      sha256,
      bytes: bytes.byteLength,
      report: persisted
    };
  }

  generate(report: RunReport, relativePath?: string): Promise<WrittenJsonReport> {
    return this.write(report, relativePath);
  }
}

export async function writeJsonReport(
  dataDirectory: string,
  report: RunReport,
  options: JsonReportWriterOptions = {}
): Promise<WrittenJsonReport> {
  return new JsonReportWriter(dataDirectory, options).write(report);
}

function safeFilePart(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]/gu, "_");
  return safe === "" || safe === "." || safe === ".." ? "run" : safe;
}
