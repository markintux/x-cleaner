import { GenerateRunReport } from "../../application/reports/generate-run-report.js";
import { JsonReportWriter } from "../../infrastructure/reports/json-report-writer.js";
import {
  openCliRepositories,
  type CliDependencies,
  type CliRepositories,
  resolveCliDataDirectory
} from "../dependencies.js";
import { ProgressRenderer } from "../progress-renderer.js";
import type { RunProgress } from "../../application/progress/get-run-progress.js";

export interface ReportCommandOptions {
  readonly dataDir?: string;
}

export interface ReportCommandResult {
  readonly runId: string;
  readonly relativePath: string;
  readonly sha256: string;
}

export function createReportCommand(
  dependencies: CliDependencies
): (runId: string, options: ReportCommandOptions) => Promise<ReportCommandResult> {
  return async (runId, options) => {
    const dataDirectory = resolveCliDataDirectory(dependencies, options.dataDir);
    const repositories = await openRepositories(dependencies, dataDirectory);
    try {
      if (repositories.runs === undefined) {
        throw new Error("REPORT_REPOSITORIES_NOT_CONFIGURED");
      }
      const report = new GenerateRunReport({ runs: repositories.runs }).execute(runId);
      const writer =
        dependencies.reportWriterFactory?.(dataDirectory, repositories.reports) ??
        new JsonReportWriter(dataDirectory, {
          ...(repositories.reports === undefined ? {} : { reports: repositories.reports }),
          ...(dependencies.clock === undefined
            ? {}
            : { now: dependencies.clock.now.bind(dependencies.clock) })
        });
      const written = await writer.write(report);
      const renderer = new ProgressRenderer({ translator: dependencies.translator });
      const progress: RunProgress = {
        runId: report.runId,
        state: report.state,
        pauseReason: report.pauseReason,
        counts: report.counts,
        byType: report.counts.byType,
        total: report.counts.total,
        completed: report.counts.completed,
        remaining: report.counts.remaining,
        skipped: report.counts.skipped,
        terminalNonError: report.counts.terminalNonError,
        failed: report.counts.failed,
        paused: report.counts.paused,
        retry: report.counts.retry
      };
      for (const line of renderer.render(progress)) {
        dependencies.output.writeLine(line);
      }
      dependencies.output.writeLine(
        dependencies.translator.translate("report.generated", { runId: report.runId })
      );
      dependencies.output.writeLine(
        dependencies.translator.translate("report.state", { state: report.state })
      );
      dependencies.output.writeLine(
        dependencies.translator.translate("report.total", {
          total: report.counts.total,
          completed: report.counts.completed,
          remaining: report.counts.remaining,
          skipped: report.counts.skipped,
          terminal: report.counts.terminalNonError,
          failed: report.counts.failed,
          paused: report.counts.paused,
          retry: report.counts.retry
        })
      );
      for (const type of ["POST", "REPLY", "REPOST", "LIKE"] as const) {
        const counts = report.counts.byType[type];
        dependencies.output.writeLine(
          dependencies.translator.translate("report.type", {
            type,
            total: counts.total,
            completed: counts.completed,
            remaining: counts.remaining,
            skipped: counts.skipped,
            terminal: counts.terminalNonError,
            failed: counts.failed,
            retry: counts.retry
          })
        );
      }
      for (const failure of report.failureSummaries) {
        dependencies.output.writeLine(
          dependencies.translator.translate("report.failure", { failure })
        );
      }
      dependencies.output.writeLine(
        dependencies.translator.translate("report.path", { path: written.relativePath })
      );
      return {
        runId: report.runId,
        relativePath: written.relativePath,
        sha256: written.sha256
      };
    } finally {
      repositories.close?.();
    }
  };
}

async function openRepositories(
  dependencies: CliDependencies,
  dataDirectory: string
): Promise<CliRepositories> {
  return openCliRepositories(dependencies, dataDirectory);
}
