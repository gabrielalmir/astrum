export type DatabaseDialect = "mssql" | "pg" | "sqlite3";

export interface DatabaseConfig {
  dialect: DatabaseDialect;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database: string;
}

export interface QueryConfig {
  query: string;
  database: DatabaseConfig;
}

export type ReportFormat = "xlsx" | "json";

export interface ReportConfig {
  reportName: string;
  format: ReportFormat;
  worksheets: Record<string, QueryConfig>;
  chunkSize: number;
}

export interface WorkerInput {
  sheetName: string;
  query: string;
  dbConfig: DatabaseConfig;
  filePath: string;
  chunkSize: number;
}

export interface WorkerOutput {
  rowCount: number;
  filePath: string;
  error?: string;
}

export interface GeneratedSheet {
  file: string;
  rows: number;
}

export interface GeneratedReport {
  report: string;
  sheets: GeneratedSheet[];
}
