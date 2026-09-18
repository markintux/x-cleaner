import type { ReportRepository } from "../../../application/ports/report-repository.js";
import type { RepositoryTransaction } from "../../../application/ports/repository-transaction.js";
import type { GeneratedReport } from "../../../domain/result.js";
import type { SqliteDatabase } from "../database.js";
import { connectionFor } from "../repository-transaction.js";

type Row = Record<string, unknown>;

/** Only privacy-safe aggregate metadata reaches this repository contract. */
export class SqliteReportRepository implements ReportRepository {
  constructor(private readonly database: SqliteDatabase) {}

  upsertGeneratedReport(
    report: GeneratedReport,
    transaction?: RepositoryTransaction
  ): GeneratedReport {
    const connection = connectionFor(this.database.connection, transaction);
    connection
      .prepare(
        `INSERT INTO generated_reports (
          id, run_id, relative_path, sha256, summary_json, generated_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          relative_path = excluded.relative_path,
          sha256 = excluded.sha256,
          summary_json = excluded.summary_json,
          generated_at = excluded.generated_at,
          updated_at = excluded.updated_at`
      )
      .run(
        report.id,
        report.runId,
        report.relativePath,
        report.sha256,
        report.summaryJson,
        report.generatedAt,
        report.createdAt,
        report.updatedAt
      );
    return this.getGeneratedReportFrom(connection, report.runId);
  }

  getGeneratedReport(runId: string): GeneratedReport | null {
    const row = this.database.connection
      .prepare("SELECT * FROM generated_reports WHERE run_id = ?")
      .get(runId);
    return row === undefined ? null : mapReport(row as Row);
  }

  private getGeneratedReportFrom(
    connection: typeof this.database.connection,
    runId: string
  ): GeneratedReport {
    const row = connection.prepare("SELECT * FROM generated_reports WHERE run_id = ?").get(runId);
    if (row === undefined) {
      throw new Error("GENERATED_REPORT_NOT_FOUND");
    }
    return mapReport(row as Row);
  }
}

function mapReport(row: Row): GeneratedReport {
  return {
    id: requiredString(row.id),
    runId: requiredString(row.run_id),
    relativePath: requiredString(row.relative_path),
    sha256: requiredString(row.sha256),
    summaryJson: requiredString(row.summary_json),
    generatedAt: requiredString(row.generated_at),
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at)
  };
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("INVALID_DATABASE_VALUE");
  }
  return value;
}
