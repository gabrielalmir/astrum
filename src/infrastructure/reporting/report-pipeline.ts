import path from "node:path";
import { Worker } from "node:worker_threads";
import { resolveChunkSize, sanitizeReportName } from "../../domain/report/policies.js";
import type {
  ReportConfig,
  WorkerInput,
  WorkerOutput,
} from "../../domain/report/models.js";
import type { ReportPipeline } from "../../application/report/generate-report.js";

function getWorkerScriptPath(): URL {
  return new URL("./report-worker.js", import.meta.url);
}

function executeWorker(input: WorkerInput): Promise<WorkerOutput> {
  return new Promise((resolve) => {
    const worker = new Worker(getWorkerScriptPath(), { workerData: input });
    let resolved = false;

    worker.once("message", (message: WorkerOutput) => {
      if (resolved) {
        return;
      }

      resolved = true;
      resolve(message);
    });

    worker.once("error", (error) => {
      if (resolved) {
        return;
      }

      resolved = true;
      resolve({
        rowCount: 0,
        filePath: input.filePath,
        error: error.message,
      });
    });

    worker.once("exit", (code) => {
      if (resolved || code === 0) {
        return;
      }

      resolved = true;
      resolve({
        rowCount: 0,
        filePath: input.filePath,
        error: `Worker stopped with code ${code}`,
      });
    });
  });
}

export class WorkerReportPipeline implements ReportPipeline {
  async run(config: ReportConfig, outputDir: string): Promise<WorkerOutput[]> {
    const chunkSize = resolveChunkSize(config.chunkSize);
    const extension = config.format === "json" ? "json" : "xlsx";
    const reportName = sanitizeReportName(config.reportName);

    const workerTasks = Object.entries(config.worksheets).map(
      ([sheetName, sheetConfig]) => {
        const safeSheetName = sanitizeReportName(sheetName);
        const filename = `${reportName}_${safeSheetName}.${extension}`;
        const workerInput: WorkerInput = {
          sheetName,
          query: sheetConfig.query,
          dbConfig: sheetConfig.database,
          filePath: path.join(outputDir, filename),
          chunkSize,
        };

        return executeWorker(workerInput);
      },
    );

    return Promise.all(workerTasks);
  }
}
