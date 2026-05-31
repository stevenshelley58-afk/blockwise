import { z } from "zod";

const providerSchema = z.enum(["disabled", "http_json"]);

const envSchema = z.object({
  HERMES_META_CAPTURE_PROVIDER: providerSchema.default("disabled"),
  HERMES_META_CAPTURE_ENDPOINT: z.string().url().optional(),
  HERMES_META_CAPTURE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  HERMES_META_CAPTURE_ESTIMATED_COST_USD: z.coerce.number().nonnegative().default(0),
});

export type MetaCaptureConfig = z.infer<typeof envSchema>;

export function loadMetaCaptureConfig(source: NodeJS.ProcessEnv = process.env): MetaCaptureConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid Meta library capture env:\n${issues}`);
  }
  return parsed.data;
}
