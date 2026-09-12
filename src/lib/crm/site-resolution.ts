/**
 * Blockwise workspace to Frappe site mapping.
 *
 * One shared Frappe deployment hosts one isolated site per agency. A site is a
 * hostname (for example `acme.crm.internal`) and is selected by the `Host`
 * header on every request. The mapping is persisted in
 * `public.crm_workspace_sites`, provisioned on demand by
 * /srv/blockwise/crm/provision-site.sh.
 *
 * There is deliberately no shared-admin-site fallback: a workspace without a
 * mapping row is refused rather than written into another agency's site.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const CRM_SITE_TABLE = "crm_workspace_sites";
export const CRM_SITE_SUFFIX = ".crm.internal";

export type CrmSiteStatus = "provisioning" | "ready" | "disabled";

export type CrmSiteMapping = {
  workspaceId: string;
  crmSite: string;
  status: CrmSiteStatus;
};

export class CrmSiteNotProvisionedError extends Error {
  constructor(workspaceId: string) {
    super(`No CRM site is provisioned for workspace ${workspaceId}.`);
    this.name = "CrmSiteNotProvisionedError";
  }
}

/**
 * Accept only a bare hostname that can be sent as a Host header. Rejects
 * anything with a scheme, path, port, credentials or whitespace so a database
 * value can never turn into a request to an unintended origin.
 */
export function isValidCrmSite(site: string): boolean {
  const value = site.trim();
  if (!value || value.length > 253 || /\s/.test(value)) return false;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(value)) return false;
  return !value.includes("..");
}

/** Canonical site hostname for an agency slug, e.g. `acme` -> `acme.crm.internal`. */
export function crmSiteForSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)) {
    throw new Error("CRM site slug must be lowercase alphanumeric with single hyphens.");
  }
  return `${normalized}${CRM_SITE_SUFFIX}`;
}

type CrmSiteRow = {
  workspace_id?: string | null;
  crm_site?: string | null;
  status?: string | null;
};

/**
 * Resolve the Frappe site for a workspace. Returns null when no mapping
 * exists; callers must treat that as "not provisioned" and must not fall back
 * to a shared site.
 */
export async function resolveCrmSite(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<CrmSiteMapping | null> {
  const { data, error } = await supabase
    .from(CRM_SITE_TABLE)
    .select("workspace_id, crm_site, status")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(`crm_workspace_sites lookup failed: ${error.message}`);
  }

  const row = (data ?? null) as CrmSiteRow | null;
  const site = row?.crm_site?.trim();

  if (!row?.workspace_id || !site || !isValidCrmSite(site)) {
    return null;
  }

  return {
    workspaceId: row.workspace_id,
    crmSite: site,
    status: normalizeStatus(row.status),
  };
}

export async function requireCrmSite(supabase: SupabaseClient, workspaceId: string): Promise<CrmSiteMapping> {
  const mapping = await resolveCrmSite(supabase, workspaceId);
  if (!mapping || mapping.status === "disabled") {
    throw new CrmSiteNotProvisionedError(workspaceId);
  }
  return mapping;
}

function normalizeStatus(status: string | null | undefined): CrmSiteStatus {
  if (status === "provisioning" || status === "disabled") return status;
  return "ready";
}
