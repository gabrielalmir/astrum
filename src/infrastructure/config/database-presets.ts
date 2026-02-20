import { readFileSync } from "node:fs";
import { z } from "zod";
import type { DatabaseConfig } from "../../domain/report/models.js";

export const databaseConfigSchema = z.object({
  dialect: z.enum(["mssql", "pg", "sqlite3"]),
  host: z.string().min(1).optional(),
  port: z.number().int().positive().optional(),
  user: z.string().min(1).optional(),
  password: z.string().optional(),
  database: z.string().min(1),
});

export const databasePresetKeySchema = z
  .string()
  .regex(/^[A-Z]+$/, "Database preset key must use CAPITAL_ONLY_LETTERS.");

function loadDatabaseJson(): string | undefined {
  const databaseFileJson = process.env.DATABASE_PRESETS_JSON_FILE;
  const databasePresetsEnvironment = process.env.DATABASE_PRESETS_JSON;

  if (databaseFileJson) {
    return readFileSync(databaseFileJson, "utf-8");
  }

  return databasePresetsEnvironment;
}

export function loadPresetConnections(): Record<string, DatabaseConfig> {
  const raw = loadDatabaseJson();

  if (!raw) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid DATABASE_PRESETS_JSON: expected valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid DATABASE_PRESETS_JSON: expected object map.");
  }

  const presets: Record<string, DatabaseConfig> = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (!databasePresetKeySchema.safeParse(key).success) {
      throw new Error(
        `Invalid preset key "${key}": use CAPITAL_ONLY_LETTERS only.`,
      );
    }

    const dbResult = databaseConfigSchema.safeParse(value);

    if (!dbResult.success) {
      throw new Error(
        `Invalid database preset "${key}": configuration does not match DatabaseConfig.`,
      );
    }

    presets[key] = dbResult.data;
  }

  return presets;
}
