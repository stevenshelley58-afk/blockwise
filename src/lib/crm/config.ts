/**
 * Environment configuration for the CRM adapter.
 *
 * Credentials are read from the deployment environment only. They must never
 * be inlined in source, committed, or returned to a browser. The Blockwise app
 * container reaches the CRM over the shared compose network; the default base
 * URL is the internal frontend alias, never a public host.
 *
 * Required in the product environment (/srv/blockwise/product/.env):
 *   CRM_BASE_URL      internal CRM origin, default http://blockwise-crm-frontend:8080
 *   CRM_API_KEY       Frappe API key
 *   CRM_API_SECRET    Frappe API secret
 * Optional:
 *   CRM_DEFAULT_SITE  fallback site when no workspace mapping row exists
 *   CRM_TIMEOUT_MS    per-request timeout, default 10000
 */

export type CrmConfig = {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  defaultSite: string | null;
  timeoutMs: number;
};

export const DEFAULT_CRM_BASE_URL = "http://blockwise-crm-frontend:8080";
export const DEFAULT_CRM_TIMEOUT_MS = 10_000;
export const MAX_CRM_TIMEOUT_MS = 60_000;

export function readCrmConfig(env: NodeJS.ProcessEnv = process.env): CrmConfig {
  const baseUrl = env.CRM_BASE_URL?.trim() || DEFAULT_CRM_BASE_URL;
  const apiKey = env.CRM_API_KEY?.trim() ?? "";
  const apiSecret = env.CRM_API_SECRET?.trim() ?? "";

  if (!apiKey || !apiSecret) {
    throw new Error("CRM credentials are not configured (CRM_API_KEY, CRM_API_SECRET).");
  }

  const parsedUrl = new URL(baseUrl);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("CRM_BASE_URL must be an http or https URL.");
  }

  return {
    baseUrl: parsedUrl.origin,
    apiKey,
    apiSecret,
    defaultSite: env.CRM_DEFAULT_SITE?.trim() || null,
    timeoutMs: parseTimeout(env.CRM_TIMEOUT_MS),
  };
}

export function isCrmConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.CRM_API_KEY?.trim() && env.CRM_API_SECRET?.trim());
}

function parseTimeout(raw: string | undefined): number {
  if (!raw) return DEFAULT_CRM_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CRM_TIMEOUT_MS;
  return Math.min(Math.floor(parsed), MAX_CRM_TIMEOUT_MS);
}
