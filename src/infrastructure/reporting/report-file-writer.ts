import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";
import type { Writable } from "node:stream";
import type { WorkerInput } from "../../domain/report/models.js";
import { queryInBatches } from "../database/sequelize-query-service.js";

type QueryRow = Record<string, unknown>;

const HEADER_FILL_COLOR = "FFD9E1F2";

function normalizeCellValue(value: unknown): ExcelJS.CellValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Date
  ) {
    return value;
  }

  return JSON.stringify(value);
}

function collectHeaders(
  rows: QueryRow[],
  headers: string[],
  headerSet: Set<string>,
): boolean {
  let changed = false;

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!headerSet.has(key)) {
        headerSet.add(key);
        headers.push(key);
        changed = true;
      }
    }
  }

  return changed;
}

function styleHeaderCell(cell: ExcelJS.Cell): void {
  cell.font = { bold: true };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: HEADER_FILL_COLOR },
  };
}

async function writeToStream(stream: Writable, chunk: string): Promise<void> {
  if (stream.write(chunk)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function writeXlsxWorksheet(input: WorkerInput): Promise<number> {
  fs.mkdirSync(path.dirname(input.filePath), { recursive: true });

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(input.sheetName);

  const headers: string[] = [];
  const headerSet = new Set<string>();
  const buffer: QueryRow[] = [];

  let rowCount = 0;
  let headerRow: ExcelJS.Row | null = null;

  const ensureHeaderRow = (): void => {
    if (headerRow !== null || headers.length === 0) {
      return;
    }

    headerRow = worksheet.addRow(headers);
    headerRow.eachCell(styleHeaderCell);
  };

  const syncHeaderRowColumns = (): void => {
    if (headerRow === null) {
      return;
    }

    const existingCells = headerRow.cellCount;
    if (existingCells >= headers.length) {
      return;
    }

    for (let index = existingCells + 1; index <= headers.length; index += 1) {
      const cell = headerRow.getCell(index);
      cell.value = headers[index - 1];
      styleHeaderCell(cell);
    }
  };

  const flushBuffer = (): void => {
    if (buffer.length === 0) {
      return;
    }

    const headerChanged = collectHeaders(buffer, headers, headerSet);
    ensureHeaderRow();

    if (headerChanged) {
      syncHeaderRowColumns();
    }

    const worksheetRows = buffer.map((row) =>
      headers.map((header) => normalizeCellValue(row[header])),
    );

    worksheet.addRows(worksheetRows);
    buffer.length = 0;
  };

  for await (const batch of queryInBatches(
    input.dbConfig,
    input.query,
    input.chunkSize,
  )) {
    rowCount += batch.length;
    buffer.push(...batch);

    if (buffer.length >= input.chunkSize) {
      flushBuffer();
    }
  }

  flushBuffer();
  await workbook.xlsx.writeFile(input.filePath);
  return rowCount;
}

async function writeJsonReport(input: WorkerInput): Promise<number> {
  fs.mkdirSync(path.dirname(input.filePath), { recursive: true });

  const stream = fs.createWriteStream(input.filePath, { encoding: "utf8" });
  let rowCount = 0;
  let isFirst = true;

  try {
    await writeToStream(stream, "[");

    for await (const batch of queryInBatches(
      input.dbConfig,
      input.query,
      input.chunkSize,
    )) {
      for (const row of batch) {
        if (!isFirst) {
          await writeToStream(stream, ",");
        }

        await writeToStream(stream, JSON.stringify(row));
        isFirst = false;
        rowCount += 1;
      }
    }

    stream.end("]");
    await finished(stream);
    return rowCount;
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

export async function generateReportFile(input: WorkerInput): Promise<number> {
  const extension = path.extname(input.filePath).toLowerCase();

  if (extension === ".json") {
    return writeJsonReport(input);
  }

  return writeXlsxWorksheet(input);
}
