import path from "node:path";
import { collectPipelineErrors } from "../../domain/report/policies.js";
import type {
  GeneratedReport,
  ReportConfig,
  WorkerOutput,
} from "../../domain/report/models.js";

export interface ReportPipeline {
  run(config: ReportConfig, outputDir: string): Promise<WorkerOutput[]>;
}

export class GenerateReportUseCase {
  constructor(private readonly reportPipeline: ReportPipeline) {}

  async execute(config: ReportConfig, outputDir: string): Promise<GeneratedReport> {
    const outputs = await this.reportPipeline.run(config, outputDir);
    const errors = collectPipelineErrors(outputs);

    if (errors.length > 0) {
      throw new AggregateError(errors.map((message) => new Error(message)), "Report generation failed.");
    }

    return {
      report: config.reportName,
      sheets: outputs.map((output) => ({
        file: path.basename(output.filePath),
        rows: output.rowCount,
      })),
    };
  }
}

export function getAggregateErrorMessages(error: AggregateError): string[] {
  return error.errors
    .map((entry) => (entry instanceof Error ? entry.message : String(entry)))
    .filter((message) => message.length > 0);
}
