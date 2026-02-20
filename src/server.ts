import swagger from "@fastify/swagger";
import apiReference from "@scalar/fastify-api-reference";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import path from "node:path";
import { GenerateReportUseCase } from "./application/report/generate-report.js";
import { BearerTokenValidator } from "./application/security/bearer-token-validator.js";
import { loadPresetConnections } from "./infrastructure/config/database-presets.js";
import { buildHttpsRuntimeConfig } from "./infrastructure/config/https-options.js";
import { closeAllConnections } from "./infrastructure/database/sequelize-query-service.js";
import { WorkerReportPipeline } from "./infrastructure/reporting/report-pipeline.js";
import { registerRoutes } from "./interfaces/http/routes.js";

const REPORT_TIMEOUT_MS = 300_000;

const outputDir = process.env.OUTPUT_DIR ?? path.resolve("output");
const presetConnections = loadPresetConnections();
const bearerToken = process.env.AUTH_BEARER_TOKEN;

if (!bearerToken || bearerToken.length === 0) {
  throw new Error("Missing AUTH_BEARER_TOKEN environment variable.");
}

const tokenValidator = new BearerTokenValidator(bearerToken);
const httpsRuntimeConfig = buildHttpsRuntimeConfig();

const app = Fastify({
  logger: true,
  requestTimeout: REPORT_TIMEOUT_MS,
  ...(httpsRuntimeConfig.https ? { https: httpsRuntimeConfig.https } : {}),
});

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

await app.register(swagger, {
  openapi: {
    info: {
      title: "Astrum API",
      version: "1.0.0",
      description: "API for multi-database report generation.",
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
      },
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

const reportPipeline = new WorkerReportPipeline();
const generateReportUseCase = new GenerateReportUseCase(reportPipeline);

await registerRoutes(app, {
  outputDir,
  presetConnections,
  generateReportUseCase,
  tokenValidator,
});

let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, "Shutting down service.");

  try {
    await app.close();
    await closeAllConnections();
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
    app.log.info(
      {
        protocol: httpsRuntimeConfig.protocol,
        auth: "bearer-token",
      },
      "Server started.",
    );
  } catch (error) {
    app.log.error({ error }, "Server failed to start.");
    await closeAllConnections();
    process.exit(1);
  }
}

void startServer();
