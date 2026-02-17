import swagger from "@fastify/swagger";
import apiReference from "@scalar/fastify-api-reference";
import Fastify from "fastify";
import {
  type ZodTypeProvider,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import fs, { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { closeAll } from "./db.js";
import { runPipeline } from "./pipeline.js";
import type {
  DatabaseConfig,
  QueryConfig,
  ReportConfigCraftQuery,
  WorkerOutput,
} from "./types.js";

const DEFAULT_CHUNK_SIZE = 10_000;
const REPORT_TIMEOUT_MS = 300_000;

const healthResponseSchema = z.object({
  status: z.string(),
  runtime: z.string(),
  uptime: z.number(),
});

const errorResponseSchema = z.object({
  error: z.string(),
});

const errorsResponseSchema = z.object({
  errors: z.array(z.string()),
});

const databaseConfigSchema = z.object({
  dialect: z.enum(["mssql", "pg", "sqlite3"]),
  host: z.string().min(1).optional(),
  port: z.number().int().positive().optional(),
  user: z.string().min(1).optional(),
  password: z.string().optional(),
  database: z.string().min(1),
});

const databasePresetKeySchema = z
  .string()
  .regex(/^[A-Z]+$/, "Database preset key must use CAPITAL_ONLY_LETTERS.");

const queryConfigSchema = z.object({
  query: z.string().min(1),
  database: z.union([databaseConfigSchema, databasePresetKeySchema]),
});

const reportRequestBodySchema = z.object({
  report_name: z.string().min(1),
  format: z.enum(["xlsx", "json"]),
  worksheets: z
    .record(queryConfigSchema)
    .refine((value) => Object.keys(value).length > 0, {
      message: "worksheets must include at least one sheet.",
    }),
  chunksize: z.number().int().positive().optional(),
});

const reportSuccessSchema = z.object({
  report: z.string(),
  sheets: z.array(
    z.object({
      file: z.string(),
      rows: z.number().int().nonnegative(),
    }),
  ),
});

const downloadParamsSchema = z.object({
  filename: z.string().min(1),
});

function toReportConfig(
  body: z.infer<typeof reportRequestBodySchema>,
  presetConnections: Record<string, DatabaseConfig>,
): ReportConfigCraftQuery {
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
    report_name: body.report_name,
    format: body.format,
    worksheets: resolvedWorksheets,
    chunksize: body.chunksize ?? DEFAULT_CHUNK_SIZE,
  };
}

function loadDatabaseJson(): string | undefined {
  const databaseFileJson = process.env.DATABASE_PRESETS_JSON_FILE;
  const databasePresetedEnviromnent = process.env.DATABASE_PRESETS_JSON;

  if (databaseFileJson) {
    return readFileSync(databaseFileJson, 'utf-8')
  }

  return databasePresetedEnviromnent;
}

function loadPresetConnections(): Record<string, DatabaseConfig> {
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

function validateDownloadFilename(filename: string): boolean {
  if (filename.trim().length === 0) {
    return false;
  }

  return path.basename(filename) === filename;
}

function buildErrors(outputs: WorkerOutput[]): string[] {
  return outputs
    .filter((output) => typeof output.error === "string" && output.error.length > 0)
    .map((output) => output.error as string);
}

const app = Fastify({
  logger: true,
  requestTimeout: REPORT_TIMEOUT_MS,
});

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

const outputDir = process.env.OUTPUT_DIR ?? path.resolve("output");
const presetConnections = loadPresetConnections();

await app.register(swagger, {
  openapi: {
    info: {
      title: "Astrum API",
      version: "1.0.0",
      description: "API for multi-database report generation.",
    },
    tags: [
      { name: "system", description: "System status endpoints" },
      { name: "reports", description: "Report generation and retrieval" },
    ],
  },
  transform: jsonSchemaTransform,
});

await app.register(apiReference, {
  routePrefix: "/docs",
  configuration: {
    title: "Astrum API Docs",
    theme: "fastify",
  },
});

const api = app.withTypeProvider<ZodTypeProvider>();

api.get(
  "/health",
  {
    schema: {
      tags: ["system"],
      response: {
        200: healthResponseSchema,
      },
    },
  },
  async () => {
    return {
      status: "ok",
      runtime: process.version,
      uptime: process.uptime(),
    };
  },
);

api.post(
  "/reports",
  {
    schema: {
      tags: ["reports"],
      body: reportRequestBodySchema,
      response: {
        200: reportSuccessSchema,
        400: errorResponseSchema,
        500: errorsResponseSchema,
      },
    },
  },
  async (request, reply) => {
    let reportConfig: ReportConfigCraftQuery;

    try {
      reportConfig = toReportConfig(request.body, presetConnections);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid report request.";
      return reply.code(400).send({ error: message });
    }

    const outputs = await runPipeline(reportConfig, outputDir);
    const errors = buildErrors(outputs);

    if (errors.length > 0) {
      return reply.code(500).send({ errors });
    }

    return {
      report: reportConfig.report_name,
      sheets: outputs.map((output) => ({
        file: path.basename(output.filePath),
        rows: output.rowCount,
      })),
    };
  },
);

api.get(
  "/reports/:filename",
  {
    schema: {
      tags: ["reports"],
      params: downloadParamsSchema,
      response: {
        200: z.unknown(),
        400: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  },
  async (request, reply) => {
    const filename = request.params.filename;

    if (!validateDownloadFilename(filename)) {
      return reply.code(400).send({ error: "Invalid filename." });
    }

    const filePath = path.join(outputDir, filename);

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: "File not found." });
    }

    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".xlsx") {
      reply.header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    } else if (extension === ".json") {
      reply.header("Content-Type", "application/json; charset=utf-8");
    }

    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(fs.createReadStream(filePath));
  },
);

let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, "Shutting down service.");

  try {
    await app.close();
    await closeAll();
    process.exit(0);
  } catch (error) {
    app.log.error({ error }, "Shutdown failed.");
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});

async function startServer(): Promise<void> {
  const host = "0.0.0.0";
  const port = Number(process.env.PORT ?? 3000);

  try {
    await app.listen({ host, port });
  } catch (error) {
    app.log.error({ error }, "Server failed to start.");
    await closeAll();
    process.exit(1);
  }
}

void startServer();
