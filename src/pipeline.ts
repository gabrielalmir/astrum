import path from "node:path";
import { Worker } from "node:worker_threads";
import type {
  ReportConfigCraftQuery,
  WorkerInput,
  WorkerOutput,
} from "./types.js";

const DEFAULT_CHUNK_SIZE = 10_000;

function sanitizeName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return normalized.length > 0 ? normalized : "report";
}

function getWorkerScriptPath(): URL {
  return new URL("./worker.js", import.meta.url);
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
        error: `Worker encerrado com código ${code}`,
      });
    });
  });
}

export async function runPipeline(
  config: ReportConfigCraftQuery,
  outputDir: string,
): Promise<WorkerOutput[]> {
  const chunkSize =
    Number.isInteger(config.chunksize) && config.chunksize > 0
      ? config.chunksize
      : DEFAULT_CHUNK_SIZE;

  const extension = config.format === "json" ? "json" : "xlsx";
  const reportName = sanitizeName(config.report_name);

  const workerTasks = Object.entries(config.worksheets).map(
    ([sheetName, sheetConfig]) => {
      const safeSheetName = sanitizeName(sheetName);
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
