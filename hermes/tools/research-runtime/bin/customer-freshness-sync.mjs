#!/usr/bin/env node

import { createHmac } from "node:crypto";
import { hermesSupabaseHeaders, resolveHermesCustomerSupabaseCredential } from "./supabase-credentials.mjs";

const SOURCE_TABLE = "ad_radar_customer_interest_sources";
const ASSIGNMENTS_TABLE = "meta_partner_account_assignments";
const TARGET_TABLE = "ad_radar_customer_interests";
const PAGE_SIZE = 500;
const WRITE_SIZE = 100;
const DEFAULT_TIMEOUT_MS = 15000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const POSTCODE = /^[0-9]{4}$/u;
const META_PAGE_ID = /^[0-9]+$/u;
const AU_STATE_CODES = new Set(["WA", "NSW", "VIC", "QLD", "SA", "TAS", "ACT", "NT"]);
const AU_STATE_PATTERN = "WA|NSW|VIC|QLD|SA|TAS|ACT|NT";

function uuid(value) {
  const candidate = String(value ?? "").trim();
  return UUID.test(candidate) ? candidate : null;
}
function postcode(value) {
  const candidate = String(value ?? "").trim();
  return POSTCODE.test(candidate) ? candidate : null;
}
function state(value) {
  const candidate = String(value ?? "").trim().toUpperCase();
  return AU_STATE_CODES.has(candidate) ? candidate : null;
}
function metaPageId(value) {
  const candidate = String(value ?? "").trim();
  return META_PAGE_ID.test(candidate) ? candidate : null;
}
function cleanUrl(value) {
  return String(value ?? "").replace(/\/+$/u, "");
}
function timeoutMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1000, Math.min(60000, parsed)) : DEFAULT_TIMEOUT_MS;
}

function customerRestFor(env, fetchImpl) {
  const url = cleanUrl(env.HERMES_CUSTOMER_SUPABASE_URL);
  const credential = resolveHermesCustomerSupabaseCredential(env);
  if (!url || !credential) return null;
  const requestTimeoutMs = timeoutMs(env.HERMES_CUSTOMER_FRESHNESS_TIMEOUT_MS);
  return async (path, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(url + "/rest/v1/" + path, {
        ...init,
        signal: init.signal || controller.signal,
        headers: hermesSupabaseHeaders(credential, { "Content-Type": "application/json", ...(init.headers || {}) }),
      });
      const body = await response.text();
      if (!response.ok) throw new Error((init.method || "GET") + " customer freshness failed with HTTP " + response.status);
      if (!body) return null;
      try {
        return JSON.parse(body);
      } catch {
        throw new Error("Customer freshness returned invalid JSON");
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

async function readAll(customerRest, relation, select, order = null) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const ordering = order ? "&order=" + encodeURIComponent(order) : "";
    const page = await customerRest(relation + "?select=" + encodeURIComponent(select) + ordering + "&limit=" + PAGE_SIZE + "&offset=" + offset);
    if (!Array.isArray(page)) throw new Error("Customer freshness snapshot returned a non-array for " + relation);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function contactValue(contact, keys) {
  if (!contact || typeof contact !== "object" || Array.isArray(contact)) return null;
  for (const key of keys) if (typeof contact[key] === "string" && contact[key].trim()) return contact[key].trim();
  return null;
}

export function extractContactPostcode(contact) {
  if (!contact || typeof contact !== "object" || Array.isArray(contact)) return null;
  const direct = postcode(contact.postcode ?? contact.postalCode ?? contact.postal_code);
  if (direct) return direct;
  if (typeof contact.address === "string") {
    const statePostcode = contact.address.match(new RegExp("\\b(?:" + AU_STATE_PATTERN + ")\\s+([0-9]{4})\\b", "iu"))?.[1];
    if (statePostcode) return postcode(statePostcode);
    const trailingPostcode = contact.address.match(/\b([0-9]{4})(?:\s*,?\s*(?:AU|Australia))?\s*$/iu)?.[1];
    return postcode(trailingPostcode);
  }
  if (contact.address && typeof contact.address === "object" && !Array.isArray(contact.address)) {
    return postcode(contact.address.postcode ?? contact.address.postalCode ?? contact.address.postal_code);
  }
  return null;
}

export function customerInterestKey(workspaceId, secret) {
  const value = uuid(workspaceId);
  if (!value) throw new Error("Customer freshness workspace id must be a UUID.");
  if (!secret || String(secret).length < 16) throw new Error("Customer freshness key secret is missing or too short.");
  return "v1:" + createHmac("sha256", String(secret)).update(value).digest("hex");
}

async function knownIds(researchRest, relation, ids) {
  if (!ids.length) return new Set();
  const rows = await researchRest("research", relation + "?select=id&id=in.(" + ids.map(encodeURIComponent).join(",") + ")&limit=" + ids.length);
  if (!Array.isArray(rows)) throw new Error("Research identity validation returned a non-array for " + relation);
  return new Set(rows.map((row) => uuid(row?.id)).filter(Boolean));
}

async function knownResearchPagesByMetaIds(researchRest, ids) {
  if (!ids.length) return new Map();
  const rows = await researchRest("research", "advertiser_pages?select=id,page_id&platform=eq.facebook&page_id=in.(" + ids.map(encodeURIComponent).join(",") + ")&limit=" + ids.length);
  if (!Array.isArray(rows)) throw new Error("Research page validation returned a non-array");
  const result = new Map();
  for (const row of rows) {
    const id = uuid(row?.id);
    const pageId = metaPageId(row?.page_id);
    if (id && pageId) result.set(pageId, id);
  }
  return result;
}

function latestKits(brandKits) {
  const result = new Map();
  for (const kit of brandKits) {
    const workspaceId = uuid(kit?.workspace_id);
    if (!workspaceId) continue;
    const current = result.get(workspaceId);
    const candidateUpdated = String(kit?.updated_at ?? "");
    const currentUpdated = String(current?.updated_at ?? "");
    if (!current || candidateUpdated.localeCompare(currentUpdated) > 0) result.set(workspaceId, kit);
  }
  return result;
}

function preferredValue(source, sourceValue, kitValue) {
  const sourceKind = String(source?.source ?? "");
  if (sourceKind === "manual" || sourceKind === "profile") return sourceValue || kitValue;
  return kitValue || sourceValue;
}

export function buildCustomerInterestRows({
  sources,
  owners,
  brandKits,
  assignedPageIds = new Map(),
  knownAgentIds = new Set(),
  knownPageIds = new Set(),
  customerKeySecret,
  now,
}) {
  const workspacesByProfile = new Map();
  for (const owner of owners) {
    const profileId = String(owner?.profile_id ?? "");
    const workspaceId = uuid(owner?.workspace_id);
    if (!profileId || !workspaceId) continue;
    if (!workspacesByProfile.has(profileId)) workspacesByProfile.set(profileId, new Set());
    workspacesByProfile.get(profileId).add(workspaceId);
  }
  const kits = latestKits(brandKits);
  const ownerWorkspaces = new Set([...workspacesByProfile.values()].flatMap((workspaces) => [...workspaces]));
  const rows = new Map();

  for (const source of sources) {
    const workspaces = workspacesByProfile.get(String(source?.profile_id ?? "")) || new Set();
    for (const workspaceId of workspaces) {
      const kit = kits.get(workspaceId);
      const sourceAgentId = uuid(source?.agent_id);
      const sourcePageId = uuid(source?.advertiser_page_id);
      const assignedPageId = uuid(assignedPageIds.get(workspaceId));
      const sourcePostcode = postcode(source?.postcode);
      const kitPostcode = extractContactPostcode(kit?.contact_json);
      const sourceState = state(source?.state);
      const kitState = state(kit?.market_region) || state(contactValue(kit?.contact_json, ["state", "region"]));
      const row = {
        customer_key: customerInterestKey(workspaceId, customerKeySecret),
        agent_id: sourceAgentId && knownAgentIds.has(sourceAgentId) ? sourceAgentId : null,
        advertiser_page_id: sourcePageId && knownPageIds.has(sourcePageId) ? sourcePageId : (assignedPageId && knownPageIds.has(assignedPageId) ? assignedPageId : null),
        postcode: preferredValue(source, sourcePostcode, kitPostcode),
        state: preferredValue(source, sourceState, kitState),
        active: source?.active !== false,
        last_synced_at: now,
        updated_at: now,
      };
      if (row.agent_id || row.advertiser_page_id || row.postcode) rows.set(workspaceId, row);
    }
  }

  for (const workspaceId of ownerWorkspaces) {
    if (rows.has(workspaceId)) continue;
    const kit = kits.get(workspaceId);
    const pageId = uuid(assignedPageIds.get(workspaceId));
    const value = extractContactPostcode(kit?.contact_json);
    if (!pageId && !value) continue;
    rows.set(workspaceId, {
      customer_key: customerInterestKey(workspaceId, customerKeySecret),
      agent_id: null,
      advertiser_page_id: pageId && knownPageIds.has(pageId) ? pageId : null,
      postcode: value,
      state: state(kit?.market_region) || state(contactValue(kit?.contact_json, ["state", "region"])),
      active: true,
      last_synced_at: now,
      updated_at: now,
    });
  }
  return [...rows.values()];
}

async function registerAssignedPages(researchRest, assignments, ownerWorkspaceIds, knownPages, now) {
  const candidates = new Map();
  for (const assignment of assignments) {
    const workspaceId = uuid(assignment?.workspace_id);
    const pageId = metaPageId(assignment?.page_id);
    if (!workspaceId || !ownerWorkspaceIds.has(workspaceId) || !pageId || knownPages.has(pageId) || candidates.has(pageId)) continue;
    const pageName = String(assignment?.page_name ?? "").trim() || "Meta page " + pageId;
    candidates.set(pageId, {
      platform: "facebook",
      page_id: pageId,
      page_name: pageName,
      owner_type: "unknown",
      status: "resolved_collectable",
      scan_enabled: true,
      metadata: { source: "customer_meta_assignment" },
    });
  }
  const values = [...candidates.values()];
  for (let index = 0; index < values.length; index += WRITE_SIZE) {
    const response = await researchRest("research", "advertiser_pages?on_conflict=platform,page_id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(values.slice(index, index + WRITE_SIZE)),
    });
    if (Array.isArray(response)) {
      for (const row of response) {
        const id = uuid(row?.id);
        const pageId = metaPageId(row?.page_id);
        if (id && pageId) knownPages.set(pageId, id);
      }
    }
  }
  const unresolved = values.map((row) => row.page_id).filter((pageId) => !knownPages.has(pageId));
  if (unresolved.length) {
    const refreshed = await knownResearchPagesByMetaIds(researchRest, unresolved);
    for (const [pageId, id] of refreshed) knownPages.set(pageId, id);
  }
  return knownPages;
}

async function writeBatches(researchRest, rows) {
  for (let index = 0; index < rows.length; index += WRITE_SIZE) {
    await researchRest("research", TARGET_TABLE + "?on_conflict=customer_key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(rows.slice(index, index + WRITE_SIZE)),
    });
  }
}

export async function syncCustomerAdRadarInterests({
  researchRest,
  env = process.env,
  fetchImpl = fetch,
  now = new Date().toISOString(),
  customerKeySecret = env.HERMES_AD_RADAR_CUSTOMER_KEY_SECRET || env.AD_RADAR_CUSTOMER_KEY_SECRET,
}) {
  const customerRest = customerRestFor(env, fetchImpl);
  if (!customerRest) return { skipped: true, reason: "customer_supabase_not_configured" };
  if (typeof researchRest !== "function") throw new Error("Research REST client is required for customer freshness sync.");
  if (!customerKeySecret || String(customerKeySecret).length < 16) throw new Error("Customer freshness key secret is missing or too short.");

  // These reads form one complete product snapshot. No research rows are changed
  // until every read has succeeded and each response has the expected array shape.
  const [sources, members, brandKits, assignments] = await Promise.all([
    readAll(customerRest, SOURCE_TABLE, "profile_id,postcode,state,agent_id,advertiser_page_id,source,active,updated_at", "updated_at.desc"),
    readAll(customerRest, "workspace_members", "workspace_id,profile_id,role"),
    readAll(customerRest, "adstudio_brand_kits", "workspace_id,contact_json,market_region,updated_at", "updated_at.desc"),
    readAll(customerRest, ASSIGNMENTS_TABLE, "workspace_id,page_id,page_name,updated_at", "updated_at.desc"),
  ]);

  const ownerRows = members.filter((row) => row?.role === "owner");
  const ownerWorkspaceIds = new Set(ownerRows.map((row) => uuid(row?.workspace_id)).filter(Boolean));
  const sourceAgentIds = sources.map((row) => uuid(row?.agent_id)).filter(Boolean);
  const sourcePageIds = sources.map((row) => uuid(row?.advertiser_page_id)).filter(Boolean);
  const assignmentPageIds = assignments.map((row) => metaPageId(row?.page_id)).filter(Boolean);
  const [knownAgentIds, knownSourcePageIds, knownAssignmentPages, existing] = await Promise.all([
    knownIds(researchRest, "agents", [...new Set(sourceAgentIds)]),
    knownIds(researchRest, "advertiser_pages", [...new Set(sourcePageIds)]),
    knownResearchPagesByMetaIds(researchRest, [...new Set(assignmentPageIds)]),
    researchRest("research", TARGET_TABLE + "?select=customer_key,agent_id,advertiser_page_id,postcode,state,active,last_synced_at,updated_at&limit=10000"),
  ]);
  if (!Array.isArray(existing)) throw new Error("Research interest snapshot returned a non-array");

  const knownPageIds = new Set([...knownSourcePageIds, ...knownAssignmentPages.values()]);
  await registerAssignedPages(researchRest, assignments, ownerWorkspaceIds, knownAssignmentPages, now);
  for (const [pageId, id] of knownAssignmentPages) knownPageIds.add(id);
  const rows = buildCustomerInterestRows({
    sources,
    owners: ownerRows,
    brandKits,
    assignedPageIds: new Map(assignments
      .map((assignment) => [uuid(assignment?.workspace_id), knownAssignmentPages.get(metaPageId(assignment?.page_id))])
      .filter(([workspaceId, pageId]) => workspaceId && pageId)),
    knownAgentIds,
    knownPageIds,
    customerKeySecret,
    now,
  });
  const byKey = new Map(rows.map((row) => [row.customer_key, row]));
  const stale = existing
    .filter((row) => row?.customer_key && !byKey.has(row.customer_key) && row.active !== false)
    .map((row) => ({ ...row, active: false, last_synced_at: now, updated_at: now }));
  await writeBatches(researchRest, [...rows, ...stale]);
  return {
    skipped: false,
    active: rows.filter((row) => row.active).length,
    inactive: rows.filter((row) => !row.active).length + stale.length,
    upserted: rows.length + stale.length,
    sourceRows: sources.length,
  };
}
