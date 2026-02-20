import {
  DEFAULT_CHUNK_SIZE,
  resolveChunkSize,
} from "../../domain/report/policies.js";
import type {
  DatabaseConfig,
  QueryConfig,
  ReportConfig,
  ReportFormat,
} from "../../domain/report/models.js";

export interface ReportRequestBody {
  report_name: string;
  format: ReportFormat;
  worksheets: Record<
    string,
    {
      query: string;
      database: DatabaseConfig | string;
    }
  >;
  chunksize?: number;
}

export function toReportConfig(
  body: ReportRequestBody,
  presetConnections: Record<string, DatabaseConfig>,
): ReportConfig {
  const resolvedWorksheets: Record<string, QueryConfig> = {};

  for (const [sheetName, config] of Object.entries(body.worksheets)) {
    if (typeof config.database === "string") {
      const resolvedPreset = presetConnections[config.database];

      if (!resolvedPreset) {
        throw new Error(`Unknown database preset key: ${config.database}`);
      }

      resolvedWorksheets[sheetName] = {
        query: config.query,
        database: resolvedPreset,
      };
      continue;
    }

    resolvedWorksheets[sheetName] = {
      query: config.query,
      database: config.database,
    };
  }

  return {
    reportName: body.report_name,
    format: body.format,
    worksheets: resolvedWorksheets,
    chunkSize: body.chunksize ?? DEFAULT_CHUNK_SIZE,
  };
}

export function normalizeReportConfigChunkSize(config: ReportConfig): ReportConfig {
  return {
    ...config,
    chunkSize: resolveChunkSize(config.chunkSize),
  };
}
