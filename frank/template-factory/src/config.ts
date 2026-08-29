/** Frank template factory configuration — all from environment. */
export const config = {
  port: parseInt(process.env.FRANK_PORT ?? "3100", 10),
  host: process.env.FRANK_HOST ?? "127.0.0.1",

  /** Database URL for Frank's private schema/database. */
  databaseUrl: process.env.FRANK_DATABASE_URL ?? "",

  /** Object storage config. */
  storage: {
    endpoint: process.env.FRANK_STORAGE_ENDPOINT ?? "",
    bucket: process.env.FRANK_STORAGE_BUCKET ?? "frank-templates",
    accessKey: process.env.FRANK_STORAGE_ACCESS_KEY ?? "",
    secretKey: process.env.FRANK_STORAGE_SECRET_KEY ?? "",
  },

  /** Auth secret for internal service-to-service calls (shared with Blockwise). */
  internalAuthSecret: process.env.FRANK_INTERNAL_AUTH_SECRET ?? "dev-secret-change-me",

  /** Provider vault access (read model credentials). */
  providerVault: {
    url: process.env.FRANK_PROVIDER_VAULT_URL ?? "",
    token: process.env.FRANK_PROVIDER_VAULT_TOKEN ?? "",
  },

  /** Dev mode bypasses auth. Never true in production. */
  isDev: process.env.NODE_ENV !== "production",
} as const;
