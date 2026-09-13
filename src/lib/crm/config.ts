/**
 * Environment configuration for the CRM adapter.
 *
 * There is deliberately NO deployment-wide CRM credential here. Every customer
 * site carries its own API key/secret, stored per workspace in the encrypted
 * vault and read through `src/lib/crm/credentials.ts`. A single shared secret
 * would let one agency's site be opened with another agency's credential, which
 * is exactly the defect this adapter used to carry.
 *
 * The Blockwise app container reaches the CRM over the shared compose network.
 * The default base URL is the internal gunicorn alias, never a public host.
 *
 * The default is the backend, not the nginx frontend. The site is named in
 * X-Frappe-Site-Name and only gunicorn honours it end to end; the frontend
 * overwrites that header from the request Host, and Node cannot set Host at
 * all. See src/lib/crm/client.ts.
 *
 * Optional in the product environment (/srv/blockwise/product/.env):
 *   CRM_BASE_URL      internal CRM origin, default http://blockwise-crm-backend:8000
 *   CRM_TIMEOUT_MS    per-request timeout, default 10000
 */

export type CrmConfig = {
  baseUrl: string;
  timeoutMs: number;
};

export const DEFAULT_CRM_BASE_URL = "http://blockwise-crm-backend:8000";
export const DEFAULT_CRM_TIMEOUT_MS = 10_000;
export const MAX_CRM_TIMEOUT_MS = 60_000;

export function readCrmConfig(env: NodeJS.ProcessEnv = process.env): CrmConfig {
  const baseUrl = env.CRM_BASE_URL?.trim() || DEFAULT_CRM_BASE_URL;

  const parsedUrl = new URL(baseUrl);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("CRM_BASE_URL must be an http or https URL.");
  }

  return {
    baseUrl: parsedUrl.origin,
    timeoutMs: parseTimeout(env.CRM_TIMEOUT_MS),
  };
}

function parseTimeout(raw: string | undefined): number {
  if (!raw) return DEFAULT_CRM_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CRM_TIMEOUT_MS;
  return Math.min(Math.floor(parsed), MAX_CRM_TIMEOUT_MS);
}
