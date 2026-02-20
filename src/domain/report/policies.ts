import type { WorkerOutput } from "./models.js";

export const DEFAULT_CHUNK_SIZE = 10_000;

export function sanitizeReportName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return normalized.length > 0 ? normalized : "report";
}

export function validateDownloadFilename(filename: string): boolean {
  if (filename.trim().length === 0) {
    return false;
  }

  return !filename.includes("/") && !filename.includes("\\");
}

export function resolveChunkSize(chunkSize: number | undefined): number {
  if (!Number.isInteger(chunkSize) || (chunkSize ?? 0) <= 0) {
    return DEFAULT_CHUNK_SIZE;
  }

  return chunkSize as number;
}

export function collectPipelineErrors(outputs: WorkerOutput[]): string[] {
  return outputs
    .filter((output) => typeof output.error === "string" && output.error.length > 0)
    .map((output) => output.error as string);
}
