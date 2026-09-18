import type { GeneratedReport } from "../../domain/result.js";
import type { RepositoryTransaction } from "./repository-transaction.js";

export interface ReportRepository {
  upsertGeneratedReport(
    report: GeneratedReport,
    transaction?: RepositoryTransaction
  ): GeneratedReport;
  getGeneratedReport(runId: string): GeneratedReport | null;
}
