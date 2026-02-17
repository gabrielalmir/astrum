import { parentPort, workerData } from "node:worker_threads";
import { generateReportFile } from "./excel.js";
import type { WorkerInput, WorkerOutput } from "./types.js";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown worker error.";
}

async function runWorker(): Promise<void> {
  const input = workerData as WorkerInput;

  try {
    const rowCount = await generateReportFile(input);
    const output: WorkerOutput = {
      rowCount,
      filePath: input.filePath,
    };
    parentPort?.postMessage(output);
  } catch (error) {
    const output: WorkerOutput = {
      rowCount: 0,
      filePath: input.filePath,
      error: getErrorMessage(error),
    };
    parentPort?.postMessage(output);
  }
}

void runWorker();

export default runWorker;
