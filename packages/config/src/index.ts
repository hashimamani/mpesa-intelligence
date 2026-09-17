import { z } from "zod";

// Central config schema for the API service. Fails fast and loud on startup if
// required configuration is missing — see docs/03-architecture.md and the
// platform-wide "no fake implementations" rule: an unconfigured dependency
// must never silently fall back to mock behavior in a non-test environment.

const apiEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_TOKEN_TTL: z.string().default("15m"),
  JWT_REFRESH_TOKEN_TTL: z.string().default("30d"),
  // AI/billing providers are optional at this stage — features that depend on them
  // are gated off (never mocked) when unset. See docs/07-ai-architecture.md,
  // docs/08-subscription-architecture.md.
  AI_PROVIDER: z.string().optional(),
  AI_PROVIDER_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  BILLING_PROVIDER: z.string().optional(),
  BILLING_PROVIDER_API_KEY: z.string().optional(),
  BILLING_WEBHOOK_SECRET: z.string().optional(),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

let cachedConfig: ApiEnv | undefined;

/**
 * Parses and validates process.env once, throwing a descriptive error that names
 * every missing/invalid variable if configuration is incomplete. Call this at
 * process startup — never lazily deep inside a request handler.
 */
export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  if (cachedConfig) return cachedConfig;

  const result = apiEnvSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid or missing environment configuration:\n${issues}`);
  }

  cachedConfig = result.data;
  return cachedConfig;
}

/** Test-only escape hatch to reset the cache between test cases. */
export function _resetConfigCacheForTests(): void {
  cachedConfig = undefined;
}
