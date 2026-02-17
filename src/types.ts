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

export interface ReportConfigCraftQuery {
  report_name: string;
  format: "xlsx" | "json";
  worksheets: Record<string, QueryConfig>;
  chunksize: number;
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
