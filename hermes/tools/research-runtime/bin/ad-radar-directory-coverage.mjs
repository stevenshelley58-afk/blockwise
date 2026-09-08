#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { parseFacebookPageIdentity } from "./facebook-page-identity.mjs";
export const DIRECTORY_DISCOVERY_JOB_TYPE = "blockwise-ad-directory-discovery";
export const DIRECTORY_COVERAGE_VERSION = "ad-radar-directory-coverage-v2";
const FB_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "web.facebook.com",
  "fb.com",
]);
const FB_BLOCKED =
  /^(?:share|sharer|plugins?|dialog|login|help|ads|tr|events|groups?|posts?|reel|watch)(?:\/|$)/iu;
const FB_ID = /^\d{5,}$/u;
const PAGE_SIZE_MAX = 500;
function s(value) {
  return String(value ?? "").trim();
}
function checkedAt(now) {
  return typeof now === "function" ? now() : new Date().toISOString();
}
function normalizedPageUrl(value) {
  const reference = facebookPageReference(value);
  return reference.reason === null ||
    reference.reason === "facebook_page_id_missing"
    ? reference.url
    : null;
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function hash(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : stable(value))
    .digest("hex");
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function key(kind, id) {
  return `${s(kind).toLowerCase()}:${s(id)}`;
}
export function normalizeState(value) {
  const state = s(value).toUpperCase();
  return ["WA", "NSW", "VIC", "QLD", "SA", "TAS", "ACT", "NT"].includes(state)
    ? state
    : null;
}
export function isEligibleWaEntity(entity) {
  return normalizeState(entity?.state) === "WA" && s(entity?.id) !== "";
}
function canonical(parsed, pageId = null) {
  const out = new URL(parsed.toString());
  out.protocol = "https:";
  out.hostname = "www.facebook.com";
  out.username = "";
  out.password = "";
  out.search = "";
  out.hash = "";
  if (pageId) out.pathname = `/${pageId}`;
  return out.toString();
}
export function facebookPageReference(value) {
  const raw = s(value);
  if (FB_ID.test(raw))
    return {
      url: `https://www.facebook.com/${raw}`,
      pageId: raw,
      vanity: null,
      reason: null,
    };
  if (!raw)
    return { url: null, pageId: null, vanity: null, reason: "empty_url" };
  let parsed;
  try {
    parsed = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { url: raw, pageId: null, vanity: null, reason: "invalid_url" };
  }
  if (!FB_HOSTS.has(parsed.hostname.toLowerCase()))
    return { url: raw, pageId: null, vanity: null, reason: "not_facebook" };
  let path;
  try {
    path = parsed.pathname
      .split("/")
      .map((part) => decodeURIComponent(part))
      .filter(Boolean);
  } catch {
    return { url: raw, pageId: null, vanity: null, reason: "invalid_url" };
  }
  if (!path.length || FB_BLOCKED.test(path.join("/")))
    return {
      url: raw,
      pageId: null,
      vanity: null,
      reason: "non_page_facebook_path",
    };
  if (
    path.some((part) =>
      /^(posts?|photos?|videos?|reels?|stories|permalink\.php)$/iu.test(part),
    )
  )
    return {
      url: raw,
      pageId: null,
      vanity: null,
      reason: "non_page_facebook_path",
    };
  const queryId = parsed.searchParams.get("id");
  const numeric =
    path[0] === "profile.php" && FB_ID.test(queryId || "")
      ? queryId
      : path.length === 1 && FB_ID.test(path[0])
        ? path[0]
        : path[0].toLowerCase() === "pages" && FB_ID.test(path.at(-1))
          ? path.at(-1)
          : null;
  if (!numeric && path.length > 1 && path[0].toLowerCase() !== "pages")
    return {
      url: raw,
      pageId: null,
      vanity: null,
      reason: "non_page_facebook_path",
    };
  if (numeric)
    return {
      url: canonical(parsed, numeric),
      pageId: numeric,
      vanity: null,
      reason: null,
    };
  const vanity = path.find(
    (part) => !/^pages?$/iu.test(part) && !/^profile\.php$/iu.test(part),
  );
  return vanity
    ? {
        url: canonical(parsed),
        pageId: null,
        vanity,
        reason: "facebook_page_id_missing",
      }
    : {
        url: raw,
        pageId: null,
        vanity: null,
        reason: "facebook_page_id_missing",
      };
}
export function extractExactFacebookLinks(values) {
  const output = [];
  for (const item of Array.isArray(values) ? values : [values]) {
    const source =
      typeof item === "string"
        ? { url: item }
        : item && typeof item === "object"
          ? item
          : null;
    if (!source) continue;
    const reference = facebookPageReference(
      source.url || source.href || source.facebook_url || source.facebookUrl,
    );
    if (
      !reference.url ||
      [
        "not_facebook",
        "invalid_url",
        "empty_url",
        "non_page_facebook_path",
      ].includes(reference.reason)
    )
      continue;
    output.push({
      url: reference.url,
      pageId: FB_ID.test(s(source.pageId || source.page_id))
        ? s(source.pageId || source.page_id)
        : reference.pageId,
      vanity: reference.vanity,
      reason: reference.reason,
      entityKind:
        s(source.entityKind || source.entity_kind).toLowerCase() || null,
      entityId: s(source.entityId || source.entity_id) || null,
      ownerKind: s(source.ownerKind || source.owner_kind).toLowerCase() || null,
      sourceType: s(source.sourceType || source.source_type) || null,
      sourceDocumentId:
        s(source.sourceDocumentId || source.source_document_id) || null,
      isOfficial: source.isOfficial === true || source.is_official === true,
      explicitAssignment:
        source.explicitAssignment === true ||
        source.explicit_assignment === true,
      existingDisabled: source.existingDisabled === true,
    });
  }
  const seen = new Set();
  return output.filter((item) => {
    const k = `${item.entityKind}:${item.entityId}:${item.url}:${item.sourceDocumentId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
export function extractFacebookLinksFromHtml(baseUrl, html) {
  const body = s(html).slice(0, 2000000);
  const links = [];
  const attr = /(?:href|content)\s*=\s*["']([^"']+)["']/giu;
  for (const match of body.matchAll(attr)) {
    try {
      const url = new URL(match[1], baseUrl);
      if (FB_HOSTS.has(url.hostname.toLowerCase()))
        links.push({ url: url.toString() });
    } catch {}
  }
  for (const match of body.matchAll(
    /https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/[^\s"'<>]+/giu,
  ))
    links.push({ url: match[0] });
  return extractExactFacebookLinks(links);
}
const directoryHosts = new Set([
  "reiwa.com.au",
  "realestate.com.au",
  "domain.com.au",
  "ratemyagent.com.au",
  "homely.com.au",
  "soho.com.au",
  "allhomes.com.au",
]);
const blockedAgencyWebsiteHosts = new Set([
  ...directoryHosts,
  "facebook.com",
  "fb.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "tiktok.com",
  "itunes.apple.com",
  "apps.apple.com",
  "google.com",
]);
const identityName = (value) =>
  s(value)
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
function isBlockedAgencyWebsiteUrl(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./u, "").toLowerCase();
    return [...blockedAgencyWebsiteHosts].some(
      (domain) => host === domain || host.endsWith("." + domain),
    );
  } catch {
    return true;
  }
}
function coherentAgencyIdentity(name, body) {
  const expected = identityName(name);
  if (!expected) return false;
  const owners = facebookOwnersFromHtml(body);
  if (
    owners.some(
      (owner) =>
        owner.kind === "agency" && identityName(owner.name) === expected,
    )
  )
    return true;
  const visible = identityName(
    s(body)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]+>/gu, " "),
  );
  return visible.includes(expected);
}
export function facebookOwnersFromHtml(html) {
  const owners = [];
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 20) return;
    if (Array.isArray(value)) {
      for (const row of value) visit(row, depth + 1);
      return;
    }
    const types = [value["@type"]].flat();
    const kind = types.includes("Person")
      ? "agent"
      : types.some((type) =>
            ["Organization", "RealEstateAgent", "LocalBusiness"].includes(type),
          )
        ? "agency"
        : null;
    const urls = extractExactFacebookLinks([value.sameAs || []].flat()).map(
      (link) => link.url,
    );
    if (kind && value.name && urls.length)
      owners.push({ kind, name: s(value.name), urls });
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  for (const match of s(html).matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu,
  )) {
    try {
      visit(JSON.parse(match[1]));
    } catch {
      /* invalid structured evidence is not ownership */
    }
  }
  return owners;
}
export function linksForWebsiteEvidence(item, website, evidence) {
  const metadata = evidence.metadata || {};
  const assigned = (metadata.facebook_owners || []).filter(
    (owner) =>
      owner.kind === item.kind &&
      identityName(owner.name) === identityName(item.name),
  );
  const urls = assigned.flatMap((owner) => owner.urls || []);
  const host = new URL(website).hostname.replace(/^www\./u, "").toLowerCase();
  const directory = [...directoryHosts].some(
    (domain) => host === domain || host.endsWith("." + domain),
  );
  // Directory footer links prove the directory's identity, not the listed agency's.
  // Person ownership always requires an explicit sameAs assignment.
  const agentAssigned =
    item.kind === "agent" &&
    s(metadata.agent_id || metadata.agentId) === item.id
      ? metadata.official_facebook_links || []
      : [];
  const fallback =
    item.kind === "agency" &&
    !directory &&
    urls.length === 0 &&
    metadata.agency_identity_confirmed === true &&
    identityName(metadata.agency_identity_name) === identityName(item.name)
      ? metadata.official_facebook_links || []
      : [];
  return extractExactFacebookLinks(
    [...urls, ...agentAssigned, ...fallback].map((url) => ({
      url,
      entityKind: item.kind,
      entityId: item.id,
      ownerKind: item.kind,
      isOfficial: true,
      explicitAssignment: urls.includes(url) || agentAssigned.includes(url),
      sourceType: urls.includes(url)
        ? "structured_same_as"
        : agentAssigned.includes(url)
          ? "named_agent_profile"
          : "official_entity_website",
      sourceDocumentId: evidence.id,
    })),
  );
}
export function facebookPageIdFromHtml(html, vanity = null) {
  if (!vanity) return null;
  const parsed = parseFacebookPageIdentity(
    html,
    "https://www.facebook.com/" + s(vanity),
  );
  return parsed?.pageId || null;
}
function entity(row, kind) {
  return {
    kind,
    id: s(row?.id),
    key: key(kind, row?.id),
    name: s(row?.full_name || row?.name),
    state: normalizeState(row?.state),
    postcode: s(row?.primary_postcode || row?.postcode) || null,
    primarySuburb: s(row?.primary_suburb || row?.primarySuburb) || null,
    agencyPrimarySuburb:
      s(row?.agency_primary_suburb || row?.agencyPrimarySuburb) || null,
    websiteUrl: s(row?.website_url || row?.websiteUrl) || null,
    agencyWebsiteUrl:
      s(row?.agency_website_url || row?.agencyWebsiteUrl) || null,
    agencyName: s(row?.agency_name || row?.agencyName) || null,
    agencyId: s(row?.agency_id || row?.agencyId) || null,
  };
}
export function explicitLinksForEntity(row, sourceDocuments = []) {
  const kind = s(row?.kind).toLowerCase(),
    id = s(row?.id),
    links = [];
  if (row?.website_url || row?.websiteUrl)
    links.push({
      entityKind: kind,
      entityId: id,
      ownerKind: kind,
      isOfficial: true,
      sourceType: "official_entity_website",
      url: row.website_url || row.websiteUrl,
    });
  for (const doc of Array.isArray(sourceDocuments) ? sourceDocuments : []) {
    const meta =
      doc?.metadata && typeof doc.metadata === "object" ? doc.metadata : {};
    if (
      s(meta.entity_id || meta.subject_id) !== id ||
      s(meta.entity_kind || meta.subject_kind).toLowerCase() !== kind
    )
      continue;
    const evidenceUrl = safePublicHttpsUrl(doc.source_url || meta.website_url);
    if (evidenceUrl && isBlockedAgencyWebsiteUrl(evidenceUrl)) continue;
    const embedded =
      meta.official_facebook_links ||
      meta.official_links ||
      meta.facebook_links ||
      [];
    for (const link of Array.isArray(embedded) ? embedded : [embedded])
      links.push({
        ...(typeof link === "object" ? link : { url: link }),
        entityKind: kind,
        entityId: id,
        ownerKind: kind,
        isOfficial: true,
        sourceType: doc.source || "saved_source",
        sourceDocumentId: doc.id,
        explicitAssignment: meta.explicit_meta_assignment === true,
      });
  }
  return links;
}
export function buildDirectoryCoveragePlan({
  entities = [],
  sourceLinks = [],
  existingPages = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const roster = new Map();
  for (const row of entities) {
    const kind = s(row?.kind).toLowerCase();
    if (!["agent", "agency"].includes(kind)) continue;
    const item = entity(row, kind);
    if (isEligibleWaEntity(item)) roster.set(item.key, item);
  }
  const grouped = new Map();
  for (const link of extractExactFacebookLinks(sourceLinks)) {
    const k = key(link.entityKind, link.entityId);
    if (roster.has(k)) {
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k).push(link);
    }
  }
  const existing = new Set(
    (existingPages || []).map(
      (row) =>
        `${key(row.entityKind || row.entity_kind, row.entityId || row.entity_id)}:${s(row.pageId || row.page_id)}`,
    ),
  );
  const rows = [...roster.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((item) => {
      const rejected = [],
        valid = new Map();
      for (const link of grouped.get(item.key) || []) {
        if (!link.isOfficial) {
          rejected.push({
            url: link.url,
            reason: "source_not_explicitly_official",
          });
          continue;
        }
        if (
          item.kind === "agent" &&
          !(link.ownerKind === "agent" && link.explicitAssignment)
        ) {
          rejected.push({
            url: link.url,
            reason: "agent_profile_link_not_ownership",
          });
          continue;
        }
        if (
          item.kind === "agency" &&
          link.ownerKind &&
          link.ownerKind !== "agency"
        ) {
          rejected.push({ url: link.url, reason: "ownership_kind_mismatch" });
          continue;
        }
        if (!link.pageId) {
          rejected.push({
            url: link.url,
            reason: link.reason || "facebook_page_id_missing",
          });
          continue;
        }
        valid.set(link.pageId, link);
      }
      const candidates = [...valid.values()]
        .map((link) => ({
          pageId: link.pageId,
          url: link.url,
          sourceDocumentId: link.sourceDocumentId,
          sourceType: link.sourceType,
          existingAdvertiserPageId: link.existingAdvertiserPageId || null,
          existingDisabled: link.existingDisabled === true,
        }))
        .sort((a, b) => a.pageId.localeCompare(b.pageId));
      const sourceDocumentIds = [
        ...new Set(
          (grouped.get(item.key) || [])
            .map((link) => link.sourceDocumentId)
            .filter(Boolean),
        ),
      ].sort();
      let status = "unmapped",
        reason = rejected[0]?.reason || "no_explicit_page_evidence";
      if (candidates.length === 1) {
        status = existing.has(`${item.key}:${candidates[0].pageId}`)
          ? "covered"
          : "candidate";
        reason =
          status === "covered"
            ? "existing_exact_page"
            : "exact_official_page_link";
      } else if (candidates.length > 1) {
        status = "ambiguous";
        reason = "multiple_exact_page_candidates";
      }
      return {
        coverageKey: item.key,
        kind: item.kind,
        entityId: item.id,
        name: item.name,
        state: item.state,
        postcode: item.postcode,
        websiteUrl: item.websiteUrl,
        status,
        reason,
        candidates,
        sourceDocumentIds,
        rejected,
      };
    });
  return {
    version: DIRECTORY_COVERAGE_VERSION,
    generatedAt,
    eligibleEntities: rows.length,
    covered: rows.filter((r) => r.status === "covered").length,
    candidates: rows.filter((r) => r.status === "candidate").length,
    ambiguous: rows.filter((r) => r.status === "ambiguous").length,
    unmapped: rows.filter((r) => r.status === "unmapped").length,
    rows,
  };
}
function checkpointShape(input = {}) {
  const out = input && typeof input === "object" ? clone(input) : {};
  out.version = DIRECTORY_COVERAGE_VERSION;
  out.kinds ||= {};
  out.entityCursor =
    Number.isInteger(out.entityCursor) && out.entityCursor >= 0
      ? out.entityCursor
      : 0;
  for (const kind of ["agent", "agency"]) {
    out.kinds[kind] ||= {};
    const x = out.kinds[kind];
    x.pageSize ??= null;
    x.completedPages = [
      ...new Set((x.completedPages || []).map(Number).filter(Number.isInteger)),
    ].sort((a, b) => a - b);
    x.rowCounts ||= {};
    x.pageDigests ||= {};
    x.rowsByPage ||= {};
    x.exhausted ??= false;
  }
  return out;
}
export async function enumerateDirectoryPages({
  fetchPage,
  kinds = ["agent", "agency"],
  pageSize = 500,
  checkpoint = {},
  onCheckpoint = null,
} = {}) {
  if (typeof fetchPage !== "function") throw new Error("fetchPage is required");
  const size = Number(pageSize);
  if (!Number.isInteger(size) || size < 1 || size > PAGE_SIZE_MAX)
    throw new Error(`directory page size must be 1..${PAGE_SIZE_MAX}`);
  const state = checkpointShape(checkpoint),
    rows = [];
  for (const kind of kinds) {
    if (!["agent", "agency"].includes(kind))
      throw new Error(`unsupported directory kind: ${kind}`);
    const x = state.kinds[kind];
    if (x.pageSize && x.pageSize !== size)
      throw new Error(`${kind} checkpoint page size changed`);
    x.pageSize = size;
    if (x.exhausted) {
      for (const page of [...x.completedPages].sort((a, b) => a - b)) {
        const saved = x.rowsByPage[String(page)];
        if (!Array.isArray(saved))
          throw new Error("Missing completed directory page");
        rows.push(...saved.map((row) => ({ ...row, kind })));
      }
      continue;
    }
    let index = 0;
    while (!x.exhausted) {
      const saved = Array.isArray(x.rowsByPage[String(index)])
        ? x.rowsByPage[String(index)]
        : null;
      if (x.completedPages.includes(index)) {
        if (saved) rows.push(...saved.map((r) => ({ ...r, kind })));
        if (Number(x.rowCounts[String(index)]) < size) x.exhausted = true;
        index += 1;
        continue;
      }
      const response = await fetchPage(kind, index, size);
      if (!response || !Array.isArray(response.rows))
        throw new Error(`${kind} page ${index} did not return rows[]`);
      const total =
        response.totalRecords == null ? null : Number(response.totalRecords);
      if (total != null && (!Number.isInteger(total) || total < 0))
        throw new Error(`${kind} page ${index} returned invalid totalRecords`);
      if (x.totalRecords != null && total != null && x.totalRecords !== total)
        throw new Error(`${kind} totalRecords changed during enumeration`);
      if (total != null) x.totalRecords = total;
      x.pageCount = total == null ? null : Math.ceil(total / size);
      x.completedPages.push(index);
      x.completedPages.sort((a, b) => a - b);
      x.rowCounts[String(index)] = response.rows.length;
      x.pageDigests[String(index)] = hash(response.rows);
      x.rowsByPage[String(index)] = response.rows;
      rows.push(...response.rows.map((r) => ({ ...r, kind })));
      if (
        (x.pageCount != null && index + 1 >= x.pageCount) ||
        (x.pageCount == null && response.rows.length < size)
      )
        x.exhausted = true;
      if (typeof onCheckpoint === "function") await onCheckpoint(clone(state));
      index += 1;
    }
  }
  state.completedAt = new Date().toISOString();
  state.rowCount = rows.length;
  return { rows, checkpoint: state };
}
export async function readDirectoryCheckpoint(path) {
  try {
    return checkpointShape(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return checkpointShape();
    throw error;
  }
}
export async function writeDirectoryCheckpoint(path, checkpoint) {
  return writeAtomicJson(path, checkpointShape(checkpoint));
}
export async function writeCoverageManifest(path, manifest) {
  return writeAtomicJson(path, manifest);
}
async function writeAtomicJson(path, value) {
  if (!s(path)) throw new Error("checkpoint path is required");
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await writeFile(
    tmp,
    `${JSON.stringify(value, null, 2)}
`,
    { mode: 0o600 },
  );
  await rename(tmp, path);
  return path;
}
async function fetchDirectoryRows(rest, kind, index, size) {
  const table = kind === "agent" ? "agents" : "agencies";
  const select =
    kind === "agent"
      ? "id,full_name,state,primary_postcode,website_url,agency_id"
      : "id,name,state,primary_postcode,website_url,is_real_estate";
  const rows = await rest(
    "research",
    `${table}?select=${select}&state=eq.WA&order=id.asc&limit=${size}&offset=${index * size}`,
  );
  if (!Array.isArray(rows))
    throw new Error(`${table} response was not an array`);
  return { rows, totalRecords: null };
}
function enc(value) {
  return encodeURIComponent(s(value));
}
export async function enqueueAdRadarDirectoryDiscovery({
  rest,
  now = () => new Date().toISOString(),
  buildRunId = null,
  priority = 12,
  entityLimit = 50,
} = {}) {
  if (typeof rest !== "function") throw new Error("rest is required");
  const sweep = String(Math.floor(Date.parse(now()) / (7 * 86400000)));
  // The version is part of the key so a new coverage pass is not held behind
  // an old weekly job. It still remains one idempotent pass per week/version.
  const dedupeKey = `ad-radar:directory:wa:${DIRECTORY_COVERAGE_VERSION}:${sweep}`;
  const existing = await rest(
    "research",
    `work_queue?select=id,status&dedupe_key=eq.${enc(dedupeKey)}&limit=10`,
  );
  const current = (existing || []).find((row) => row.status);
  if (current?.id)
    return {
      enqueued: false,
      jobId: current.id,
      dedupeKey,
      status: current.status,
    };
  const payload = {
    handler: DIRECTORY_DISCOVERY_JOB_TYPE,
    scope: "WA",
    build_run_id: s(buildRunId) || null,
    sweep_id: `${DIRECTORY_COVERAGE_VERSION}:${sweep}`,
    entity_limit: Math.max(1, Math.min(100, Number(entityLimit) || 50)),
    directory_coverage_version: DIRECTORY_COVERAGE_VERSION,
  };
  const created = await rest("research", "work_queue", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      queue_name: "research",
      job_type: DIRECTORY_DISCOVERY_JOB_TYPE,
      dedupe_key: dedupeKey,
      priority,
      payload,
      status: "pending",
      available_at: now(),
      max_attempts: 3,
    }),
  });
  return {
    enqueued: Boolean(created?.[0]?.id),
    jobId: created?.[0]?.id || null,
    dedupeKey,
    status: "pending",
  };
}
async function enqueueEntityDiscovery(
  rest,
  item,
  buildRunId,
  now,
  priority = 13,
) {
  const dedupeKey = `ad-radar:directory:entity:${DIRECTORY_COVERAGE_VERSION}:${item.kind}:${item.id}:${buildRunId}`;
  const existing = await rest(
    "research",
    `work_queue?select=id,status&dedupe_key=eq.${enc(dedupeKey)}&limit=10`,
  );
  const current = (existing || []).find((row) => row.status);
  if (
    current?.status === "pending" ||
    current?.status === "claimed" ||
    current?.status === "complete" ||
    current?.status === "failed" ||
    current?.status === "blocked"
  )
    return {
      enqueued: false,
      jobId: current.id,
      status: current.status,
      dedupeKey,
    };
  const created = await rest("research", "work_queue", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      queue_name: "research",
      job_type: "blockwise-ad-directory-discovery-entity",
      dedupe_key: dedupeKey,
      priority,
      payload: {
        handler: "blockwise-ad-directory-discovery-entity",
        scope: "WA",
        build_run_id: buildRunId,
        entity_kind: item.kind,
        entity_id: item.id,
        name: item.name,
        state: item.state,
        primary_postcode: item.postcode,
        website_url: item.websiteUrl,
        agency_website_url: item.agencyWebsiteUrl,
        agency_id: item.agencyId,
        agency_name: item.agencyName,
        directory_coverage_version: DIRECTORY_COVERAGE_VERSION,
      },
      status: "pending",
      available_at: now(),
      max_attempts: 3,
    }),
  });
  return {
    enqueued: Boolean(created?.[0]?.id),
    jobId: created?.[0]?.id || null,
    status: "pending",
    dedupeKey,
  };
}
export async function handleAdRadarPageDiscovery(
  job,
  {
    rest,
    now = () => new Date().toISOString(),
    rawEvidenceDir = process.env.RAW_EVIDENCE_DIR || "/tmp",
    maxEntities = null,
    pageSize = 500,
  } = {},
) {
  if (!job?.id || typeof rest !== "function")
    throw new Error("job and rest are required");
  const payload = job.payload || {};
  const buildRunId =
    s(payload.sweep_id) || s(payload.build_run_id) || s(job.id);
  const root = s(rawEvidenceDir) || "/tmp";
  const suffix = hash(`${DIRECTORY_COVERAGE_VERSION}:${buildRunId}`).slice(
    0,
    16,
  );
  const checkpointPath = join(
    root,
    `ad-radar-directory-${suffix}.checkpoint.json`,
  );
  const checkpoint = await readDirectoryCheckpoint(checkpointPath);
  const enumerated = await enumerateDirectoryPages({
    pageSize,
    checkpoint,
    fetchPage: (kind, index, size) =>
      fetchDirectoryRows(rest, kind, index, size),
    onCheckpoint: (next) => writeDirectoryCheckpoint(checkpointPath, next),
  });
  const state = enumerated.checkpoint;
  const roster = enumerated.rows
    .map((row) => entity(row, row.kind))
    .filter(isEligibleWaEntity);
  const agencies = new Map(
    roster.filter((row) => row.kind === "agency").map((row) => [row.id, row]),
  );
  const entities = roster
    .map((row) => {
      if (row.kind !== "agent" || !row.agencyId) return row;
      const agency = agencies.get(row.agencyId);
      return agency
        ? {
            ...row,
            agencyName: row.agencyName || agency.name,
            agencyWebsiteUrl: agency.websiteUrl,
          }
        : row;
    })
    .sort((a, b) => {
      const family = (row) =>
        row.kind === "agency"
          ? row.id
          : row.agencyId && agencies.has(row.agencyId)
            ? row.agencyId
            : null;
      const af = family(a),
        bf = family(b);
      if (af && bf && af !== bf) return af.localeCompare(bf);
      if (af && !bf) return -1;
      if (!af && bf) return 1;
      const rank = { agency: 0, agent: 1 };
      return rank[a.kind] - rank[b.kind] || a.key.localeCompare(b.key);
    });
  const limit = Math.max(
    1,
    Math.min(Number(maxEntities || payload.entity_limit || 50) || 50, 100),
  );
  const cursor = Number(payload.entity_cursor ?? state.entityCursor ?? 0);
  const selected = entities.slice(cursor, cursor + limit);
  const queued = [];
  for (const item of selected)
    queued.push(await enqueueEntityDiscovery(rest, item, buildRunId, now));
  state.entityCursor = cursor + selected.length;
  state.lastEntitySweepAt = now();
  await writeDirectoryCheckpoint(checkpointPath, state);
  if (state.entityCursor < entities.length) {
    const nextKey = `ad-radar:directory:wa:${buildRunId}:cursor:${state.entityCursor}`;
    const existing = await rest(
      "research",
      `work_queue?select=id&dedupe_key=eq.${enc(nextKey)}&limit=1`,
    );
    if (!existing.length)
      await rest("research", "work_queue", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          queue_name: "research",
          job_type: DIRECTORY_DISCOVERY_JOB_TYPE,
          dedupe_key: nextKey,
          priority: 12,
          status: "pending",
          available_at: now(),
          max_attempts: 3,
          payload: {
            ...payload,
            handler: DIRECTORY_DISCOVERY_JOB_TYPE,
            sweep_id: buildRunId,
            entity_cursor: state.entityCursor,
          },
        }),
      });
  }
  return {
    status: "complete",
    result: {
      handler: DIRECTORY_DISCOVERY_JOB_TYPE,
      build_run_id: buildRunId,
      enumerated_entities: entities.length,
      selected_entities: selected.length,
      queued_entities: queued.filter((row) => row.enqueued).length,
      already_queued_entities: queued.filter((row) => !row.enqueued).length,
      checkpoint_path: checkpointPath,
      unresolved_is_not_zero: true,
    },
  };
}
function safePublicHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null;
    const host = url.hostname.toLowerCase();
    if (
      !host.includes(".") ||
      host.includes(":") ||
      host.startsWith("[") ||
      host === "localhost" ||
      host.endsWith(".local") ||
      host === "metadata.google.internal" ||
      host === "169.254.169.254" ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}
async function readBoundedBody(response, maxBytes = 5000000) {
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(
          "response body exceeded bounded directory evidence size",
        );
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }
  const body = await response.text();
  if (Buffer.byteLength(body) > maxBytes)
    throw new Error("response body exceeded bounded directory evidence size");
  return body;
}
export function isPublicDirectoryAddress(address) {
  const parts = String(address).split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return false;
  const [a, b] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0)
  );
}
async function publicFetch(url, { signal }) {
  const parsed = new URL(url);
  const addresses = await lookup(parsed.hostname, { all: true, family: 4 });
  if (
    !addresses.length ||
    addresses.some((row) => !isPublicDirectoryAddress(row.address))
  )
    throw new Error("Directory hostname resolves to a non-public address");
  signal.throwIfAborted();
  // Pin validated DNS for this connection; redirects are checked separately.
  return new Promise((resolve, reject) => {
    const selected = addresses[0];
    const req = request(
      parsed,
      {
        signal,
        lookup: (_host, options, callback) =>
          options.all
            ? callback(null, [selected])
            : callback(null, selected.address, 4),
        headers: {
          "user-agent": "Blockwise Ad Radar directory verification",
          accept: "text/html",
        },
      },
      async (response) => {
        try {
          const chunks = [];
          let size = 0;
          for await (const chunk of response) {
            size += chunk.length;
            if (size > 5000000) {
              response.destroy();
              throw new Error("Directory response body too large");
            }
            chunks.push(chunk);
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode,
              headers: response.headers,
            }),
          );
        } catch (error) {
          reject(error);
        }
      },
    );
    req.on("error", reject);
    req.end();
  });
}
export async function boundedDirectoryFetch(
  fetchImpl,
  url,
  { timeoutMs = 15000, retries = 1 } = {},
) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let current = url;
      for (let redirects = 0; redirects <= 3; redirects++) {
        const safe = safePublicHttpsUrl(current);
        if (!safe) throw new Error("Unsafe public HTTPS directory URL");
        const response = await (
          fetchImpl === globalThis.fetch ? publicFetch : fetchImpl
        )(safe, {
          signal: controller.signal,
          redirect: "manual",
          headers: {
            accept: "text/html",
            "user-agent": "Blockwise Ad Radar directory verification",
          },
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers?.get?.("location");
          if (!location) throw new Error("Directory redirect missing location");
          current = new URL(location, safe).toString();
          continue;
        }
        if (!response.ok) throw new Error(`Directory HTTP ${response.status}`);
        return await readBoundedBody(response);
      }
      throw new Error("Directory redirect limit reached");
    } catch (error) {
      last = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}
const recentFetches = new Map();
function boundedFetch(fetchImpl, url, options) {
  const existing = recentFetches.get(url);
  if (existing?.fetchImpl === fetchImpl) return existing.promise;
  const promise = boundedDirectoryFetch(fetchImpl, url, options);
  const entry = { promise, fetchImpl };
  recentFetches.set(url, entry);
  if (recentFetches.size > 32)
    recentFetches.delete(recentFetches.keys().next().value);
  const remove = () => {
    if (recentFetches.get(url) === entry) recentFetches.delete(url);
  };
  promise.then(() => setTimeout(remove, 60000).unref(), remove);
  return promise;
}
async function persistSourceDocument(rest, source, url, body, metadata) {
  const contentHash = hash(body);
  const query = `source_documents?select=id&source=eq.${enc(source)}&content_hash=eq.${enc(contentHash)}&limit=1`;
  const existing = await rest("research", query);
  if (existing?.[0]?.id) return existing[0].id;
  try {
    const created = await rest("research", "source_documents", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        source,
        source_url: url,
        content_hash: contentHash,
        mime_type: "text/html",
        byte_size: Buffer.byteLength(body),
        metadata,
      }),
    });
    if (!created?.[0]?.id)
      throw new Error("Directory source insert returned no ID");
    return created[0].id;
  } catch (error) {
    if (!/23505|409|duplicate key/iu.test(error.message)) throw error;
    const raced = await rest("research", query);
    if (!raced?.[0]?.id) throw error;
    return raced[0].id;
  }
}

const agencyEvidenceInflight = new Map();
const agencyEvidenceCooldown = new Map();
const AGENCY_SOURCE = "ad_radar_agency_website";
const AGENCY_PROFILE_PATH =
  /(?:team|staff|agents?|people|our[-_/ ]?team|profile|directory)/iu;
const MAX_AGENCY_PROFILE_PAGES = 12;

function sourceMeta(doc) {
  return doc && doc.metadata && typeof doc.metadata === "object"
    ? doc.metadata
    : {};
}
function documentMatchesAgency(doc, agency) {
  const meta = sourceMeta(doc);
  return (
    s(meta.agency_id || meta.agencyId) === agency.id ||
    (s(meta.entity_kind || meta.entityKind).toLowerCase() === "agency" &&
      s(meta.entity_id || meta.entityId) === agency.id) ||
    (s(meta.subject_kind || meta.subjectKind).toLowerCase() === "agency" &&
      s(meta.subject_id || meta.subjectId) === agency.id)
  );
}
function uniqueDocuments(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const id =
      s(row && row.id) ||
      s(row && row.source_url) + ":" + s(row && row.fetched_at);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
async function tryReadDocuments(rest, path) {
  const rows = await rest("research", path);
  if (!Array.isArray(rows)) {
    const error = new Error("Invalid source document response");
    error.retryable = true;
    throw error;
  }
  return rows;
}
async function readEntityEvidence(rest, item) {
  const paths = [
    "source_documents?select=id,source,source_url,metadata,fetched_at&metadata->>entity_kind=eq." +
      enc(item.kind) +
      "&metadata->>entity_id=eq." +
      enc(item.id) +
      "&order=fetched_at.desc&limit=50",
    "source_documents?select=id,source,source_url,metadata,fetched_at&metadata->>subject_kind=eq." +
      enc(item.kind) +
      "&metadata->>subject_id=eq." +
      enc(item.id) +
      "&order=fetched_at.desc&limit=50",
  ];
  if (item.kind === "agent")
    paths.push(
      "source_documents?select=id,source,source_url,metadata,fetched_at&metadata->>agent_id=eq." +
        enc(item.id) +
        "&order=fetched_at.desc&limit=100",
    );
  if (item.kind === "agent" && item.agencyId)
    paths.push(
      "source_documents?select=id,source,source_url,metadata,fetched_at&metadata->>agency_id=eq." +
        enc(item.agencyId) +
        "&order=fetched_at.desc&limit=100",
    );
  return uniqueDocuments(
    (
      await Promise.all(paths.map((path) => tryReadDocuments(rest, path)))
    ).flat(),
  );
}
async function readAgencyEvidence(rest, agency, websiteUrl = null) {
  if (!agency || !agency.id) return [];
  const agencySources =
    "source=in.(agency_website,subject_website,ad_radar_agency_website)";
  const rows = await Promise.all([
    tryReadDocuments(
      rest,
      "source_documents?select=id,source,source_url,metadata,fetched_at&" +
        agencySources +
        "&metadata->>agency_id=eq." +
        enc(agency.id) +
        "&order=fetched_at.desc&limit=100",
    ),
    tryReadDocuments(
      rest,
      "source_documents?select=id,source,source_url,metadata,fetched_at&" +
        agencySources +
        "&metadata->>entity_kind=eq.agency&metadata->>entity_id=eq." +
        enc(agency.id) +
        "&order=fetched_at.desc&limit=100",
    ),
    tryReadDocuments(
      rest,
      "source_documents?select=id,source,source_url,metadata,fetched_at&" +
        agencySources +
        "&metadata->>subject_kind=eq.agency&metadata->>subject_id=eq." +
        enc(agency.id) +
        "&order=fetched_at.desc&limit=100",
    ),
    tryReadDocuments(
      rest,
      "source_documents?select=id,source,source_url,metadata,fetched_at&source=eq.ad_radar_directory_website&metadata->>agency_id=eq." +
        enc(agency.id) +
        "&order=fetched_at.desc&limit=50",
    ),
  ]);
  const docs = uniqueDocuments(rows.flat()).filter((doc) =>
    documentMatchesAgency(doc, agency),
  );
  const wanted = s(websiteUrl);
  return wanted
    ? docs.filter((doc) => {
        const meta = sourceMeta(doc);
        // Legacy rows may omit source_url; an explicit agency-owned Facebook
        // link remains reusable, but never turns an unowned footer into proof.
        return (
          s(doc.source_url) === wanted ||
          s(meta.website_url) === wanted ||
          (!s(doc.source_url) &&
            Array.isArray(meta.official_facebook_links) &&
            meta.official_facebook_links.length > 0)
        );
      })
    : docs;
}
function websiteLinksFromBody(baseUrl, body) {
  const base = new URL(baseUrl),
    links = [],
    attr = /(?:href|content)\s*=\s*["']([^"']+)["']/giu;
  for (const match of s(body).matchAll(attr)) {
    try {
      const url = new URL(match[1], base);
      if (
        url.protocol === "https:" &&
        url.hostname === base.hostname &&
        url.pathname !== base.pathname
      )
        links.push(url.toString());
    } catch {
      /* malformed links are not crawl candidates */
    }
  }
  // Some Next.js agency sites keep team routes in escaped route JSON rather
  // than rendered anchors. Read only URL/slug fields on the same origin.
  for (const match of s(body).matchAll(
    /"(?:url|slug)"\s*:\s*"((?:\\.|[^"\\])*)"/giu,
  )) {
    try {
      const route = match[1].replace(/\\\//gu, "/").replace(/\\"/gu, '"');
      // Only route-shaped JSON values are crawl candidates. Human labels such
      // as "Team Members - Agency" must not become guessed URLs.
      if (!/^\//u.test(route) && !/^https:\/\//iu.test(route)) continue;
      const url = new URL(route, base);
      if (
        url.protocol === "https:" &&
        url.hostname === base.hostname &&
        url.pathname !== base.pathname
      )
        links.push(url.toString());
    } catch {
      /* malformed route JSON is not a crawl candidate */
    }
  }
  return [...new Set(links)];
}
function profileLinksFromBody(baseUrl, body) {
  return websiteLinksFromBody(baseUrl, body).filter((url) =>
    AGENCY_PROFILE_PATH.test(new URL(url).pathname),
  );
}
function textFromProfileMarkers(body) {
  return [
    ...s(body).matchAll(/<(?:h1|title)\b[^>]*>([\s\S]*?)<\/(?:h1|title)>/giu),
  ]
    .map((match) =>
      match[1]
        .replace(/<[^>]+>/gu, " ")
        .replace(/\s+/gu, " ")
        .trim(),
    )
    .filter(Boolean);
}
function facebookLinkKey(value) {
  const reference = facebookPageReference(value);
  if (!reference.url) return null;
  try {
    const url = new URL(reference.url);
    return (url.hostname + url.pathname).replace(/\/+$/u, "").toLowerCase();
  } catch {
    return null;
  }
}
function namedProfileEvidence(baseUrl, body, excludedFacebookLinks = []) {
  const names = textFromProfileMarkers(body);
  const stripped = s(body).replace(
    /<(?:header|footer|nav)\b[^>]*>[\s\S]*?<\/(?:header|footer|nav)>/giu,
    " ",
  );
  const excluded = new Set(
    (Array.isArray(excludedFacebookLinks) ? excludedFacebookLinks : [])
      .map(facebookLinkKey)
      .filter(Boolean),
  );
  const links = [
    ...new Set(
      extractFacebookLinksFromHtml(baseUrl, stripped).map((link) => link.url),
    ),
  ].filter((url) => !excluded.has(facebookLinkKey(url)));
  return { profileNames: names, namedLinks: links.length === 1 ? links : [] };
}
function agencySharedFacebookLinks(agency, docs, existingPages = []) {
  if (!agency?.id) return [];
  const counts = new Map(),
    shared = new Map();
  for (const row of Array.isArray(existingPages) ? existingPages : []) {
    const link = existingPageLink({ kind: "agency", id: agency.id }, row);
    if (link?.url && link?.pageId) {
      shared.set(facebookLinkKey(link.url), link.url);
      const numeric = facebookPageReference(link.pageId).url;
      if (numeric) shared.set(facebookLinkKey(numeric), numeric);
    }
  }
  for (const doc of Array.isArray(docs) ? docs : []) {
    const meta = sourceMeta(doc);
    if (s(meta.agency_id || meta.agencyId) !== s(agency.id)) continue;
    const role = s(meta.crawl_role).toLowerCase();
    if (!["agency_homepage", "agency_profile"].includes(role)) continue;
    const links = new Map();
    for (const link of [
      ...(Array.isArray(meta.agency_homepage_facebook_links)
        ? meta.agency_homepage_facebook_links
        : []),
      ...(Array.isArray(meta.official_facebook_links)
        ? meta.official_facebook_links
        : []),
      ...(Array.isArray(meta.named_profile_facebook_links)
        ? meta.named_profile_facebook_links
        : []),
    ]) {
      const linkKey = facebookLinkKey(link);
      if (linkKey) links.set(linkKey, link);
    }
    for (const [linkKey, link] of links) {
      const row = counts.get(linkKey) || { documents: new Set(), value: link };
      row.documents.add(s(doc.id) || hash(s(doc.source_url) + stable(meta)));
      counts.set(linkKey, row);
    }
  }
  for (const [linkKey, row] of counts)
    if (row.documents.size >= 2) shared.set(linkKey, row.value);
  return [...shared.values()];
}
function linksFromAgencyDocuments(
  item,
  docs,
  additionalSharedAgencyLinks = [],
) {
  const sharedAgencyLinks = new Set([
    ...(Array.isArray(additionalSharedAgencyLinks)
      ? additionalSharedAgencyLinks
      : []),
    ...docs
      .flatMap((doc) => {
        const meta = sourceMeta(doc);
        return [
          ...(Array.isArray(meta.agency_homepage_facebook_links)
            ? meta.agency_homepage_facebook_links
            : []),
          ...(meta.crawl_role === "agency_homepage" &&
          Array.isArray(meta.official_facebook_links)
            ? meta.official_facebook_links
            : []),
        ];
      })
      .map(facebookLinkKey)
      .filter(Boolean),
  ]);
  const owned = (link) =>
    item.kind !== "agent" || !sharedAgencyLinks.has(facebookLinkKey(link.url));
  return docs.flatMap((doc) => {
    if (
      ["facebook_discovery_google_search", "facebook_page_identity"].includes(
        s(doc.source).toLowerCase(),
      )
    )
      return [];
    const url = s((doc && doc.source_url) || sourceMeta(doc).website_url);
    if (!url) return [];
    const meta = sourceMeta(doc);
    const explicitNamed =
      item.kind === "agent" &&
      Array.isArray(meta.profile_names) &&
      meta.profile_names.some(
        (name) => identityName(name) === identityName(item.name),
      )
        ? (meta.named_profile_facebook_links || []).map((facebookUrl) => ({
            url: facebookUrl,
            entityKind: item.kind,
            entityId: item.id,
            ownerKind: "agent",
            isOfficial: true,
            explicitAssignment: true,
            sourceType: "named_agent_profile",
            sourceDocumentId: doc.id,
          }))
        : [];
    const official =
      item.kind === "agency" && meta.crawl_role === "agency_profile"
        ? []
        : meta.official_facebook_links || [];
    return [
      ...linksForWebsiteEvidence(item, url, {
        ...doc,
        metadata: {
          ...meta,
          official_facebook_links: official,
          facebook_owners: meta.facebook_owners || [],
        },
      }),
      ...explicitNamed,
    ].filter(owned);
  });
}
function linksFromEntityDocuments(item, docs) {
  return docs.flatMap((doc) => {
    const meta = sourceMeta(doc);
    if (
      ["facebook_discovery_google_search", "facebook_page_identity"].includes(
        s(doc.source).toLowerCase(),
      )
    )
      return [];
    const url = s((doc && doc.source_url) || meta.website_url);
    if (
      !url ||
      (item.kind === "agent" &&
        !documentMatchesAgency(doc, { id: item.agencyId || "__none" }) &&
        !(s(meta.agent_id || meta.agentId) === item.id))
    )
      return [];
    return linksForWebsiteEvidence(item, url, {
      ...doc,
      metadata: {
        ...meta,
        official_facebook_links: meta.official_facebook_links || [],
        facebook_owners: meta.facebook_owners || [],
      },
    });
  });
}
function indexedProfileForAgent(item, docs) {
  const tokens = identityName(item.name)
    .split(" ")
    .filter((token) => token.length > 2);
  if (!tokens.length) return null;
  const urls = docs.flatMap((doc) =>
    Array.isArray(sourceMeta(doc).profile_url_index)
      ? sourceMeta(doc).profile_url_index
      : [],
  );
  return (
    [...new Set(urls)].find((url) => {
      const safe = safePublicHttpsUrl(url);
      if (!safe) return false;
      let path;
      try {
        path = decodeURIComponent(new URL(safe).pathname);
      } catch {
        return false;
      }
      // Old cache indexes included display labels treated as relative URLs.
      // Never prefer those over an explicit hyphenated profile route.
      if (/\s/u.test(path)) return false;
      const normalized = identityName(path);
      return tokens.every((token) => normalized.includes(token));
    }) || null
  );
}
async function fetchAgencyWebsiteEvidence({
  rest,
  fetchImpl,
  agency,
  websiteUrl,
  now,
  rawEvidenceDir,
}) {
  const requested = safePublicHttpsUrl(websiteUrl);
  const allSaved = await readAgencyEvidence(rest, agency);
  const seedSources = new Set(["agency_website", "subject_website"]);
  const seedDocs = allSaved.filter((doc) => {
    const meta = sourceMeta(doc),
      source = s(doc.source).toLowerCase();
    if (source === AGENCY_SOURCE)
      return (
        meta.crawl_role === "agency_homepage" &&
        !isBlockedAgencyWebsiteUrl(doc.source_url || meta.website_url)
      );
    if (!seedSources.has(source)) return false;
    // Legacy source names are useful seeds only when they explicitly
    // describe the agency. An agent-owned website/profile must never become
    // the agency homepage merely because it carries the agency_id.
    if (s(meta.agent_id || meta.agentId)) return false;
    if (s(meta.subject_kind || meta.subjectKind).toLowerCase() === "agent")
      return false;
    if (s(meta.entity_kind || meta.entityKind).toLowerCase() === "agent")
      return false;
    return true;
  });
  const savedUrls = [
    ...new Set(
      seedDocs
        .map((doc) =>
          safePublicHttpsUrl(doc.source_url || sourceMeta(doc).website_url),
        )
        .filter((url) => !isBlockedAgencyWebsiteUrl(url)),
    ),
  ];
  // A directory/social/app-store URL must never become an agency homepage.
  // A directory URL on the current roster row must not hide a saved
  // agency-owned external site from the free first pass.
  const website =
    savedUrls.find((url) => !isBlockedAgencyWebsiteUrl(url)) ||
    (requested && !isBlockedAgencyWebsiteUrl(requested) ? requested : null);
  if (!website)
    return {
      docs: allSaved.filter((doc) => {
        const url = safePublicHttpsUrl(
          doc.source_url || sourceMeta(doc).website_url,
        );
        return !url || !isBlockedAgencyWebsiteUrl(url);
      }),
      errors: [],
      fetched: false,
      cached: false,
      rejected_unusable_source: true,
    };
  const saved = allSaved.filter((doc) => {
    const meta = sourceMeta(doc);
    const url = safePublicHttpsUrl(doc.source_url || meta.website_url);
    return (
      url === website ||
      (s(doc.source).toLowerCase() === AGENCY_SOURCE &&
        meta.crawl_role === "agency_profile" &&
        safePublicHttpsUrl(meta.crawl_parent_url) === website) ||
      (!url &&
        Array.isArray(meta.official_facebook_links) &&
        meta.official_facebook_links.length > 0)
    );
  });
  const fresh = saved.filter((doc) => {
    const meta = sourceMeta(doc);
    const at = Date.parse(doc.fetched_at || meta.fetched_at || "");
    return (
      s(doc.source).toLowerCase() === AGENCY_SOURCE &&
      !meta.error &&
      ((Number.isFinite(at) && at >= Date.parse(now()) - 7 * 86400000) ||
        (!Number.isFinite(at) &&
          Array.isArray(meta.official_facebook_links) &&
          meta.official_facebook_links.length > 0))
    );
  });
  if (fresh.length)
    return { docs: fresh, errors: [], fetched: false, cached: true };
  if (isBlockedAgencyWebsiteUrl(website))
    return {
      docs: saved,
      errors: [],
      fetched: false,
      cached: saved.length > 0,
      directory: true,
    };
  const cooldown = agencyEvidenceCooldown.get(website);
  if (cooldown && cooldown.until > Date.now())
    return {
      docs: saved,
      errors: [cooldown.error],
      fetched: false,
      cooldown: true,
    };
  const prior = agencyEvidenceInflight.get(website);
  if (prior) return prior;
  const run = (async () => {
    const docs = [],
      errors = [];
    try {
      const body = await boundedFetch(fetchImpl, website);
      const profileUrls = profileLinksFromBody(website, body);
      const metadata = {
        coverage_version: DIRECTORY_COVERAGE_VERSION,
        agency_identity_confirmed: coherentAgencyIdentity(agency.name, body),
        agency_identity_name: identityName(agency.name),
        agency_id: agency.id,
        agency_name: agency.name,
        entity_kind: "agency",
        entity_id: agency.id,
        subject_kind: "agency",
        subject_id: agency.id,
        website_url: website,
        official_facebook_links: extractFacebookLinksFromHtml(
          website,
          body,
        ).map((link) => link.url),
        agency_homepage_facebook_links: extractFacebookLinksFromHtml(
          website,
          body,
        ).map((link) => link.url),
        facebook_owners: facebookOwnersFromHtml(body),
        fetched_at: checkedAt(now),
        crawl_role: "agency_homepage",
        crawl_limit: MAX_AGENCY_PROFILE_PAGES,
        crawl_incomplete: profileUrls.length > MAX_AGENCY_PROFILE_PAGES,
      };
      const id = await persistSourceDocument(
        rest,
        AGENCY_SOURCE,
        website,
        body,
        metadata,
      );
      docs.push({
        id,
        source: AGENCY_SOURCE,
        source_url: website,
        metadata,
        fetched_at: metadata.fetched_at,
      });
      if (s(rawEvidenceDir))
        await writeAtomicJson(
          join(rawEvidenceDir, "directory-sources", hash(website) + ".json"),
          {
            url: website,
            body,
            source_document_id: id,
            fetched_at: metadata.fetched_at,
          },
        );
      const sitemapUrls = websiteLinksFromBody(website, body)
        .filter((url) => /sitemap(?:\.xml)?$/iu.test(new URL(url).pathname))
        .slice(0, 1);
      for (const sitemapUrl of sitemapUrls) {
        try {
          const sitemap = await boundedFetch(fetchImpl, sitemapUrl, {
            retries: 0,
          });
          const sitemapLinks = [
            ...sitemap.matchAll(/<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/giu),
          ]
            .map((m) => m[1])
            .filter((url) => {
              try {
                return (
                  new URL(url).hostname === new URL(website).hostname &&
                  AGENCY_PROFILE_PATH.test(new URL(url).pathname)
                );
              } catch {
                return false;
              }
            });
          profileUrls.push(
            ...sitemapLinks.slice(
              0,
              Math.max(0, MAX_AGENCY_PROFILE_PAGES - profileUrls.length),
            ),
          );
        } catch (error) {
          errors.push({
            url: sitemapUrl,
            reason: "agency_sitemap_fetch_failed",
            error: error.message || String(error),
          });
        }
      }
      for (
        let profileIndex = 0;
        profileIndex < profileUrls.length &&
        profileIndex < MAX_AGENCY_PROFILE_PAGES;
        profileIndex += 1
      ) {
        const profileUrl = profileUrls[profileIndex];
        if (profileUrls.indexOf(profileUrl) !== profileIndex) continue;
        try {
          const profileBody = await boundedFetch(fetchImpl, profileUrl, {
            retries: 0,
          });
          profileUrls.push(...profileLinksFromBody(profileUrl, profileBody));
          const named = namedProfileEvidence(
            profileUrl,
            profileBody,
            metadata.agency_homepage_facebook_links,
          );
          const nestedProfileUrls = profileLinksFromBody(
            profileUrl,
            profileBody,
          );
          const profileMetadata = {
            ...metadata,
            website_url: profileUrl,
            official_facebook_links: extractFacebookLinksFromHtml(
              profileUrl,
              profileBody,
            ).map((link) => link.url),
            facebook_owners: facebookOwnersFromHtml(profileBody),
            profile_names: named.profileNames,
            named_profile_facebook_links: named.namedLinks,
            profile_url_index: nestedProfileUrls,
            fetched_at: checkedAt(now),
            crawl_role: "agency_profile",
            crawl_parent_url: website,
          };
          const profileId = await persistSourceDocument(
            rest,
            AGENCY_SOURCE,
            profileUrl,
            profileBody,
            profileMetadata,
          );
          docs.push({
            id: profileId,
            source: AGENCY_SOURCE,
            source_url: profileUrl,
            metadata: profileMetadata,
            fetched_at: profileMetadata.fetched_at,
          });
        } catch (error) {
          errors.push({
            url: profileUrl,
            reason: "agency_profile_fetch_failed",
            error: error.message || String(error),
          });
        }
      }
      if (profileUrls.length > MAX_AGENCY_PROFILE_PAGES) {
        errors.push({
          url: website,
          reason: "agency_crawl_incomplete",
          crawl_limit: MAX_AGENCY_PROFILE_PAGES,
          discovered_profiles: [...new Set(profileUrls)].length,
        });
      }
    } catch (error) {
      const failure = {
        reason: "agency_website_fetch_failed",
        error: error.message || String(error),
        url: website,
        at: checkedAt(now),
      };
      errors.push(failure);
      agencyEvidenceCooldown.set(website, {
        until: Date.now() + 60 * 60 * 1000,
        error: failure,
      });
      // Keep the negative receipt durable so another agent job does not
      // immediately retry the same blocked URL or mistake it for no page.
      try {
        await persistSourceDocument(
          rest,
          AGENCY_SOURCE,
          website,
          "__agency_fetch_error__:" + website + ":" + failure.error,
          {
            coverage_version: DIRECTORY_COVERAGE_VERSION,
            agency_id: agency.id,
            entity_kind: "agency",
            entity_id: agency.id,
            subject_kind: "agency",
            subject_id: agency.id,
            website_url: website,
            crawl_role: "agency_homepage",
            error: failure.error,
            error_reason: failure.reason,
            cooldown_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            fetched_at: failure.at,
          },
        );
      } catch {
        /* Preserve the fetch failure when receipt persistence is unavailable. */
      }
    }
    return { docs, errors, fetched: true, cached: false };
  })();
  agencyEvidenceInflight.set(website, run);
  try {
    return await run;
  } finally {
    if (agencyEvidenceInflight.get(website) === run)
      agencyEvidenceInflight.delete(website);
  }
}

function isAutomaticSlugPause(row) {
  const metadata = sourceMeta(row);
  return (
    s(row?.status).toLowerCase() === "verified_real_estate_unresolved" &&
    row?.scan_enabled === false &&
    s(row?.scan_state).toLowerCase() === "paused" &&
    s(metadata.scan_disabled_reason) === "unresolved_slug_page_id"
  );
}
function existingPageIsRejected(row) {
  const status = s(row?.status).toLowerCase();
  return ["rejected", "rejected_non_real_estate"].includes(status);
}
function existingPageLink(item, row) {
  if (existingPageIsRejected(row)) return null;
  const ownerType = s(row?.owner_type || row?.ownerType).toLowerCase();
  if (ownerType && ownerType !== item.kind) return null;
  const original = normalizedPageUrl(row?.page_url);
  if (!original) return null;
  const parsed = facebookPageReference(original);
  const pageId = s(row?.page_id);
  // A numeric column alone is not identity evidence. Reuse it only when the
  // saved original URL is itself a Facebook page reference.
  return {
    url: original,
    pageId: FB_ID.test(pageId) ? pageId : parsed.pageId,
    vanity: parsed.vanity,
    entityKind: item.kind,
    entityId: item.id,
    ownerKind: item.kind,
    isOfficial: true,
    explicitAssignment: true,
    sourceType: "existing_advertiser_page",
    sourceDocumentId: s(row?.source_document_id) || null,
    existingAdvertiserPageId: s(row?.id) || null,
    existingDisabled:
      row?.scan_enabled === false ||
      ["disabled", "inactive"].includes(s(row?.status).toLowerCase()),
  };
}
async function readExistingOwnedPages(rest, item) {
  const column = item.kind === "agent" ? "agent_id" : "agency_id";
  const path = `advertiser_pages?select=id,page_id,page_url,page_vanity,status,scan_enabled,agent_id,agency_id,owner_type,resolution_decision_id,scan_state,metadata&platform=eq.facebook&${column}=eq.${enc(item.id)}&limit=100`;
  const rows = await rest("research", path);
  if (!Array.isArray(rows))
    throw new Error("Invalid saved advertiser page evidence");
  return rows;
}
async function enrichEntityContext(rest, item) {
  const agencyId = item.kind === "agency" ? item.id : item.agencyId;
  if (!agencyId) return item;
  const needsAgencyContext =
    item.kind === "agency"
      ? !item.primarySuburb
      : !item.agencyName || !item.agencyPrimarySuburb;
  if (!needsAgencyContext) return item;
  try {
    const rows = await rest(
      "research",
      "agencies?select=id,name,primary_suburb,primary_postcode&id=eq." +
        enc(agencyId) +
        "&limit=1",
    );
    const agency = Array.isArray(rows) ? rows[0] : null;
    if (!agency) return item;
    if (item.kind === "agency") {
      item.primarySuburb ||= s(agency.primary_suburb) || null;
      item.postcode ||= s(agency.primary_postcode) || null;
    } else {
      item.agencyName ||= s(agency.name) || null;
      item.agencyPrimarySuburb ||= s(agency.primary_suburb) || null;
    }
  } catch {
    /* Missing agency context is not public ownership proof. */
  }
  return item;
}
function searchQueryFor(item, variant = 0) {
  const context = s(
    item.agencyName || item.agency_name || item.agency || item.name,
  );
  const identity =
    context && identityName(context) !== identityName(item.name)
      ? `${item.name} ${context}`
      : item.name;
  const base = `${identity} WA real estate Facebook`;
  return variant === 0
    ? base
    : `${identity} Western Australia property Facebook page`;
}
function resultText(result) {
  return `${s(result?.title)} ${s(result?.description)}`.toLowerCase();
}
function plausibleSearchResult(item, result) {
  const url = s(result?.url);
  if (!url) return false;
  const reference = facebookPageReference(url);
  if (
    !reference.url ||
    [
      "not_facebook",
      "invalid_url",
      "empty_url",
      "non_page_facebook_path",
    ].includes(reference.reason)
  )
    return false;
  const haystack = resultText(result);
  const tokens = identityName(item.name)
    .split(" ")
    .filter((token) => token.length > 2);
  return (
    tokens.length > 0 &&
    tokens.some(
      (token) =>
        haystack.includes(token) ||
        identityName(reference.vanity).includes(token),
    )
  );
}
function plausibleOfficialSiteResult(item, result) {
  const url = s(result?.url);
  if (!url || /^https?:\/\/(?:www\.)?(?:facebook|fb)\.com\//iu.test(url))
    return false;
  const haystack = resultText(result);
  const tokens = identityName(item.name)
    .split(" ")
    .filter((token) => token.length > 2);
  return tokens.length > 0 && tokens.some((token) => haystack.includes(token));
}
function normalizeSearchResponse(response, query, checkedAtValue) {
  if (!response || typeof response !== "object")
    return {
      valid: false,
      complete: false,
      query,
      sourceDocumentId: null,
      sourceUrl: null,
      checkedAt: checkedAtValue,
      results: [],
      reason: "search_malformed_response",
    };
  const complete = response.complete === true;
  const sourceUrl =
    typeof response.sourceUrl === "string" ? response.sourceUrl : null;
  const sourceDocumentId =
    response.sourceDocumentId == null
      ? null
      : s(response.sourceDocumentId) || null;
  const validResults =
    Array.isArray(response.results) &&
    response.results.every(
      (row) => row && typeof row === "object" && typeof row.url === "string",
    );
  if (!sourceUrl || !validResults || (complete && !sourceDocumentId))
    return {
      valid: false,
      complete: false,
      query,
      sourceDocumentId,
      sourceUrl,
      checkedAt: checkedAtValue,
      results: [],
      reason: "search_malformed_response",
      error: s(response.error) || null,
      actualAttempted:
        response.actualAttempted === true || response.actual_attempted === true,
    };
  return {
    valid: true,
    complete,
    query,
    sourceDocumentId,
    sourceUrl,
    checkedAt: checkedAtValue,
    results: response.results.map((row) => ({
      url: s(row.url),
      title: s(row.title),
      description: s(row.description),
    })),
    reason: complete
      ? response.results.length
        ? "search_completed"
        : "search_completed_no_results"
      : s(response.error) || "search_incomplete",
    error: s(response.error) || null,
    actualAttempted:
      response.actualAttempted !== false && response.actual_attempted !== false,
  };
}
function searchDocumentMatchesItem(item, doc) {
  const meta = sourceMeta(doc);
  const kind = s(
    meta.entity_kind ||
      meta.entityKind ||
      meta.subject_kind ||
      meta.subjectKind,
  ).toLowerCase();
  const id = s(
    meta.entity_id || meta.entityId || meta.subject_id || meta.subjectId,
  );
  if (kind === item.kind && id === item.id) return true;
  return item.kind === "agent" && s(meta.agent_id || meta.agentId) === item.id;
}

function metadataFacebookLinks(meta) {
  return [
    ...(Array.isArray(meta.official_facebook_links)
      ? meta.official_facebook_links
      : []),
    ...(Array.isArray(meta.named_profile_facebook_links)
      ? meta.named_profile_facebook_links
      : []),
    ...(Array.isArray(meta.agency_homepage_facebook_links)
      ? meta.agency_homepage_facebook_links
      : []),
  ].map((value) =>
    value && typeof value === "object" ? value.url || value.href : value,
  );
}
function independentSearchOwnerProof(item, candidate, docs) {
  const reference = facebookPageReference(candidate.url);
  const candidateId = s(candidate.pageId || reference.pageId);
  if (!reference.url || !FB_ID.test(candidateId)) return null;
  const candidateKeys = new Set(
    [reference.url, facebookPageReference(candidateId).url]
      .map(facebookLinkKey)
      .filter(Boolean),
  );
  for (const doc of Array.isArray(docs) ? docs : []) {
    if (s(doc.source).toLowerCase() === "facebook_discovery_google_search")
      continue;
    if (!searchDocumentMatchesItem(item, doc)) continue;
    const meta = sourceMeta(doc);
    const links = metadataFacebookLinks(meta);
    const backlink = links.some((url) =>
      candidateKeys.has(facebookLinkKey(url)),
    );
    const owners = Array.isArray(meta.facebook_owners)
      ? meta.facebook_owners
      : [];
    const owner = owners.find(
      (row) =>
        row &&
        ((item.kind === "agent" && row.kind === "agent") ||
          (item.kind === "agency" && row.kind === "agency")) &&
        identityName(row.name) === identityName(item.name) &&
        (Array.isArray(row.urls) ? row.urls : []).some((url) =>
          candidateKeys.has(facebookLinkKey(url)),
        ),
    );
    const publicName = identityName(
      meta.facebook_page_name || meta.facebookPageName || meta.page_name || "",
    );
    const context = identityName(
      meta.agency_name || meta.agencyName || meta.location || meta.state || "",
    );
    const contextOk =
      context.includes("western australia") ||
      context === "wa" ||
      (item.agencyName && context.includes(identityName(item.agencyName)));
    const publicMatch =
      s(meta.page_id || meta.pageId || meta.facebook_page_id) === candidateId &&
      publicName === identityName(item.name) &&
      contextOk;
    if (!backlink && !owner && !publicMatch) continue;
    if (item.kind === "agent") {
      const assignedAgent = s(meta.agent_id || meta.agentId);
      if (assignedAgent !== item.id && !owner) continue;
      if (!owner && !assignedAgent) continue;
    } else if (
      s(meta.agency_id || meta.agencyId) !== item.id &&
      !owner &&
      meta.agency_identity_confirmed !== true
    )
      continue;
    return { doc, pageId: candidateId };
  }
  return null;
}
function publicFacebookMarkers(body) {
  const values = [
    ...textFromProfileMarkers(body),
    ...[
      ...s(body).matchAll(
        /<meta\b[^>]*(?:property|name)\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/giu,
      ),
      ...s(body).matchAll(
        /<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*(?:property|name)\s*=\s*["']og:title["'][^>]*>/giu,
      ),
    ].map((match) => match[1]),
  ]
    .map(identityName)
    .filter(Boolean);
  return [...new Set(values)];
}
function publicFacebookCandidateProof(item, body) {
  const expected = identityName(item.name);
  if (!expected) return false;
  const markers = publicFacebookMarkers(body);
  const titleMatch = markers.some(
    (name) => name === expected || name.startsWith(expected + " "),
  );
  if (!titleMatch) return false;
  const knownHosts = [item.websiteUrl, item.agencyWebsiteUrl]
    .map(safePublicHttpsUrl)
    .filter(Boolean)
    .map((url) => new URL(url).hostname.replace(/^www\./u, "").toLowerCase())
    .filter(
      (host) =>
        ![...directoryHosts].some(
          (domain) => host === domain || host.endsWith("." + domain),
        ),
    );
  const officialDomain = [...s(body).matchAll(/https?:\/\/[^\s"'<>]+/giu)].some(
    (match) => {
      try {
        const hostname = new URL(match[0]).hostname
          .toLowerCase()
          .replace(/^www\./u, "");
        return knownHosts.includes(hostname);
      } catch {
        return false;
      }
    },
  );
  if (officialDomain) return true;
  const suburb = identityName(
    item.kind === "agency" ? item.primarySuburb : item.agencyPrimarySuburb,
  );
  if (!suburb) return false;
  const waMarkers = markers.filter((marker) => /\bwa\b/iu.test(marker));
  if (
    waMarkers.length !== 1 ||
    !(
      waMarkers[0] === expected ||
      waMarkers[0].startsWith(expected + " ")
    )
  )
    return false;
  if (
    !new RegExp("\\b" + suburb.replace(/ /gu, "\\s+") + "\\s+wa\\b", "iu").test(
      waMarkers[0],
    )
  )
    return false;
  if (item.kind === "agency") return true;
  const agency = identityName(item.agencyName);
  return agency.length >= 5 && waMarkers[0].includes(agency);
}
async function verifySearchFacebookCandidates(
  item,
  candidates,
  docs,
  fetchImpl,
  rest,
  rawEvidenceDir,
  now,
) {
  const links = [],
    rejected = [];
  for (const candidate of (Array.isArray(candidates) ? candidates : []).slice(
    0,
    3,
  )) {
    const reference = facebookPageReference(candidate.url);
    if (!reference.url) continue;
    try {
      const body = await boundedFetch(fetchImpl, reference.url, { retries: 0 });
      const identity = parseFacebookPageIdentity(body, reference.url);
      if (!identity?.pageId || identity.permalinkMatch !== true) {
        rejected.push({
          url: candidate.url,
          reason: "search_candidate_identity_unproven",
        });
        continue;
      }
      const proof = independentSearchOwnerProof(
        item,
        { url: reference.url, pageId: identity.pageId },
        docs,
      );
      const publicProof = publicFacebookCandidateProof(item, body);
      if (!proof && !publicProof) {
        rejected.push({
          url: candidate.url,
          reason: "search_candidate_ownership_unproven",
        });
        continue;
      }
      const resolvedUrl = facebookPageReference(identity.pageId).url;
      const metadata = {
        coverage_version: DIRECTORY_COVERAGE_VERSION,
        entity_kind: item.kind,
        entity_id: item.id,
        subject_kind: item.kind,
        subject_id: item.id,
        agency_id: item.kind === "agency" ? item.id : item.agencyId || null,
        agent_id: item.kind === "agent" ? item.id : null,
        page_id: identity.pageId,
        page_url: reference.url,
        facebook_page_identity: identity.evidenceKind,
        owner_proof: proof
          ? "verified_official_backlink"
          : "public_local_or_domain",
        owner_proof_source_document_id: proof?.doc?.id || null,
        fetched_at: checkedAt(now),
      };
      const sourceId = await persistSourceDocument(
        rest,
        "facebook_page_identity",
        reference.url,
        body,
        metadata,
      );
      if (s(rawEvidenceDir))
        await writeAtomicJson(
          join(
            rawEvidenceDir,
            "directory-sources",
            hash(reference.url) + ".json",
          ),
          {
            url: reference.url,
            body,
            source_document_id: sourceId,
            fetched_at: metadata.fetched_at,
            owner_proof: metadata.owner_proof,
          },
        );
      links.push({
        url: resolvedUrl,
        pageId: identity.pageId,
        entityKind: item.kind,
        entityId: item.id,
        ownerKind: item.kind,
        isOfficial: true,
        explicitAssignment: true,
        sourceType: proof
          ? "verified_official_backlink"
          : "facebook_public_identity",
        sourceDocumentId: sourceId,
      });
    } catch (error) {
      rejected.push({
        url: candidate.url,
        reason: "search_candidate_facebook_fetch_failed",
        error: error?.message || String(error),
      });
    }
  }
  return { links: extractExactFacebookLinks(links), rejected };
}
async function runFacebookSearches(searchEvidence, item, job, now) {
  const receipts = [],
    searchCandidates = [],
    officialSiteCandidates = [];
  if (typeof searchEvidence !== "function")
    return {
      receipts,
      searchCandidates,
      officialSiteCandidates,
      actualAttempted: false,
      reason: "search_adapter_unavailable",
    };
  for (let variant = 0; variant < 2; variant += 1) {
    const query = searchQueryFor(item, variant);
    const checked = checkedAt(now);
    let response;
    try {
      response = await searchEvidence({ entity: item, query, job });
    } catch (error) {
      if (error?.retryable === true) throw error;
      receipts.push({
        query,
        sourceDocumentId: null,
        sourceUrl: null,
        checkedAt: checked,
        complete: false,
        evidence: [],
        reason: "search_failed",
        error: error?.message || String(error),
      });
      break;
    }
    const receipt = normalizeSearchResponse(response, query, checked);
    receipt.evidence = receipt.results;
    receipts.push(receipt);
    if (!receipt.valid || !receipt.complete) break;
    for (const result of receipt.results) {
      if (plausibleSearchResult(item, result))
        searchCandidates.push({
          ...result,
          candidateReason: "search_result_unverified",
        });
      else if (plausibleOfficialSiteResult(item, result))
        officialSiteCandidates.push({
          ...result,
          candidateReason: "possible_official_site",
        });
    }
    if (
      searchCandidates.length ||
      officialSiteCandidates.some((result) => {
        const url = safePublicHttpsUrl(result.url);
        if (!url) return false;
        const host = new URL(url).hostname.replace(/^www\./u, "").toLowerCase();
        return ![...directoryHosts].some(
          (domain) => host === domain || host.endsWith("." + domain),
        );
      })
    )
      break;
  }
  return {
    receipts,
    searchCandidates: searchCandidates.filter(
      (row, index, rows) => rows.findIndex((x) => x.url === row.url) === index,
    ),
    officialSiteCandidates: officialSiteCandidates.filter(
      (row, index, rows) => rows.findIndex((x) => x.url === row.url) === index,
    ),
    actualAttempted: receipts.some((row) => row.actualAttempted === true),
    reason: receipts.length ? receipts.at(-1).reason : "search_not_run",
  };
}
function exactNameMarker(item, body) {
  const expected = identityName(item.name);
  return (
    expected &&
    textFromProfileMarkers(body).some((name) => identityName(name) === expected)
  );
}
async function inspectOfficialSiteResults({
  rest,
  fetchImpl,
  item,
  results,
  now,
  rawEvidenceDir,
}) {
  const links = [],
    errors = [],
    inspected = new Set();
  const eligibleResults = (Array.isArray(results) ? results : []).filter(
    (result) => {
      const url = safePublicHttpsUrl(result?.url);
      if (!url) return false;
      const host = new URL(url).hostname.replace(/^www\./u, "").toLowerCase();
      return ![...directoryHosts].some(
        (domain) => host === domain || host.endsWith("." + domain),
      );
    },
  );
  for (const result of eligibleResults.slice(0, 2)) {
    const website = safePublicHttpsUrl(result?.url);
    if (!website || inspected.has(website)) continue;
    inspected.add(website);
    const host = new URL(website).hostname.replace(/^www\./u, "").toLowerCase();
    if (
      [...directoryHosts].some(
        (domain) => host === domain || host.endsWith("." + domain),
      )
    )
      continue;
    try {
      const body = await boundedFetch(fetchImpl, website, { retries: 0 });
      const owners = facebookOwnersFromHtml(body);
      const assigned = owners.filter(
        (owner) =>
          owner.kind === item.kind &&
          identityName(owner.name) === identityName(item.name),
      );
      const marker = exactNameMarker(item, body);
      const knownHosts = [item.websiteUrl, item.agencyWebsiteUrl]
        .map(safePublicHttpsUrl)
        .filter(Boolean)
        .map((url) =>
          new URL(url).hostname.replace(/^www\./u, "").toLowerCase(),
        )
        .filter(
          (name) =>
            ![...directoryHosts].some(
              (domain) => name === domain || name.endsWith("." + domain),
            ),
        );
      const visible = body
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
        .replace(/<[^>]+>/gu, " ");
      const localContext = /\bWA\s+6\d{3}\b|\bWestern\s+Australia\b/iu.test(
        visible,
      );
      const agencyContext =
        item.kind === "agency" ||
        (s(item.agencyName).length >= 5 &&
          identityName(visible).includes(identityName(item.agencyName)));
      // A Google result is a lead, not an official-domain assignment. Require
      // saved domain control or matching local agency context before ownership.
      if (
        !knownHosts.includes(host) &&
        !(marker && localContext && agencyContext)
      ) {
        errors.push({
          url: website,
          reason: "official_search_site_ownership_unproven",
        });
        continue;
      }
      const sameAs = assigned.flatMap((owner) => owner.urls || []);
      const metadata = {
        coverage_version: DIRECTORY_COVERAGE_VERSION,
        entity_kind: item.kind,
        entity_id: item.id,
        subject_kind: item.kind,
        subject_id: item.id,
        agency_id: item.kind === "agency" ? item.id : item.agencyId || null,
        agent_id: item.kind === "agent" ? item.id : null,
        website_url: website,
        agency_identity_confirmed:
          item.kind === "agency" && marker && localContext && agencyContext,
        agency_identity_name:
          item.kind === "agency" && marker && localContext && agencyContext
            ? identityName(item.name)
            : null,
        facebook_owners: owners,
        official_facebook_links:
          item.kind === "agency" && !sameAs.length && marker
            ? extractFacebookLinksFromHtml(website, body).map(
                (link) => link.url,
              )
            : sameAs,
        fetched_at: checkedAt(now),
        crawl_role: "official_search_result",
        search_result: {
          title: s(result?.title),
          description: s(result?.description),
        },
      };
      const sourceId = await persistSourceDocument(
        rest,
        "ad_radar_directory_website",
        website,
        body,
        metadata,
      );
      const evidence = {
        id: sourceId,
        metadata,
        source_url: website,
        fetched_at: metadata.fetched_at,
      };
      let found = linksForWebsiteEvidence(item, website, evidence);
      // An exact h1/title on a controlled official page plus one unique
      // non-navigation Facebook reference is explicit named ownership.
      if (marker && item.kind === "agent") {
        const named = namedProfileEvidence(website, body);
        if (named.namedLinks.length === 1) {
          found.push(
            ...extractExactFacebookLinks(
              named.namedLinks.map((url) => ({
                url,
                entityKind: item.kind,
                entityId: item.id,
                ownerKind: item.kind,
                isOfficial: true,
                explicitAssignment: true,
                sourceType: "named_agent_profile",
                sourceDocumentId: sourceId,
              })),
            ),
          );
        }
      }
      links.push(...found);
      if (s(rawEvidenceDir))
        await writeAtomicJson(
          join(rawEvidenceDir, "directory-sources", hash(website) + ".json"),
          {
            url: website,
            body,
            source_document_id: sourceId,
            fetched_at: metadata.fetched_at,
          },
        );
    } catch (error) {
      errors.push({
        url: website,
        reason: "official_search_site_fetch_failed",
        error: error?.message || String(error),
      });
    }
  }
  return { links: extractExactFacebookLinks(links), errors };
}

function discoveryOutcome({
  item,
  now,
  links,
  plan,
  registrations,
  search,
  errors,
}) {
  const autoReactivated = registrations.some(
    (row) => row.reason === "existing_exact_page_auto_reactivated",
  );
  const numericResolved =
    (!links.some((link) => link.existingDisabled) || autoReactivated) &&
    (plan.rows[0]?.status === "covered" ||
      registrations.some(
        (row) =>
          row.registered ||
          row.reason === "existing_exact_page" ||
          row.reason === "existing_exact_page_url_reconciled" ||
          row.reason === "existing_exact_page_auto_reactivated",
      ));
  const foundKnownLink = links.length > 0;
  let searchOutcome = "unresolved",
    reason = "no_verified_page_evidence";
  if (numericResolved) {
    searchOutcome = "resolved";
    reason = "verified_page_reference";
  } else if (foundKnownLink || search.searchCandidates.length) {
    searchOutcome = "page_found";
    reason = foundKnownLink
      ? "page_reference_found_identity_unresolved"
      : "search_candidate_found_identity_unverified";
  } else if (
    search.receipts.length >= 2 &&
    search.receipts.every((row) => row.valid && row.complete) &&
    search.actualAttempted &&
    search.officialSiteCandidates.length === 0
  ) {
    searchOutcome = "searched_not_found";
    reason = "search_completed_no_matching_page_found";
  } else if (errors.length || search.receipts.length)
    reason = search.reason || errors[0]?.reason || "search_incomplete";
  return {
    coverageVersion: DIRECTORY_COVERAGE_VERSION,
    entityKind: item.kind,
    entityId: item.id,
    checkedAt: checkedAt(now),
    searchOutcome,
    search_outcome: searchOutcome,
    reason,
    evidence: {
      links: links.map((link) => ({
        url: link.url,
        pageId: link.pageId || null,
        sourceType: link.sourceType || null,
        sourceDocumentId: link.sourceDocumentId || null,
      })),
      searchReceipts: search.receipts,
      searchCandidates: search.searchCandidates,
      officialSiteCandidates: search.officialSiteCandidates,
    },
    errors,
    actualAttempted: search.actualAttempted,
  };
}
export async function handleAdRadarEntityDiscovery(
  job,
  {
    rest,
    fetchImpl = globalThis.fetch,
    searchEvidence = null,
    resolvePageEvidence = null,
    now = () => new Date().toISOString(),
    rawEvidenceDir = process.env.RAW_EVIDENCE_DIR || "/tmp",
  } = {},
) {
  if (!job?.id || typeof rest !== "function" || typeof fetchImpl !== "function")
    throw new Error("job, rest and fetchImpl are required");
  const payload = job.payload || {};
  const kind = s(payload.entity_kind).toLowerCase();
  const item = entity(
    {
      id: payload.entity_id,
      name: payload.name,
      full_name: payload.name,
      state: payload.state,
      primary_postcode: payload.primary_postcode,
      primary_suburb: payload.primary_suburb,
      website_url: payload.website_url,
      agency_website_url: payload.agency_website_url,
      agency_id: payload.agency_id,
      agency_name: payload.agency_name,
      agency_primary_suburb: payload.agency_primary_suburb,
    },
    kind,
  );
  if (!["agent", "agency"].includes(kind) || !isEligibleWaEntity(item))
    return {
      status: "blocked",
      blocked_reason: "directory_entity_not_eligible_wa",
      result: {
        handler: "blockwise-ad-directory-discovery-entity",
        entity_kind: kind,
        entity_id: item.id,
      },
    };
  const savedDocs = await readEntityEvidence(rest, item);
  const existingPages = await readExistingOwnedPages(rest, item);
  await enrichEntityContext(rest, item);
  const errors = [];
  const agency =
    item.kind === "agency"
      ? {
          id: item.id,
          name: item.name,
          websiteUrl: item.websiteUrl,
          primarySuburb: item.primarySuburb,
        }
      : item.agencyId
        ? {
            id: item.agencyId,
            name: item.agencyName || item.agencyId,
            websiteUrl: item.agencyWebsiteUrl,
            primarySuburb: item.agencyPrimarySuburb,
          }
        : null;
  const agencyExistingPages = agency
    ? agency.id === item.id && item.kind === "agency"
      ? existingPages
      : await readExistingOwnedPages(rest, { kind: "agency", id: agency.id })
    : [];
  const knownAgencyFacebookLinks = agencySharedFacebookLinks(
    agency,
    savedDocs,
    agencyExistingPages,
  );
  const preexistingLinks = extractExactFacebookLinks(
    explicitLinksForEntity(item, savedDocs),
  );
  const existingLinks = existingPages
    .map((row) => existingPageLink(item, row))
    .filter(Boolean)
    .sort((a, b) => Number(Boolean(b.pageId)) - Number(Boolean(a.pageId)));
  const hasKnownExisting = existingLinks.some((link) => Boolean(link.pageId));
  const hasSavedReference =
    existingLinks.length > 0 || preexistingLinks.length > 0;
  let links = extractExactFacebookLinks([
    ...preexistingLinks,
    ...linksFromEntityDocuments(item, savedDocs),
  ]);
  let agencyDocs = [];
  if (agency && !hasSavedReference) {
    const agencyResult = await fetchAgencyWebsiteEvidence({
      rest,
      fetchImpl,
      agency,
      websiteUrl: agency.websiteUrl,
      now,
      rawEvidenceDir,
    });
    agencyDocs = agencyResult.docs || [];
    errors.push(...(agencyResult.errors || []));
  }
  if (item.kind === "agent" && agency && !links.length) {
    const indexedUrl = indexedProfileForAgent(item, [
      ...savedDocs,
      ...agencyDocs,
    ]);
    if (
      indexedUrl &&
      !agencyDocs.some(
        (doc) =>
          safePublicHttpsUrl(doc.source_url || sourceMeta(doc).website_url) ===
          safePublicHttpsUrl(indexedUrl),
      )
    ) {
      try {
        const profileUrl = safePublicHttpsUrl(indexedUrl);
        const profileBody = await boundedFetch(fetchImpl, profileUrl, {
          retries: 0,
        });
        const homepageFacebookLinks = agencyDocs
          .filter((doc) => sourceMeta(doc).crawl_role === "agency_homepage")
          .flatMap(
            (doc) =>
              sourceMeta(doc).agency_homepage_facebook_links ||
              sourceMeta(doc).official_facebook_links ||
              [],
          );
        const named = namedProfileEvidence(
          profileUrl,
          profileBody,
          homepageFacebookLinks,
        );
        const profileMetadata = {
          coverage_version: DIRECTORY_COVERAGE_VERSION,
          agency_id: agency.id,
          agency_name: agency.name,
          website_url: profileUrl,
          agency_homepage_facebook_links: homepageFacebookLinks,
          profile_names: named.profileNames,
          named_profile_facebook_links: named.namedLinks,
          facebook_owners: facebookOwnersFromHtml(profileBody),
          official_facebook_links: extractFacebookLinksFromHtml(
            profileUrl,
            profileBody,
          ).map((link) => link.url),
          fetched_at: checkedAt(now),
          crawl_role: "agency_profile",
          crawl_parent_url: safePublicHttpsUrl(agency.websiteUrl) || null,
        };
        const profileId = await persistSourceDocument(
          rest,
          AGENCY_SOURCE,
          profileUrl,
          profileBody,
          profileMetadata,
        );
        const profileDoc = {
          id: profileId,
          source: AGENCY_SOURCE,
          source_url: profileUrl,
          metadata: profileMetadata,
          fetched_at: profileMetadata.fetched_at,
        };
        agencyDocs.push(profileDoc);
        links.push(
          ...linksFromAgencyDocuments(
            item,
            [profileDoc],
            knownAgencyFacebookLinks,
          ),
        );
      } catch (error) {
        errors.push({
          url: indexedUrl,
          reason: "agency_named_profile_fetch_failed",
          error: error?.message || String(error),
        });
      }
    }
  }
  links = extractExactFacebookLinks([
    ...links,
    ...linksFromAgencyDocuments(item, agencyDocs, knownAgencyFacebookLinks),
  ]);
  for (const existing of extractExactFacebookLinks(existingLinks)) {
    const saved = existingLinks.find(
      (candidate) => candidate.url === existing.url,
    );
    if (saved) {
      existing.pageId = saved.pageId || existing.pageId;
      existing.existingDisabled = saved.existingDisabled === true;
      existing.existingAdvertiserPageId =
        saved.existingAdvertiserPageId || null;
      existing.sourceDocumentId = saved.sourceDocumentId || null;
    }
    links.push(existing);
  }
  const website = safePublicHttpsUrl(item.websiteUrl);
  if (
    !links.length &&
    website &&
    !isBlockedAgencyWebsiteUrl(website) &&
    website !== safePublicHttpsUrl(agency && agency.websiteUrl)
  ) {
    try {
      const cachedPath =
        "source_documents?select=id,metadata,fetched_at,source_url&source=eq.ad_radar_directory_website&source_url=eq." +
        enc(website) +
        "&fetched_at=gte." +
        enc(new Date(Date.parse(now()) - 7 * 86400000).toISOString()) +
        "&order=fetched_at.desc&limit=1";
      const cached = await tryReadDocuments(rest, cachedPath);
      let evidence = cached[0];
      if (!evidence) {
        const body = await boundedFetch(fetchImpl, website);
        const references = extractFacebookLinksFromHtml(website, body);
        const metadata = {
          coverage_version: DIRECTORY_COVERAGE_VERSION,
          official_facebook_links: references.map((link) => link.url),
          facebook_owners: facebookOwnersFromHtml(body),
          fetched_at: now(),
          entity_kind: item.kind,
          entity_id: item.id,
          subject_kind: item.kind,
          subject_id: item.id,
          agent_id: item.kind === "agent" ? item.id : null,
          agency_id: item.kind === "agency" ? item.id : item.agencyId || null,
        };
        const id = await persistSourceDocument(
          rest,
          "ad_radar_directory_website",
          website,
          body,
          metadata,
        );
        evidence = {
          id,
          metadata,
          source_url: website,
          fetched_at: metadata.fetched_at,
        };
        await writeAtomicJson(
          join(rawEvidenceDir, "directory-sources", hash(website) + ".json"),
          { url: website, body, source_document_id: id, fetched_at: now() },
        );
      }
      links.push(...linksForWebsiteEvidence(item, website, evidence));
    } catch (error) {
      errors.push({
        reason: "official_website_fetch_failed",
        error: error.message,
      });
    }
  }
  const search = links.length
    ? {
        receipts: [],
        searchCandidates: [],
        officialSiteCandidates: [],
        actualAttempted: false,
        reason: "known_page_reference_found",
      }
    : await runFacebookSearches(searchEvidence, item, job, now);
  if (!links.length && search.searchCandidates.length) {
    const verified = await verifySearchFacebookCandidates(
      item,
      search.searchCandidates,
      [...savedDocs, ...agencyDocs],
      fetchImpl,
      rest,
      rawEvidenceDir,
      now,
    );
    links.push(...verified.links);
    errors.push(...verified.rejected);
  }
  if (!links.length && search.officialSiteCandidates.length) {
    const inspected = await inspectOfficialSiteResults({
      rest,
      fetchImpl,
      item,
      results: search.officialSiteCandidates,
      now,
      rawEvidenceDir,
    });
    links.push(...inspected.links);
    errors.push(...inspected.errors);
  }
  for (const link of links
    .filter((candidate) => !candidate.pageId)
    .slice(0, 3)) {
    try {
      const body = await boundedFetch(fetchImpl, link.url, { retries: 0 });
      const pageId = facebookPageIdFromHtml(body, link.vanity);
      if (pageId) {
        link.pageId = pageId;
        if (!link.existingAdvertiserPageId)
          link.url = facebookPageReference(pageId).url;
      }
    } catch (error) {
      errors.push({
        url: link.url,
        reason: "facebook_page_id_fetch_failed",
        error: error?.message || String(error),
      });
    }
    if (!link.pageId && typeof resolvePageEvidence === "function") {
      try {
        const resolved = await resolvePageEvidence({
          exactUrl: link.url,
          entity: item,
          job,
          sourceDocumentIds: link.sourceDocumentId
            ? [link.sourceDocumentId]
            : [],
        });
        const candidateId = s(resolved && resolved.pageId);
        if (
          FB_ID.test(candidateId) &&
          resolved &&
          resolved.permalinkMatch === true
        ) {
          link.pageId = candidateId;
          if (!link.existingAdvertiserPageId)
            link.url =
              s(resolved.pageUrl) || facebookPageReference(candidateId).url;
          if (resolved.sourceDocumentId)
            link.sourceDocumentId = resolved.sourceDocumentId;
        } else {
          errors.push({
            url: link.url,
            reason: "facebook_page_identity_unconfirmed",
          });
        }
      } catch (error) {
        if (error?.retryable === true) throw error;
        errors.push({
          url: link.url,
          reason: "facebook_page_identity_failed",
          error: error?.message || String(error),
        });
      }
    }
  }
  const planExistingPages = existingPages.map((row) => ({
    ...row,
    entityKind: item.kind,
    entityId: item.id,
  }));
  const plan = buildDirectoryCoveragePlan({
    entities: [item],
    sourceLinks: links,
    existingPages: planExistingPages,
    generatedAt: now(),
  });
  const registrations = [];
  for (const candidate of plan.rows[0]?.status === "candidate"
    ? plan.rows[0].candidates
    : [])
    registrations.push(
      await registerDirectoryCandidate(
        rest,
        item,
        candidate,
        now(),
        existingPages,
      ),
    );
  const suffix = hash(
    `${DIRECTORY_COVERAGE_VERSION}:${payload.build_run_id || job.id}:${item.key}`,
  ).slice(0, 16);
  const manifestPath = join(
    s(rawEvidenceDir) || "/tmp",
    `ad-radar-directory-entity-${suffix}.json`,
  );
  const outcome = discoveryOutcome({
    item,
    now,
    links,
    plan,
    registrations,
    search,
    errors,
  });
  const result = {
    handler: "blockwise-ad-directory-discovery-entity",
    coverage_version: DIRECTORY_COVERAGE_VERSION,
    entity_kind: kind,
    entity_id: item.id,
    candidates: plan.rows[0]?.candidates?.length || 0,
    registered_pages: registrations.filter((row) => row.registered).length,
    status: plan.rows[0]?.status || "unmapped",
    errors,
    manifest_path: manifestPath,
    unresolved_is_not_zero: true,
    search_outcome: outcome.searchOutcome,
    checked_at: outcome.checkedAt,
    evidence: outcome.evidence,
    reason: outcome.reason,
    discovery_receipt: outcome,
  };
  await writeCoverageManifest(manifestPath, {
    version: DIRECTORY_COVERAGE_VERSION,
    generatedAt: now(),
    entity: item,
    plan,
    registrations,
    errors,
    discovery_receipt: outcome,
  });
  return { status: "complete", result };
}
async function registerDirectoryCandidate(
  rest,
  item,
  candidate,
  observedAt,
  existingPages = [],
) {
  const query =
    "advertiser_pages?select=id,page_id,agent_id,agency_id,status,scan_enabled&platform=eq.facebook&page_id=eq." +
    enc(candidate.pageId) +
    "&limit=1";
  const current = (await rest("research", query))?.[0];
  if (current) {
    const owned =
      item.kind === "agent"
        ? current.agent_id === item.id
        : current.agency_id === item.id;
    // Never replace existing ownership, quiet scheduling, disabled status or metadata.
    return {
      registered: false,
      existing: true,
      advertiserPageId: current.id,
      pageId: candidate.pageId,
      reason: owned
        ? "existing_exact_page"
        : "existing_page_requires_owner_review",
    };
  }
  const matchingSavedUrl = existingPages.find(
    (row) =>
      !existingPageIsRejected(row) &&
      normalizedPageUrl(row?.page_url) === candidate.url,
  );
  if (matchingSavedUrl) {
    const savedId = FB_ID.test(s(matchingSavedUrl.page_id))
      ? s(matchingSavedUrl.page_id)
      : null;
    if (savedId && savedId === candidate.pageId) {
      return {
        registered: false,
        existing: true,
        advertiserPageId: matchingSavedUrl.id,
        pageId: candidate.pageId,
        reason: "existing_exact_page",
      };
    }
    // The saved URL is the ownership evidence. Reconcile a newly resolved
    // numeric identity onto that same row only when it is still unresolved;
    // never enable it, change owner fields, or overwrite a global owner.
    if (!savedId && candidate.pageId && matchingSavedUrl.id) {
      const ownerColumn = item.kind === "agent" ? "agent_id" : "agency_id";
      const ownerFilter = "&" + ownerColumn + "=eq." + enc(item.id);
      if (isAutomaticSlugPause(matchingSavedUrl)) {
        const metadata = {
          ...sourceMeta(matchingSavedUrl),
          scan_disabled_reason: null,
          scan_reactivated_at: observedAt,
          scan_reactivation_reason: "strict_facebook_page_identity",
          scan_reactivation_source: candidate.sourceType || null,
        };
        const reactivated = await rest(
          "research",
          "advertiser_pages?id=eq." +
            enc(matchingSavedUrl.id) +
            ownerFilter +
            "&page_id=is.null&status=eq.verified_real_estate_unresolved&scan_enabled=eq.false&scan_state=eq.paused&metadata->>scan_disabled_reason=eq.unresolved_slug_page_id",
          {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({
              page_id: candidate.pageId,
              status: "resolved_collectable",
              scan_enabled: true,
              scan_state: "needs_first_fill",
              next_scan_at: observedAt,
              metadata,
            }),
          },
        );
        if (reactivated?.[0]?.id)
          return {
            registered: false,
            existing: true,
            reconciled: true,
            reactivated: true,
            advertiserPageId: reactivated[0].id,
            pageId: candidate.pageId,
            reason: "existing_exact_page_auto_reactivated",
          };
      }
      const patched = await rest(
        "research",
        "advertiser_pages?id=eq." +
          enc(matchingSavedUrl.id) +
          ownerFilter +
          "&page_id=is.null",
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ page_id: candidate.pageId }),
        },
      );
      if (patched?.[0]?.id)
        return {
          registered: false,
          existing: true,
          reconciled: true,
          advertiserPageId: patched[0].id,
          pageId: candidate.pageId,
          reason: "existing_exact_page_url_reconciled",
        };
    }
    return {
      registered: false,
      existing: true,
      advertiserPageId: matchingSavedUrl.id,
      pageId: candidate.pageId,
      reason: "existing_exact_page_url_unresolved",
    };
  }
  try {
    const created = await rest("research", "advertiser_pages", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        platform: "facebook",
        page_id: candidate.pageId,
        page_name: item.name,
        page_url: candidate.url,
        owner_type: item.kind,
        agent_id: item.kind === "agent" ? item.id : null,
        agency_id: item.kind === "agency" ? item.id : null,
        status: "resolved_collectable",
        scan_enabled: true,
        confidence: 80,
        last_seen_at: observedAt,
        metadata: {
          resolver: DIRECTORY_COVERAGE_VERSION,
          source_type: candidate.sourceType,
          source_document_id: candidate.sourceDocumentId,
          observed_at: observedAt,
        },
      }),
    });
    if (!created?.[0]?.id)
      throw new Error("Directory page insert returned no ID");
    return {
      registered: true,
      pageId: candidate.pageId,
      advertiserPageId: created[0].id,
    };
  } catch (error) {
    if (!/23505|409|duplicate key/iu.test(error.message)) throw error;
    const raced = (await rest("research", query))?.[0];
    if (!raced) throw error;
    return {
      registered: false,
      existing: true,
      pageId: candidate.pageId,
      advertiserPageId: raced.id,
      reason: "concurrent_page_registration",
    };
  }
}
