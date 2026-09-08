#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, basename, join } from "node:path";

export const DIRECTORY_DISCOVERY_JOB_TYPE = "blockwise-ad-directory-discovery";
export const DIRECTORY_COVERAGE_VERSION = "ad-radar-directory-coverage-v1";
const FB_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.com"]);
const FB_BLOCKED = /^(?:share|sharer|plugins?|dialog|login|help|ads|tr|events|groups?|posts?|reel|watch)(?:\/|$)/iu;
const FB_ID = /^\d{5,}$/u;
const PAGE_SIZE_MAX = 500;
function s(value) { return String(value ?? "").trim(); }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`; return JSON.stringify(value); }
function hash(value) { return createHash("sha256").update(typeof value === "string" ? value : stable(value)).digest("hex"); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function key(kind, id) { return `${s(kind).toLowerCase()}:${s(id)}`; }

export function normalizeState(value) { const state = s(value).toUpperCase(); return ["WA", "NSW", "VIC", "QLD", "SA", "TAS", "ACT", "NT"].includes(state) ? state : null; }
export function isEligibleWaEntity(entity) { return normalizeState(entity?.state) === "WA" && s(entity?.id) !== ""; }
function canonical(parsed, pageId = null) { const out = new URL(parsed.toString()); out.protocol = "https:"; out.hostname = "www.facebook.com"; out.username = ""; out.password = ""; out.search = ""; out.hash = ""; if (pageId) out.pathname = `/${pageId}`; return out.toString(); }

export function facebookPageReference(value) {
  const raw = s(value); if (!raw) return { url: null, pageId: null, vanity: null, reason: "empty_url" };
  let parsed; try { parsed = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`); } catch { return { url: raw, pageId: null, vanity: null, reason: "invalid_url" }; }
  if (!FB_HOSTS.has(parsed.hostname.toLowerCase())) return { url: raw, pageId: null, vanity: null, reason: "not_facebook" };
  const path = parsed.pathname.split("/").map((part) => decodeURIComponent(part)).filter(Boolean);
  if (!path.length || FB_BLOCKED.test(path.join("/"))) return { url: raw, pageId: null, vanity: null, reason: "non_page_facebook_path" };
  const queryId = parsed.searchParams.get("id"); const numeric = queryId && FB_ID.test(queryId) ? queryId : [...path].reverse().find((part) => FB_ID.test(part));
  if (numeric) return { url: canonical(parsed, numeric), pageId: numeric, vanity: null, reason: null };
  const vanity = path.find((part) => !/^pages?$/iu.test(part) && !/^profile\.php$/iu.test(part));
  return vanity ? { url: canonical(parsed), pageId: null, vanity, reason: "facebook_page_id_missing" } : { url: raw, pageId: null, vanity: null, reason: "facebook_page_id_missing" };
}

export function extractExactFacebookLinks(values) {
  const output = []; for (const item of Array.isArray(values) ? values : [values]) {
    const source = typeof item === "string" ? { url: item } : (item && typeof item === "object" ? item : null); if (!source) continue;
    const reference = facebookPageReference(source.url || source.href || source.facebook_url || source.facebookUrl);
    if (!reference.url || ["not_facebook", "invalid_url", "empty_url", "non_page_facebook_path"].includes(reference.reason)) continue;
    output.push({ url: reference.url, pageId: reference.pageId, vanity: reference.vanity, reason: reference.reason, entityKind: s(source.entityKind || source.entity_kind).toLowerCase() || null, entityId: s(source.entityId || source.entity_id) || null, ownerKind: s(source.ownerKind || source.owner_kind).toLowerCase() || null, sourceType: s(source.sourceType || source.source_type) || null, sourceDocumentId: s(source.sourceDocumentId || source.source_document_id) || null, isOfficial: source.isOfficial === true || source.is_official === true, explicitAssignment: source.explicitAssignment === true || source.explicit_assignment === true });
  }
  const seen = new Set(); return output.filter((item) => { const k = `${item.entityKind}:${item.entityId}:${item.url}:${item.sourceDocumentId}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
export function extractFacebookLinksFromHtml(baseUrl, html) {
  const body = s(html).slice(0, 2_000_000); const links = []; const attr = /(?:href|content|url)\s*=\s*["']([^"']+)["']/giu;
  for (const match of body.matchAll(attr)) { try { const url = new URL(match[1], baseUrl); if (FB_HOSTS.has(url.hostname.toLowerCase())) links.push({ url: url.toString() }); } catch {} }
  for (const match of body.matchAll(/https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/[^\s"'<>]+/giu)) links.push({ url: match[0] });
  return extractExactFacebookLinks(links);
}
export function facebookPageIdFromHtml(html, vanity = null) {
  const body = s(html); const escaped = vanity ? vanity.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") : null;
  if (escaped) { const match = new RegExp(`(?:userID|profile_id|page_id|pageID)\\s*["']?\\s*[:=]\\s*["']?(\\d{5,})["']?[^]{0,500}?(?:userVanity|username|vanity)[^]{0,500}?${escaped}`, "iu").exec(body); if (match?.[1]) return match[1]; }
  return /(?:userID|profile_id|page_id|pageID)\s*["']?\s*[:=]\s*["']?(\d{5,})/iu.exec(body)?.[1] || null;
}

function entity(row, kind) { return { kind, id: s(row?.id), key: key(kind, row?.id), name: s(row?.full_name || row?.name), state: normalizeState(row?.state), postcode: s(row?.primary_postcode) || null, websiteUrl: s(row?.website_url) || null }; }
export function explicitLinksForEntity(row, sourceDocuments = []) {
  const kind = s(row?.kind).toLowerCase(), id = s(row?.id), links = []; if (row?.website_url) links.push({ entityKind: kind, entityId: id, ownerKind: kind, isOfficial: true, sourceType: "official_entity_website", url: row.website_url });
  for (const doc of Array.isArray(sourceDocuments) ? sourceDocuments : []) { const meta = doc?.metadata && typeof doc.metadata === "object" ? doc.metadata : {}; if (s(meta.entity_id || meta.subject_id) !== id || s(meta.entity_kind || meta.subject_kind).toLowerCase() !== kind) continue; const embedded = meta.official_facebook_links || meta.official_links || meta.facebook_links || []; for (const link of Array.isArray(embedded) ? embedded : [embedded]) links.push({ ...(typeof link === "object" ? link : { url: link }), entityKind: kind, entityId: id, ownerKind: kind, isOfficial: true, sourceType: doc.source || "saved_source", sourceDocumentId: doc.id, explicitAssignment: meta.explicit_meta_assignment === true }); }
  return links;
}
export function buildDirectoryCoveragePlan({ entities = [], sourceLinks = [], existingPages = [], generatedAt = new Date().toISOString() } = {}) {
  const roster = new Map(); for (const row of entities) { const kind = s(row?.kind).toLowerCase(); if (!["agent", "agency"].includes(kind)) continue; const item = entity(row, kind); if (isEligibleWaEntity(item)) roster.set(item.key, item); }
  const grouped = new Map(); for (const link of extractExactFacebookLinks(sourceLinks)) { const k = key(link.entityKind, link.entityId); if (roster.has(k)) { if (!grouped.has(k)) grouped.set(k, []); grouped.get(k).push(link); } }
  const existing = new Set((existingPages || []).map((row) => `${key(row.entityKind || row.entity_kind, row.entityId || row.entity_id)}:${s(row.pageId || row.page_id)}`));
  const rows = [...roster.values()].sort((a, b) => a.key.localeCompare(b.key)).map((item) => { const rejected = [], valid = new Map(); for (const link of grouped.get(item.key) || []) { if (!link.isOfficial) { rejected.push({ url: link.url, reason: "source_not_explicitly_official" }); continue; } if (item.kind === "agent" && !(link.ownerKind === "agent" && link.explicitAssignment)) { rejected.push({ url: link.url, reason: "agent_profile_link_not_ownership" }); continue; } if (item.kind === "agency" && link.ownerKind && link.ownerKind !== "agency") { rejected.push({ url: link.url, reason: "ownership_kind_mismatch" }); continue; } if (!link.pageId) { rejected.push({ url: link.url, reason: link.reason || "facebook_page_id_missing" }); continue; } valid.set(link.pageId, link); }
    const candidates = [...valid.values()].map((link) => ({ pageId: link.pageId, url: link.url, sourceDocumentId: link.sourceDocumentId, sourceType: link.sourceType })).sort((a, b) => a.pageId.localeCompare(b.pageId)); const sourceDocumentIds = [...new Set((grouped.get(item.key) || []).map((link) => link.sourceDocumentId).filter(Boolean))].sort(); let status = "unmapped", reason = rejected[0]?.reason || "no_explicit_page_evidence"; if (candidates.length === 1) { status = existing.has(`${item.key}:${candidates[0].pageId}`) ? "covered" : "candidate"; reason = status === "covered" ? "existing_exact_page" : "exact_official_page_link"; } else if (candidates.length > 1) { status = "ambiguous"; reason = "multiple_exact_page_candidates"; } return { coverageKey: item.key, kind: item.kind, entityId: item.id, name: item.name, state: item.state, postcode: item.postcode, websiteUrl: item.websiteUrl, status, reason, candidates, sourceDocumentIds, rejected }; });
  return { version: DIRECTORY_COVERAGE_VERSION, generatedAt, eligibleEntities: rows.length, covered: rows.filter((r) => r.status === "covered").length, candidates: rows.filter((r) => r.status === "candidate").length, ambiguous: rows.filter((r) => r.status === "ambiguous").length, unmapped: rows.filter((r) => r.status === "unmapped").length, rows };
}

function checkpointShape(input = {}) { const out = input && typeof input === "object" ? clone(input) : {}; out.version = DIRECTORY_COVERAGE_VERSION; out.kinds ||= {}; out.entityCursor = Number.isInteger(out.entityCursor) && out.entityCursor >= 0 ? out.entityCursor : 0; for (const kind of ["agent", "agency"]) { out.kinds[kind] ||= {}; const x = out.kinds[kind]; x.pageSize ??= null; x.completedPages = [...new Set((x.completedPages || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b); x.rowCounts ||= {}; x.pageDigests ||= {}; x.rowsByPage ||= {}; x.exhausted ??= false; } return out; }
export async function enumerateDirectoryPages({ fetchPage, kinds = ["agent", "agency"], pageSize = 500, checkpoint = {}, onCheckpoint = null } = {}) {
  if (typeof fetchPage !== "function") throw new Error("fetchPage is required"); const size = Number(pageSize); if (!Number.isInteger(size) || size < 1 || size > PAGE_SIZE_MAX) throw new Error(`directory page size must be 1..${PAGE_SIZE_MAX}`); const state = checkpointShape(checkpoint), rows = [];
  for (const kind of kinds) { if (!["agent", "agency"].includes(kind)) throw new Error(`unsupported directory kind: ${kind}`); const x = state.kinds[kind]; if (x.pageSize && x.pageSize !== size) throw new Error(`${kind} checkpoint page size changed`); x.pageSize = size; let index = 0; while (!x.exhausted) { const saved = Array.isArray(x.rowsByPage[String(index)]) ? x.rowsByPage[String(index)] : null; if (x.completedPages.includes(index)) { if (saved) rows.push(...saved.map((r) => ({ ...r, kind }))); if (Number(x.rowCounts[String(index)]) < size) x.exhausted = true; index += 1; continue; } const response = await fetchPage(kind, index, size); if (!response || !Array.isArray(response.rows)) throw new Error(`${kind} page ${index} did not return rows[]`); const total = response.totalRecords == null ? null : Number(response.totalRecords); if (total != null && (!Number.isInteger(total) || total < 0)) throw new Error(`${kind} page ${index} returned invalid totalRecords`); if (x.totalRecords != null && total != null && x.totalRecords !== total) throw new Error(`${kind} totalRecords changed during enumeration`); if (total != null) x.totalRecords = total; x.pageCount = total == null ? null : Math.ceil(total / size); x.completedPages.push(index); x.completedPages.sort((a, b) => a - b); x.rowCounts[String(index)] = response.rows.length; x.pageDigests[String(index)] = hash(response.rows); x.rowsByPage[String(index)] = response.rows; rows.push(...response.rows.map((r) => ({ ...r, kind }))); if ((x.pageCount != null && index + 1 >= x.pageCount) || (x.pageCount == null && response.rows.length < size)) x.exhausted = true; if (typeof onCheckpoint === "function") await onCheckpoint(clone(state)); index += 1; } }
  state.completedAt = new Date().toISOString(); state.rowCount = rows.length; return { rows, checkpoint: state };
}
export async function readDirectoryCheckpoint(path) { try { return checkpointShape(JSON.parse(await readFile(path, "utf8"))); } catch (error) { if (error?.code === "ENOENT") return checkpointShape(); throw error; } }
export async function writeDirectoryCheckpoint(path, checkpoint) { return writeAtomicJson(path, checkpointShape(checkpoint)); }
export async function writeCoverageManifest(path, manifest) { return writeAtomicJson(path, manifest); }
async function writeAtomicJson(path, value) { if (!s(path)) throw new Error("checkpoint path is required"); await mkdir(dirname(path), { recursive: true }); const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`); await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await rename(tmp, path); return path; }

async function fetchDirectoryRows(rest, kind, index, size) { const table = kind === "agent" ? "agents" : "agencies"; const select = kind === "agent" ? "id,full_name,state,primary_postcode,website_url,agency_id" : "id,name,state,primary_postcode,website_url,is_real_estate"; const rows = await rest("research", `${table}?select=${select}&state=eq.WA&order=id.asc&limit=${size}&offset=${index * size}`); if (!Array.isArray(rows)) throw new Error(`${table} response was not an array`); return { rows, totalRecords: null }; }
function enc(value) { return encodeURIComponent(s(value)); }
export async function enqueueAdRadarDirectoryDiscovery({ rest, now = () => new Date().toISOString(), buildRunId = null, priority = 12, entityLimit = 50 } = {}) {
  if (typeof rest !== "function") throw new Error("rest is required");
  const dedupeKey = `ad-radar:directory:${s(buildRunId) || "wa"}`;
  const existing = await rest("research", `work_queue?select=id,status&dedupe_key=eq.${enc(dedupeKey)}&limit=10`);
  const current = (existing || []).find((row) => row.status);
  if (current?.id) return { enqueued: false, jobId: current.id, dedupeKey, status: current.status };
  const payload = { handler: DIRECTORY_DISCOVERY_JOB_TYPE, scope: "WA", build_run_id: s(buildRunId) || null, entity_limit: Math.max(1, Math.min(100, Number(entityLimit) || 50)), directory_coverage_version: DIRECTORY_COVERAGE_VERSION };
  const created = await rest("research", "work_queue", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ queue_name: "research", job_type: DIRECTORY_DISCOVERY_JOB_TYPE, dedupe_key: dedupeKey, priority, payload, status: "pending", available_at: now(), max_attempts: 3 }) });
  return { enqueued: Boolean(created?.[0]?.id), jobId: created?.[0]?.id || null, dedupeKey, status: "pending" };
}async function loadSavedDirectoryDocuments(rest) {
  try {
    const rows = await rest("research", "source_documents?select=id,source,source_url,metadata,fetched_at&source=in.(subject_website,agency_website,page_resolution_evidence,ad_radar_directory_website)&order=fetched_at.desc&limit=20000");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}
async function enqueueEntityDiscovery(rest, item, buildRunId, now, priority = 13) {
  const dedupeKey = `ad-radar:directory:entity:${item.kind}:${item.id}`;
  const existing = await rest("research", `work_queue?select=id,status&dedupe_key=eq.${enc(dedupeKey)}&limit=10`);
  const current = (existing || []).find((row) => row.status);
  if (current?.status === "pending" || current?.status === "claimed" || current?.status === "complete" || current?.status === "failed" || current?.status === "blocked") return { enqueued: false, jobId: current.id, status: current.status, dedupeKey };
  const created = await rest("research", "work_queue", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ queue_name: "research", job_type: "blockwise-ad-directory-discovery-entity", dedupe_key: dedupeKey, priority, payload: { handler: "blockwise-ad-directory-discovery-entity", scope: "WA", build_run_id: buildRunId, entity_kind: item.kind, entity_id: item.id, name: item.name, state: item.state, primary_postcode: item.postcode, website_url: item.websiteUrl, directory_coverage_version: DIRECTORY_COVERAGE_VERSION }, status: "pending", available_at: now(), max_attempts: 3 }) });
  return { enqueued: Boolean(created?.[0]?.id), jobId: created?.[0]?.id || null, status: "pending", dedupeKey };
}

export async function handleAdRadarPageDiscovery(job, { rest, now = () => new Date().toISOString(), rawEvidenceDir = process.env.RAW_EVIDENCE_DIR || "/tmp", maxEntities = null, pageSize = 500 } = {}) {
  if (!job?.id || typeof rest !== "function") throw new Error("job and rest are required");
  const payload = job.payload || {};
  const buildRunId = s(payload.build_run_id) || s(job.id);
  const root = s(rawEvidenceDir) || "/tmp";
  const suffix = hash(buildRunId).slice(0, 16);
  const checkpointPath = join(root, `ad-radar-directory-${suffix}.checkpoint.json`);
  const checkpoint = await readDirectoryCheckpoint(checkpointPath);
  const enumerated = await enumerateDirectoryPages({
    pageSize,
    checkpoint,
    fetchPage: (kind, index, size) => fetchDirectoryRows(rest, kind, index, size),
    onCheckpoint: (next) => writeDirectoryCheckpoint(checkpointPath, next),
  });
  const state = enumerated.checkpoint;
  const entities = enumerated.rows.map((row) => entity(row, row.kind)).filter(isEligibleWaEntity).sort((a, b) => a.key.localeCompare(b.key));
  const limit = Math.max(1, Math.min(Number(maxEntities || payload.entity_limit || 50) || 50, 100));
  const cursor = entities.length ? state.entityCursor % entities.length : 0;
  const selected = entities.slice(cursor, cursor + limit);
  if (selected.length < limit && entities.length > limit) selected.push(...entities.slice(0, limit - selected.length));
  const queued = [];
  for (const item of selected) queued.push(await enqueueEntityDiscovery(rest, item, buildRunId, now));
  state.entityCursor = entities.length ? (cursor + selected.length) % entities.length : 0;
  state.lastEntitySweepAt = now();
  await writeDirectoryCheckpoint(checkpointPath, state);
  return { status: "complete", result: { handler: DIRECTORY_DISCOVERY_JOB_TYPE, build_run_id: buildRunId, enumerated_entities: entities.length, selected_entities: selected.length, queued_entities: queued.filter((row) => row.enqueued).length, already_queued_entities: queued.filter((row) => !row.enqueued).length, checkpoint_path: checkpointPath, unresolved_is_not_zero: true } };
}

function safePublicHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host === "metadata.google.internal" || host === "169.254.169.254" || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return null;
    return url.toString();
  } catch { return null; }
}


async function readBoundedBody(response, maxBytes = 1_000_000) {
  if (response.body?.getReader) {
    const reader = response.body.getReader(); const chunks = []; let total = 0;
    for (;;) { const next = await reader.read(); if (next.done) break; total += next.value.byteLength; if (total > maxBytes) { await reader.cancel(); throw new Error("response body exceeded bounded directory evidence size"); } chunks.push(next.value); }
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  }
  const body = await response.text(); if (Buffer.byteLength(body) > maxBytes) throw new Error("response body exceeded bounded directory evidence size"); return body;
}

async function boundedFetch(fetchImpl, url, { timeoutMs = 15000, retries = 1 } = {}) {
  const safeUrl = safePublicHttpsUrl(url); if (!safeUrl) throw new Error("unsafe public HTTPS directory URL"); let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(safeUrl, { signal: controller.signal, redirect: "manual", headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Blockwise Ad Radar directory verification" } });
      if (response.status >= 300 && response.status < 400) { const location = response.headers?.get?.("location"); const redirect = safePublicHttpsUrl(location ? new URL(location, safeUrl).toString() : ""); if (!redirect) throw new Error("unsafe directory redirect"); return boundedFetch(fetchImpl, redirect, { timeoutMs, retries: 0 }); }
      if (!response.ok) throw new Error(`HTTP ${response.status}`); return await readBoundedBody(response);
    } catch (error) { last = error; if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1))); }
    finally { clearTimeout(timer); }
  }
  throw last;
}

async function persistSourceDocument(rest, source, url, body, metadata) {
  const contentHash = hash(body); const existing = await rest("research", `source_documents?select=id&source=eq.${enc(source)}&content_hash=eq.${enc(contentHash)}&limit=1`); if (existing?.[0]?.id) return existing[0].id;
  const created = await rest("research", "source_documents", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ source, source_url: url, content_hash: contentHash, mime_type: "text/html", byte_size: Buffer.byteLength(body), metadata }) }); return created?.[0]?.id || null;
}
export async function handleAdRadarEntityDiscovery(job, { rest, fetchImpl = globalThis.fetch, now = () => new Date().toISOString(), rawEvidenceDir = process.env.RAW_EVIDENCE_DIR || "/tmp" } = {}) {
  if (!job?.id || typeof rest !== "function" || typeof fetchImpl !== "function") throw new Error("job, rest and fetchImpl are required");
  const payload = job.payload || {};
  const kind = s(payload.entity_kind).toLowerCase();
  const item = entity({ id: payload.entity_id, name: payload.name, full_name: payload.name, state: payload.state, primary_postcode: payload.primary_postcode, website_url: payload.website_url }, kind);
  if (!["agent", "agency"].includes(kind) || !isEligibleWaEntity(item)) return { status: "blocked", blocked_reason: "directory_entity_not_eligible_wa", result: { handler: "blockwise-ad-directory-discovery-entity", entity_kind: kind, entity_id: item.id } };
  const sourcePath = `source_documents?select=id,source,source_url,metadata,fetched_at&metadata->>entity_kind=eq.${enc(kind)}&metadata->>entity_id=eq.${enc(item.id)}&order=fetched_at.desc&limit=25`;
  let savedDocs = [];
  try { const rows = await rest("research", sourcePath); savedDocs = Array.isArray(rows) ? rows : []; } catch { savedDocs = []; }
  const links = extractExactFacebookLinks(explicitLinksForEntity(item, savedDocs));
  const errors = [];
  const website = safePublicHttpsUrl(item.websiteUrl);
  if (!links.length && website) {
    try {
      const body = await boundedFetch(fetchImpl, website);
      const found = extractFacebookLinksFromHtml(website, body).map((link) => ({ ...link, entityKind: kind, entityId: item.id, ownerKind: kind, isOfficial: true, sourceType: "official_entity_website" }));
      const sourceDocumentId = await persistSourceDocument(rest, "ad_radar_directory_website", website, body, { coverage_version: DIRECTORY_COVERAGE_VERSION, entity_kind: kind, entity_id: item.id, official_facebook_links: found.map((link) => link.url), fetched_at: now() });
      for (const link of found) { link.sourceDocumentId = sourceDocumentId; links.push(link); }
    } catch (error) { errors.push({ url: website, reason: "official_website_fetch_failed", error: error?.message || String(error) }); }
  } else if (item.websiteUrl && !website) {
    errors.push({ url: item.websiteUrl, reason: "unsafe_official_website_url" });
  }
  for (const link of links.filter((candidate) => !candidate.pageId).slice(0, 3)) {
    try {
      const body = await boundedFetch(fetchImpl, link.url, { retries: 0 });
      const pageId = facebookPageIdFromHtml(body, link.vanity);
      if (pageId) { link.pageId = pageId; link.url = facebookPageReference(pageId).url; }
    } catch (error) { errors.push({ url: link.url, reason: "facebook_page_id_fetch_failed", error: error?.message || String(error) }); }
  }
  const plan = buildDirectoryCoveragePlan({ entities: [item], sourceLinks: links, generatedAt: now() });
  const registrations = [];
  for (const candidate of plan.rows[0]?.candidates || []) registrations.push(await registerDirectoryCandidate(rest, item, candidate, now()));
  const suffix = hash(`${payload.build_run_id || job.id}:${item.key}`).slice(0, 16);
  const manifestPath = join(s(rawEvidenceDir) || "/tmp", `ad-radar-directory-entity-${suffix}.json`);
  await writeCoverageManifest(manifestPath, { version: DIRECTORY_COVERAGE_VERSION, generatedAt: now(), entity: item, plan, registrations, errors });
  return { status: "complete", result: { handler: "blockwise-ad-directory-discovery-entity", entity_kind: kind, entity_id: item.id, candidates: plan.rows[0]?.candidates?.length || 0, registered_pages: registrations.filter((row) => row.registered).length, status: plan.rows[0]?.status || "unmapped", errors, manifest_path: manifestPath, unresolved_is_not_zero: true } };
}

async function registerDirectoryCandidate(rest, item, candidate, observedAt) {
  const existing = await rest("research", `advertiser_pages?select=id,page_id,agent_id,agency_id,status,scan_enabled&platform=eq.facebook&page_id=eq.${enc(candidate.pageId)}&limit=1`);
  const owner = item.kind === "agent" ? { agent_id: item.id, agency_id: null } : { agent_id: null, agency_id: item.id };
  const current = existing?.[0];
  if (current && current.scan_enabled === false) return { registered: false, pageId: candidate.pageId, reason: "existing_page_disabled" };
  if (current && ((current.agent_id && current.agent_id !== owner.agent_id) || (current.agency_id && current.agency_id !== owner.agency_id))) return { registered: false, pageId: candidate.pageId, reason: "conflicting_page_owner" };
  const patch = { page_url: candidate.url, ...owner, status: current?.status === "rejected_non_real_estate" ? current.status : "resolved_collectable", scan_enabled: true, metadata: { resolver: "ad_radar_directory_coverage", source_type: candidate.sourceType || "official_link", source_document_id: candidate.sourceDocumentId || null, observed_at: observedAt } };
  if (current?.id) { const updated = await rest("research", `advertiser_pages?id=eq.${enc(current.id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) }); return { registered: Boolean(updated?.[0]?.id || updated?.id), pageId: candidate.pageId, advertiserPageId: current.id, existing: true }; }
  const created = await rest("research", "advertiser_pages", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ platform: "facebook", page_id: candidate.pageId, page_name: null, ...patch, confidence: 80, last_seen_at: observedAt }) });
  return { registered: Boolean(created?.[0]?.id), pageId: candidate.pageId, advertiserPageId: created?.[0]?.id || null, existing: false };
}