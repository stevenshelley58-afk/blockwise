#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
export const DIRECTORY_DISCOVERY_JOB_TYPE = "blockwise-ad-directory-discovery";
export const DIRECTORY_COVERAGE_VERSION = "ad-radar-directory-coverage-v1";
const FB_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.com"]);
const FB_BLOCKED = /^(?:share|sharer|plugins?|dialog|login|help|ads|tr|events|groups?|posts?|reel|watch)(?:\/|$)/iu;
const FB_ID = /^\d{5,}$/u;
const PAGE_SIZE_MAX = 500;
function s(value) { return String(value ?? "").trim(); }
function stable(value) { if (Array.isArray(value))
    return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`; return JSON.stringify(value); }
function hash(value) { return createHash("sha256").update(typeof value === "string" ? value : stable(value)).digest("hex"); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function key(kind, id) { return `${s(kind).toLowerCase()}:${s(id)}`; }
export function normalizeState(value) { const state = s(value).toUpperCase(); return ["WA", "NSW", "VIC", "QLD", "SA", "TAS", "ACT", "NT"].includes(state) ? state : null; }
export function isEligibleWaEntity(entity) { return normalizeState(entity?.state) === "WA" && s(entity?.id) !== ""; }
function canonical(parsed, pageId = null) { const out = new URL(parsed.toString()); out.protocol = "https:"; out.hostname = "www.facebook.com"; out.username = ""; out.password = ""; out.search = ""; out.hash = ""; if (pageId)
    out.pathname = `/${pageId}`; return out.toString(); }
export function facebookPageReference(value) {
    const raw = s(value);
    if (FB_ID.test(raw))
        return { url: `https://www.facebook.com/${raw}`, pageId: raw, vanity: null, reason: null };
    if (!raw)
        return { url: null, pageId: null, vanity: null, reason: "empty_url" };
    let parsed;
    try {
        parsed = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
    }
    catch {
        return { url: raw, pageId: null, vanity: null, reason: "invalid_url" };
    }
    if (!FB_HOSTS.has(parsed.hostname.toLowerCase()))
        return { url: raw, pageId: null, vanity: null, reason: "not_facebook" };
    let path;
    try {
        path = parsed.pathname.split("/").map((part) => decodeURIComponent(part)).filter(Boolean);
    }
    catch {
        return { url: raw, pageId: null, vanity: null, reason: "invalid_url" };
    }
    if (!path.length || FB_BLOCKED.test(path.join("/")))
        return { url: raw, pageId: null, vanity: null, reason: "non_page_facebook_path" };
    if (path.some((part) => /^(posts?|photos?|videos?|reels?|stories|permalink\.php)$/iu.test(part)))
        return { url: raw, pageId: null, vanity: null, reason: "non_page_facebook_path" };
    const queryId = parsed.searchParams.get("id");
    const numeric = path[0] === "profile.php" && FB_ID.test(queryId || "") ? queryId
        : path.length === 1 && FB_ID.test(path[0]) ? path[0]
            : path[0].toLowerCase() === "pages" && FB_ID.test(path.at(-1)) ? path.at(-1) : null;
    if (!numeric && path.length > 1 && path[0].toLowerCase() !== "pages")
        return { url: raw, pageId: null, vanity: null, reason: "non_page_facebook_path" };
    if (numeric)
        return { url: canonical(parsed, numeric), pageId: numeric, vanity: null, reason: null };
    const vanity = path.find((part) => !/^pages?$/iu.test(part) && !/^profile\.php$/iu.test(part));
    return vanity ? { url: canonical(parsed), pageId: null, vanity, reason: "facebook_page_id_missing" } : { url: raw, pageId: null, vanity: null, reason: "facebook_page_id_missing" };
}
export function extractExactFacebookLinks(values) {
    const output = [];
    for (const item of Array.isArray(values) ? values : [values]) {
        const source = typeof item === "string" ? { url: item } : (item && typeof item === "object" ? item : null);
        if (!source)
            continue;
        const reference = facebookPageReference(source.url || source.href || source.facebook_url || source.facebookUrl);
        if (!reference.url || ["not_facebook", "invalid_url", "empty_url", "non_page_facebook_path"].includes(reference.reason))
            continue;
        output.push({ url: reference.url, pageId: reference.pageId, vanity: reference.vanity, reason: reference.reason, entityKind: s(source.entityKind || source.entity_kind).toLowerCase() || null, entityId: s(source.entityId || source.entity_id) || null, ownerKind: s(source.ownerKind || source.owner_kind).toLowerCase() || null, sourceType: s(source.sourceType || source.source_type) || null, sourceDocumentId: s(source.sourceDocumentId || source.source_document_id) || null, isOfficial: source.isOfficial === true || source.is_official === true, explicitAssignment: source.explicitAssignment === true || source.explicit_assignment === true });
    }
    const seen = new Set();
    return output.filter((item) => { const k = `${item.entityKind}:${item.entityId}:${item.url}:${item.sourceDocumentId}`; if (seen.has(k))
        return false; seen.add(k); return true; });
}
export function extractFacebookLinksFromHtml(baseUrl, html) {
    const body = s(html).slice(0, 2000000);
    const links = [];
    const attr = /(?:href|content|url)\s*=\s*["']([^"']+)["']/giu;
    for (const match of body.matchAll(attr)) {
        try {
            const url = new URL(match[1], baseUrl);
            if (FB_HOSTS.has(url.hostname.toLowerCase()))
                links.push({ url: url.toString() });
        }
        catch { }
    }
    for (const match of body.matchAll(/https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/[^\s"'<>]+/giu))
        links.push({ url: match[0] });
    return extractExactFacebookLinks(links);
}
const directoryHosts = new Set(["reiwa.com.au", "realestate.com.au", "domain.com.au", "ratemyagent.com.au", "homely.com.au", "soho.com.au", "allhomes.com.au"]);
const identityName = value => s(value).toLowerCase().replace(/&/gu," and ").replace(/[^a-z0-9]+/gu," ").trim();
export function facebookOwnersFromHtml(html) {
    const owners = [];
    const visit = (value, depth = 0) => {
        if (!value || typeof value !== "object" || depth > 20) return;
        if (Array.isArray(value)) { for (const row of value) visit(row, depth + 1); return; }
        const types = [value["@type"]].flat();
        const kind = types.includes("Person") ? "agent" :
            types.some(type => ["Organization", "RealEstateAgent", "LocalBusiness"].includes(type)) ? "agency" : null;
        const urls = extractExactFacebookLinks([value.sameAs || []].flat()).map(link => link.url);
        if (kind && value.name && urls.length) owners.push({kind, name:s(value.name), urls});
        for (const child of Object.values(value)) visit(child, depth + 1);
    };
    for (const match of s(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
        try { visit(JSON.parse(match[1])); } catch { /* invalid structured evidence is not ownership */ }
    }
    return owners;
}
export function linksForWebsiteEvidence(item, website, evidence) {
    const metadata = evidence.metadata || {};
    const assigned = (metadata.facebook_owners || []).filter(owner =>
        owner.kind === item.kind && identityName(owner.name) === identityName(item.name));
    const urls = assigned.flatMap(owner => owner.urls || []);
    const host = new URL(website).hostname.replace(/^www\./u, "").toLowerCase();
    const directory = [...directoryHosts].some(domain => host === domain || host.endsWith("." + domain));
    // Directory footer links prove the directory's identity, not the listed agency's.
    // Person ownership always requires an explicit sameAs assignment.
    const fallback = item.kind === "agency" && !directory && urls.length === 0
        ? metadata.official_facebook_links || [] : [];
    return extractExactFacebookLinks([...urls, ...fallback].map(url => ({
        url, entityKind:item.kind, entityId:item.id, ownerKind:item.kind,
        isOfficial:true, explicitAssignment:urls.includes(url),
        sourceType:urls.includes(url) ? "structured_same_as" : "official_entity_website",
        sourceDocumentId:evidence.id,
    })));
}
export function facebookPageIdFromHtml(html, vanity = null) {
    if (!vanity)
        return null;
    const expected = s(vanity).toLowerCase();
    const found = new Set();
    // Correlate a single small JSON object, not the first userID anywhere in HTML.
    for (const match of s(html).replace(/&quot;/gu, '"').replace(/\\"/gu, '"')
        .matchAll(/\{[^{}]{0,3000}\}/gu)) {
        try {
            const row = JSON.parse(match[0]);
            const name = s(row.userVanity || row.username || row.vanity).toLowerCase();
            const id = s(row.page_id || row.pageID || row.profile_id || row.userID);
            if (name === expected && FB_ID.test(id))
                found.add(id);
        }
        catch { }
    }
    return found.size === 1 ? [...found][0] : null;
}
function entity(row, kind) { return { kind, id: s(row?.id), key: key(kind, row?.id), name: s(row?.full_name || row?.name), state: normalizeState(row?.state), postcode: s(row?.primary_postcode || row?.postcode) || null, websiteUrl: s(row?.website_url || row?.websiteUrl) || null }; }
export function explicitLinksForEntity(row, sourceDocuments = []) {
    const kind = s(row?.kind).toLowerCase(), id = s(row?.id), links = [];
    if (row?.website_url || row?.websiteUrl)
        links.push({ entityKind: kind, entityId: id, ownerKind: kind, isOfficial: true, sourceType: "official_entity_website", url: row.website_url || row.websiteUrl });
    for (const doc of Array.isArray(sourceDocuments) ? sourceDocuments : []) {
        const meta = doc?.metadata && typeof doc.metadata === "object" ? doc.metadata : {};
        if (s(meta.entity_id || meta.subject_id) !== id || s(meta.entity_kind || meta.subject_kind).toLowerCase() !== kind)
            continue;
        const embedded = meta.official_facebook_links || meta.official_links || meta.facebook_links || [];
        for (const link of Array.isArray(embedded) ? embedded : [embedded])
            links.push({ ...(typeof link === "object" ? link : { url: link }), entityKind: kind, entityId: id, ownerKind: kind, isOfficial: true, sourceType: doc.source || "saved_source", sourceDocumentId: doc.id, explicitAssignment: meta.explicit_meta_assignment === true });
    }
    return links;
}
export function buildDirectoryCoveragePlan({ entities = [], sourceLinks = [], existingPages = [], generatedAt = new Date().toISOString() } = {}) {
    const roster = new Map();
    for (const row of entities) {
        const kind = s(row?.kind).toLowerCase();
        if (!["agent", "agency"].includes(kind))
            continue;
        const item = entity(row, kind);
        if (isEligibleWaEntity(item))
            roster.set(item.key, item);
    }
    const grouped = new Map();
    for (const link of extractExactFacebookLinks(sourceLinks)) {
        const k = key(link.entityKind, link.entityId);
        if (roster.has(k)) {
            if (!grouped.has(k))
                grouped.set(k, []);
            grouped.get(k).push(link);
        }
    }
    const existing = new Set((existingPages || []).map((row) => `${key(row.entityKind || row.entity_kind, row.entityId || row.entity_id)}:${s(row.pageId || row.page_id)}`));
    const rows = [...roster.values()].sort((a, b) => a.key.localeCompare(b.key)).map((item) => {
        const rejected = [], valid = new Map();
        for (const link of grouped.get(item.key) || []) {
            if (!link.isOfficial) {
                rejected.push({ url: link.url, reason: "source_not_explicitly_official" });
                continue;
            }
            if (item.kind === "agent" && !(link.ownerKind === "agent" && link.explicitAssignment)) {
                rejected.push({ url: link.url, reason: "agent_profile_link_not_ownership" });
                continue;
            }
            if (item.kind === "agency" && link.ownerKind && link.ownerKind !== "agency") {
                rejected.push({ url: link.url, reason: "ownership_kind_mismatch" });
                continue;
            }
            if (!link.pageId) {
                rejected.push({ url: link.url, reason: link.reason || "facebook_page_id_missing" });
                continue;
            }
            valid.set(link.pageId, link);
        }
        const candidates = [...valid.values()].map((link) => ({ pageId: link.pageId, url: link.url, sourceDocumentId: link.sourceDocumentId, sourceType: link.sourceType })).sort((a, b) => a.pageId.localeCompare(b.pageId));
        const sourceDocumentIds = [...new Set((grouped.get(item.key) || []).map((link) => link.sourceDocumentId).filter(Boolean))].sort();
        let status = "unmapped", reason = rejected[0]?.reason || "no_explicit_page_evidence";
        if (candidates.length === 1) {
            status = existing.has(`${item.key}:${candidates[0].pageId}`) ? "covered" : "candidate";
            reason = status === "covered" ? "existing_exact_page" : "exact_official_page_link";
        }
        else if (candidates.length > 1) {
            status = "ambiguous";
            reason = "multiple_exact_page_candidates";
        }
        return { coverageKey: item.key, kind: item.kind, entityId: item.id, name: item.name, state: item.state, postcode: item.postcode, websiteUrl: item.websiteUrl, status, reason, candidates, sourceDocumentIds, rejected };
    });
    return { version: DIRECTORY_COVERAGE_VERSION, generatedAt, eligibleEntities: rows.length, covered: rows.filter((r) => r.status === "covered").length, candidates: rows.filter((r) => r.status === "candidate").length, ambiguous: rows.filter((r) => r.status === "ambiguous").length, unmapped: rows.filter((r) => r.status === "unmapped").length, rows };
}
function checkpointShape(input = {}) { const out = input && typeof input === "object" ? clone(input) : {}; out.version = DIRECTORY_COVERAGE_VERSION; out.kinds ||= {}; out.entityCursor = Number.isInteger(out.entityCursor) && out.entityCursor >= 0 ? out.entityCursor : 0; for (const kind of ["agent", "agency"]) {
    out.kinds[kind] ||= {};
    const x = out.kinds[kind];
    x.pageSize ??= null;
    x.completedPages = [...new Set((x.completedPages || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
    x.rowCounts ||= {};
    x.pageDigests ||= {};
    x.rowsByPage ||= {};
    x.exhausted ??= false;
} return out; }
export async function enumerateDirectoryPages({ fetchPage, kinds = ["agent", "agency"], pageSize = 500, checkpoint = {}, onCheckpoint = null } = {}) {
    if (typeof fetchPage !== "function")
        throw new Error("fetchPage is required");
    const size = Number(pageSize);
    if (!Number.isInteger(size) || size < 1 || size > PAGE_SIZE_MAX)
        throw new Error(`directory page size must be 1..${PAGE_SIZE_MAX}`);
    const state = checkpointShape(checkpoint), rows = [];
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
            const saved = Array.isArray(x.rowsByPage[String(index)]) ? x.rowsByPage[String(index)] : null;
            if (x.completedPages.includes(index)) {
                if (saved)
                    rows.push(...saved.map((r) => ({ ...r, kind })));
                if (Number(x.rowCounts[String(index)]) < size)
                    x.exhausted = true;
                index += 1;
                continue;
            }
            const response = await fetchPage(kind, index, size);
            if (!response || !Array.isArray(response.rows))
                throw new Error(`${kind} page ${index} did not return rows[]`);
            const total = response.totalRecords == null ? null : Number(response.totalRecords);
            if (total != null && (!Number.isInteger(total) || total < 0))
                throw new Error(`${kind} page ${index} returned invalid totalRecords`);
            if (x.totalRecords != null && total != null && x.totalRecords !== total)
                throw new Error(`${kind} totalRecords changed during enumeration`);
            if (total != null)
                x.totalRecords = total;
            x.pageCount = total == null ? null : Math.ceil(total / size);
            x.completedPages.push(index);
            x.completedPages.sort((a, b) => a - b);
            x.rowCounts[String(index)] = response.rows.length;
            x.pageDigests[String(index)] = hash(response.rows);
            x.rowsByPage[String(index)] = response.rows;
            rows.push(...response.rows.map((r) => ({ ...r, kind })));
            if ((x.pageCount != null && index + 1 >= x.pageCount) || (x.pageCount == null && response.rows.length < size))
                x.exhausted = true;
            if (typeof onCheckpoint === "function")
                await onCheckpoint(clone(state));
            index += 1;
        }
    }
    state.completedAt = new Date().toISOString();
    state.rowCount = rows.length;
    return { rows, checkpoint: state };
}
export async function readDirectoryCheckpoint(path) { try {
    return checkpointShape(JSON.parse(await readFile(path, "utf8")));
}
catch (error) {
    if (error?.code === "ENOENT")
        return checkpointShape();
    throw error;
} }
export async function writeDirectoryCheckpoint(path, checkpoint) { return writeAtomicJson(path, checkpointShape(checkpoint)); }
export async function writeCoverageManifest(path, manifest) { return writeAtomicJson(path, manifest); }
async function writeAtomicJson(path, value) { if (!s(path))
    throw new Error("checkpoint path is required"); await mkdir(dirname(path), { recursive: true }); const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`); await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await rename(tmp, path); return path; }
async function fetchDirectoryRows(rest, kind, index, size) { const table = kind === "agent" ? "agents" : "agencies"; const select = kind === "agent" ? "id,full_name,state,primary_postcode,website_url,agency_id" : "id,name,state,primary_postcode,website_url,is_real_estate"; const rows = await rest("research", `${table}?select=${select}&state=eq.WA&order=id.asc&limit=${size}&offset=${index * size}`); if (!Array.isArray(rows))
    throw new Error(`${table} response was not an array`); return { rows, totalRecords: null }; }
function enc(value) { return encodeURIComponent(s(value)); }
export async function enqueueAdRadarDirectoryDiscovery({ rest, now = () => new Date().toISOString(), buildRunId = null, priority = 12, entityLimit = 50 } = {}) {
    if (typeof rest !== "function")
        throw new Error("rest is required");
    const sweep = String(Math.floor(Date.parse(now()) / (7 * 86400000)));
    const dedupeKey = `ad-radar:directory:wa:${sweep}`;
    const existing = await rest("research", `work_queue?select=id,status&dedupe_key=eq.${enc(dedupeKey)}&limit=10`);
    const current = (existing || []).find((row) => row.status);
    if (current?.id)
        return { enqueued: false, jobId: current.id, dedupeKey, status: current.status };
    const payload = { handler: DIRECTORY_DISCOVERY_JOB_TYPE, scope: "WA", build_run_id: s(buildRunId) || null, sweep_id: sweep, entity_limit: Math.max(1, Math.min(100, Number(entityLimit) || 50)), directory_coverage_version: DIRECTORY_COVERAGE_VERSION };
    const created = await rest("research", "work_queue", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ queue_name: "research", job_type: DIRECTORY_DISCOVERY_JOB_TYPE, dedupe_key: dedupeKey, priority, payload, status: "pending", available_at: now(), max_attempts: 3 }) });
    return { enqueued: Boolean(created?.[0]?.id), jobId: created?.[0]?.id || null, dedupeKey, status: "pending" };
}
async function enqueueEntityDiscovery(rest, item, buildRunId, now, priority = 13) {
    const dedupeKey = `ad-radar:directory:entity:${item.kind}:${item.id}:${buildRunId}`;
    const existing = await rest("research", `work_queue?select=id,status&dedupe_key=eq.${enc(dedupeKey)}&limit=10`);
    const current = (existing || []).find((row) => row.status);
    if (current?.status === "pending" || current?.status === "claimed" || current?.status === "complete" || current?.status === "failed" || current?.status === "blocked")
        return { enqueued: false, jobId: current.id, status: current.status, dedupeKey };
    const created = await rest("research", "work_queue", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ queue_name: "research", job_type: "blockwise-ad-directory-discovery-entity", dedupe_key: dedupeKey, priority, payload: { handler: "blockwise-ad-directory-discovery-entity", scope: "WA", build_run_id: buildRunId, entity_kind: item.kind, entity_id: item.id, name: item.name, state: item.state, primary_postcode: item.postcode, website_url: item.websiteUrl, directory_coverage_version: DIRECTORY_COVERAGE_VERSION }, status: "pending", available_at: now(), max_attempts: 3 }) });
    return { enqueued: Boolean(created?.[0]?.id), jobId: created?.[0]?.id || null, status: "pending", dedupeKey };
}
export async function handleAdRadarPageDiscovery(job, { rest, now = () => new Date().toISOString(), rawEvidenceDir = process.env.RAW_EVIDENCE_DIR || "/tmp", maxEntities = null, pageSize = 500 } = {}) {
    if (!job?.id || typeof rest !== "function")
        throw new Error("job and rest are required");
    const payload = job.payload || {};
    const buildRunId = s(payload.sweep_id) || s(payload.build_run_id) || s(job.id);
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
        const existing = await rest("research", `work_queue?select=id&dedupe_key=eq.${enc(nextKey)}&limit=1`);
        if (!existing.length)
            await rest("research", "work_queue", { method: "POST",
                headers: { Prefer: "return=representation" }, body: JSON.stringify({
                    queue_name: "research", job_type: DIRECTORY_DISCOVERY_JOB_TYPE, dedupe_key: nextKey,
                    priority: 12, status: "pending", available_at: now(), max_attempts: 3,
                    payload: { ...payload, handler: DIRECTORY_DISCOVERY_JOB_TYPE, sweep_id: buildRunId,
                        entity_cursor: state.entityCursor }
                }) });
    }
    return { status: "complete", result: { handler: DIRECTORY_DISCOVERY_JOB_TYPE, build_run_id: buildRunId, enumerated_entities: entities.length, selected_entities: selected.length, queued_entities: queued.filter((row) => row.enqueued).length, already_queued_entities: queued.filter((row) => !row.enqueued).length, checkpoint_path: checkpointPath, unresolved_is_not_zero: true } };
}
function safePublicHttpsUrl(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || url.port)
            return null;
        const host = url.hostname.toLowerCase();
        if (!host.includes(".") || host.includes(":") || host.startsWith("[") || host === "localhost" || host.endsWith(".local") || host === "metadata.google.internal" || host === "169.254.169.254" || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host))
            return null;
        return url.toString();
    }
    catch {
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
            if (next.done)
                break;
            total += next.value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new Error("response body exceeded bounded directory evidence size");
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
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
        return false;
    const [a, b] = parts;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) ||
        (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
}
async function publicFetch(url, { signal }) {
    const parsed = new URL(url);
    const addresses = await lookup(parsed.hostname, { all: true, family: 4 });
    if (!addresses.length || addresses.some((row) => !isPublicDirectoryAddress(row.address)))
        throw new Error("Directory hostname resolves to a non-public address");
    signal.throwIfAborted();
    // Pin validated DNS for this connection; redirects are checked separately.
    return new Promise((resolve, reject) => {
        const selected = addresses[0];
        const req = request(parsed, { signal, lookup: (_host, options, callback) => options.all ? callback(null, [selected]) : callback(null, selected.address, 4),
            headers: { "user-agent": "Blockwise Ad Radar directory verification", accept: "text/html" } }, async (response) => {
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
                resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers }));
            }
            catch (error) {
                reject(error);
            }
        });
        req.on("error", reject);
        req.end();
    });
}
export async function boundedDirectoryFetch(fetchImpl, url, { timeoutMs = 15000, retries = 1 } = {}) {
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            let current = url;
            for (let redirects = 0; redirects <= 3; redirects++) {
                const safe = safePublicHttpsUrl(current);
                if (!safe)
                    throw new Error("Unsafe public HTTPS directory URL");
                const response = await (fetchImpl === globalThis.fetch ? publicFetch : fetchImpl)(safe, {
                    signal: controller.signal, redirect: "manual",
                    headers: { accept: "text/html", "user-agent": "Blockwise Ad Radar directory verification" }
                });
                if (response.status >= 300 && response.status < 400) {
                    const location = response.headers?.get?.("location");
                    if (!location)
                        throw new Error("Directory redirect missing location");
                    current = new URL(location, safe).toString();
                    continue;
                }
                if (!response.ok)
                    throw new Error(`Directory HTTP ${response.status}`);
                return await readBoundedBody(response);
            }
            throw new Error("Directory redirect limit reached");
        }
        catch (error) {
            last = error;
        }
        finally {
            clearTimeout(timer);
        }
    }
    throw last;
}
const recentFetches = new Map();
function boundedFetch(fetchImpl, url, options) {
    const existing = recentFetches.get(url);
    if (existing?.fetchImpl === fetchImpl)
        return existing.promise;
    const promise = boundedDirectoryFetch(fetchImpl, url, options);
    const entry = { promise, fetchImpl };
    recentFetches.set(url, entry);
    if (recentFetches.size > 32)
        recentFetches.delete(recentFetches.keys().next().value);
    const remove = () => { if (recentFetches.get(url) === entry)
        recentFetches.delete(url); };
    promise.then(() => setTimeout(remove, 60000).unref(), remove);
    return promise;
}
async function persistSourceDocument(rest, source, url, body, metadata) {
    const contentHash = hash(body);
    const query = `source_documents?select=id&source=eq.${enc(source)}&content_hash=eq.${enc(contentHash)}&limit=1`;
    const existing = await rest("research", query);
    if (existing?.[0]?.id)
        return existing[0].id;
    try {
        const created = await rest("research", "source_documents", { method: "POST",
            headers: { Prefer: "return=representation" }, body: JSON.stringify({
                source, source_url: url, content_hash: contentHash, mime_type: "text/html",
                byte_size: Buffer.byteLength(body), metadata
            }) });
        if (!created?.[0]?.id)
            throw new Error("Directory source insert returned no ID");
        return created[0].id;
    }
    catch (error) {
        if (!/23505|409|duplicate key/iu.test(error.message))
            throw error;
        const raced = await rest("research", query);
        if (!raced?.[0]?.id)
            throw error;
        return raced[0].id;
    }
}
export async function handleAdRadarEntityDiscovery(job, { rest, fetchImpl = globalThis.fetch, now = () => new Date().toISOString(), rawEvidenceDir = process.env.RAW_EVIDENCE_DIR || "/tmp" } = {}) {
    if (!job?.id || typeof rest !== "function" || typeof fetchImpl !== "function")
        throw new Error("job, rest and fetchImpl are required");
    const payload = job.payload || {};
    const kind = s(payload.entity_kind).toLowerCase();
    const item = entity({ id: payload.entity_id, name: payload.name, full_name: payload.name, state: payload.state, primary_postcode: payload.primary_postcode, website_url: payload.website_url }, kind);
    if (!["agent", "agency"].includes(kind) || !isEligibleWaEntity(item))
        return { status: "blocked", blocked_reason: "directory_entity_not_eligible_wa", result: { handler: "blockwise-ad-directory-discovery-entity", entity_kind: kind, entity_id: item.id } };
    const sourcePath = `source_documents?select=id,source,source_url,metadata,fetched_at&metadata->>entity_kind=eq.${enc(kind)}&metadata->>entity_id=eq.${enc(item.id)}&order=fetched_at.desc&limit=25`;
    const savedDocs = await rest("research", sourcePath);
    if (!Array.isArray(savedDocs))
        throw new Error("Invalid saved directory evidence");
    const links = extractExactFacebookLinks(explicitLinksForEntity(item, savedDocs));
    const errors = [];
    const website = safePublicHttpsUrl(item.websiteUrl);
    if (!links.length && website) {
        try {
            const cached = await rest("research", `source_documents?select=id,metadata,fetched_at&source=eq.ad_radar_directory_website&source_url=eq.${enc(website)}&fetched_at=gte.${enc(new Date(Date.parse(now()) - 7 * 86400000).toISOString())}&order=fetched_at.desc&limit=1`);
            let evidence = cached?.[0];
            if (!evidence) {
                const body = await boundedFetch(fetchImpl, website);
                const references = extractFacebookLinksFromHtml(website, body);
                const metadata = { coverage_version: DIRECTORY_COVERAGE_VERSION,
                    official_facebook_links: references.map((link) => link.url), facebook_owners: facebookOwnersFromHtml(body), fetched_at: now() };
                const id = await persistSourceDocument(rest, "ad_radar_directory_website", website, body, metadata);
                evidence = { id, metadata };
                // Keep raw evidence for later parsers instead of paying/fetching again.
                await writeAtomicJson(join(rawEvidenceDir, "directory-sources", hash(website) + ".json"), { url: website, body, source_document_id: id, fetched_at: now() });
            }
            links.push(...linksForWebsiteEvidence(item, website, evidence));
        }
        catch (error) {
            errors.push({ reason: "official_website_fetch_failed", error: error.message });
        }
    }
    else if (item.websiteUrl && !website)
        errors.push({ reason: "unsafe_official_website_url" });
    for (const link of links.filter((candidate) => !candidate.pageId).slice(0, 3)) {
        try {
            const body = await boundedFetch(fetchImpl, link.url, { retries: 0 });
            const pageId = facebookPageIdFromHtml(body, link.vanity);
            if (pageId) {
                link.pageId = pageId;
                link.url = facebookPageReference(pageId).url;
            }
        }
        catch (error) {
            errors.push({ url: link.url, reason: "facebook_page_id_fetch_failed", error: error?.message || String(error) });
        }
    }
    const plan = buildDirectoryCoveragePlan({ entities: [item], sourceLinks: links, generatedAt: now() });
    const registrations = [];
    for (const candidate of (plan.rows[0]?.status === "candidate" ? plan.rows[0].candidates : []))
        registrations.push(await registerDirectoryCandidate(rest, item, candidate, now()));
    const suffix = hash(`${payload.build_run_id || job.id}:${item.key}`).slice(0, 16);
    const manifestPath = join(s(rawEvidenceDir) || "/tmp", `ad-radar-directory-entity-${suffix}.json`);
    await writeCoverageManifest(manifestPath, { version: DIRECTORY_COVERAGE_VERSION, generatedAt: now(), entity: item, plan, registrations, errors });
    return { status: "complete", result: { handler: "blockwise-ad-directory-discovery-entity", entity_kind: kind, entity_id: item.id, candidates: plan.rows[0]?.candidates?.length || 0, registered_pages: registrations.filter((row) => row.registered).length, status: plan.rows[0]?.status || "unmapped", errors, manifest_path: manifestPath, unresolved_is_not_zero: true } };
}
async function registerDirectoryCandidate(rest, item, candidate, observedAt) {
    const query = `advertiser_pages?select=id,page_id,agent_id,agency_id,status,scan_enabled&platform=eq.facebook&page_id=eq.${enc(candidate.pageId)}&limit=1`;
    const current = (await rest("research", query))?.[0];
    if (current) {
        const owned = item.kind === "agent" ? current.agent_id === item.id : current.agency_id === item.id;
        // Never replace existing ownership, quiet scheduling, disabled status or metadata.
        return { registered: false, existing: true, advertiserPageId: current.id, pageId: candidate.pageId,
            reason: owned ? "existing_exact_page" : "existing_page_requires_owner_review" };
    }
    try {
        const created = await rest("research", "advertiser_pages", { method: "POST",
            headers: { Prefer: "return=representation" }, body: JSON.stringify({
                platform: "facebook", page_id: candidate.pageId, page_name: item.name, page_url: candidate.url,
                owner_type: item.kind, agent_id: item.kind === "agent" ? item.id : null,
                agency_id: item.kind === "agency" ? item.id : null, status: "resolved_collectable",
                scan_enabled: true, confidence: 80, last_seen_at: observedAt,
                metadata: { resolver: DIRECTORY_COVERAGE_VERSION, source_type: candidate.sourceType,
                    source_document_id: candidate.sourceDocumentId, observed_at: observedAt }
            }) });
        if (!created?.[0]?.id) throw new Error("Directory page insert returned no ID");
        return { registered: true, pageId: candidate.pageId, advertiserPageId: created[0].id };
    }
    catch (error) {
        if (!/23505|409|duplicate key/iu.test(error.message))
            throw error;
        const raced = (await rest("research", query))?.[0];
        if (!raced)
            throw error;
        return { registered: false, existing: true, pageId: candidate.pageId, advertiserPageId: raced.id,
            reason: "concurrent_page_registration" };
    }
}
