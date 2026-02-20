import { z } from "zod";
import {
  databaseConfigSchema,
  databasePresetKeySchema,
} from "../../infrastructure/config/database-presets.js";

export const healthResponseSchema = z.object({
  status: z.string(),
  runtime: z.string(),
  uptime: z.number(),
});

export const errorResponseSchema = z.object({
  error: z.string(),
});

export const errorsResponseSchema = z.object({
  errors: z.array(z.string()),
});

export const queryConfigSchema = z.object({
  query: z.string().min(1),
  database: z.union([databaseConfigSchema, databasePresetKeySchema]),
});

export const reportRequestBodySchema = z.object({
  report_name: z.string().min(1),
  format: z.enum(["xlsx", "json"]),
  worksheets: z
    .record(queryConfigSchema)
    .refine((value) => Object.keys(value).length > 0, {
      message: "worksheets must include at least one sheet.",
    }),
  chunksize: z.number().int().positive().optional(),
});

export const reportSuccessSchema = z.object({
  report: z.string(),
  sheets: z.array(
    z.object({
      file: z.string(),
      rows: z.number().int().nonnegative(),
    }),
  ),
});

export const downloadParamsSchema = z.object({
  filename: z.string().min(1),
});
