import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import {
  GenerateReportUseCase,
  getAggregateErrorMessages,
} from "../../application/report/generate-report.js";
import {
  normalizeReportConfigChunkSize,
  toReportConfig,
  type ReportRequestBody,
} from "../../application/report/build-report-config.js";
import { BearerTokenValidator } from "../../application/security/bearer-token-validator.js";
import type { DatabaseConfig } from "../../domain/report/models.js";
import { validateDownloadFilename } from "../../domain/report/policies.js";
import { createBearerAuthHook } from "./bearer-auth-hook.js";
import {
  downloadParamsSchema,
  errorResponseSchema,
  errorsResponseSchema,
  healthResponseSchema,
  reportRequestBodySchema,
  reportSuccessSchema,
} from "./schemas.js";

export interface RegisterRoutesDependencies {
  outputDir: string;
  presetConnections: Record<string, DatabaseConfig>;
  generateReportUseCase: GenerateReportUseCase;
  tokenValidator: BearerTokenValidator;
}

export async function registerRoutes(
  app: FastifyInstance,
  deps: RegisterRoutesDependencies,
): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const authHook = createBearerAuthHook(deps.tokenValidator);

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
      preHandler: authHook,
      schema: {
        tags: ["reports"],
        body: reportRequestBodySchema,
        response: {
          200: reportSuccessSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          500: errorsResponseSchema,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      let reportConfig;

      try {
        reportConfig = toReportConfig(
          request.body as ReportRequestBody,
          deps.presetConnections,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid report request.";
        return reply.code(400).send({ error: message });
      }

      try {
        const report = await deps.generateReportUseCase.execute(
          normalizeReportConfigChunkSize(reportConfig),
          deps.outputDir,
        );

        return report;
      } catch (error) {
        if (error instanceof AggregateError) {
          const messages = getAggregateErrorMessages(error);
          return reply.code(500).send({ errors: messages });
        }

        throw error;
      }
    },
  );

  api.get(
    "/reports/:filename",
    {
      preHandler: authHook,
      schema: {
        tags: ["reports"],
        params: downloadParamsSchema,
        response: {
          200: z.unknown(),
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const filename = request.params.filename;

      if (!validateDownloadFilename(filename)) {
        return reply.code(400).send({ error: "Invalid filename." });
      }

      const filePath = path.join(deps.outputDir, filename);

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
}
