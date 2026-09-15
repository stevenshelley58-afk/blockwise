#!/usr/bin/env node
/**
 * discovery-agency-pass.mjs — one resumable discovery pass over unreviewed agencies.
 *
 * Same free channels and the same safety rules as the agent pass (fresh datr per
 * embed, control slug inside the window, no negative off a degraded reply), but the
 * search is agency-shaped: a real-estate agency's Facebook page is usually its own
 * name, and the page is registered as an AGENCY-owned advertiser page.
 *
 * Outcomes written to agent_decisions (subject_type='agency'):
 *   - agency page proved + real-estate token -> advertiser_pages row (owner_type=agency,
 *     scan_enabled) + decision resolved
 *   - proved page rejected by the jurisdiction guard -> not_found with the URL kept
 *   - searched, nothing usable -> not_found with candidate slugs as evidence
 *
 * Usage:
 *   node scripts/research/discovery-agency-pass.mjs --dry-run [--limit=25]
 *   node scripts/research/discovery-agency-pass.mjs --apply [--limit=200] [--shard=1] [--shards=8] [--pace=4000]
 */
import { readFileSync, appendFileSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--([a-z-]+)(?:=(.*))?$/iu.exec(arg);
  return match ? [match[1], match[2] === undefined ? true : match[2]] : [arg, true];
}));
function envFile(path) {
  const values = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/gu, "");
  }
  return values;
}
const env = envFile("/srv/hermes/secrets/ad-db-worker.env");
const BASE = env.HERMES_SUPABASE_URL;
const KEY = env.HERMES_SUPABASE_SECRET_KEY || env.HERMES_SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Accept-Profile": "research", "Content-Type": "application/json" };
const LOG = "/root/work/frank/.adr/discovery-agency-pass.log";

async function rest(path, init = {}) {
  const response = await fetch(`${BASE}/rest/v1/${path}`, { method: init.method ?? "GET", headers: { ...H, ...(init.headers || {}) }, body: init.body });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path} -> ${response.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const readAll = async (path, size = 500) => {
  const rows = [];
  for (let offset = 0; ; offset += size) {
    const batch = await rest(`${path}&limit=${size}&offset=${offset}`);
    rows.push(...batch);
    if (batch.length < size) return rows;
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const datr = () => Array.from({ length: 24 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)]).join("");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const CONTROL = { slug: "BastonAndCoProperty", id: "1414666615513753" };
const NOISE = new Set(["pages", "groups", "profile.php", "people", "watch", "reel", "story", "events", "ads", "sharer", "login", "help", "privacy", "policies", "business", "marketplace", "gaming", "photo", "video", "hashtag", "search", "settings", "messages", "notifications", "permalink.php", "plugins", "dialog", "sharer.php", "l.php", "tr", "p", "v"]);

async function embed(slug) {
  const params = new URLSearchParams({ href: `https://www.facebook.com/${slug}`, tabs: "timeline", width: "340", height: "130", locale: "en_US" });
  const response = await fetch(`https://www.facebook.com/plugins/page.php?${params.toString()}`, {
    headers: { Cookie: `datr=${datr()}`, "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  const html = await response.text();
  const id = /facebook\.com\/(\d{10,})\?ref=embed_page/u.exec(html)?.[1] ?? null;
  const rawTitle = /class="_1drp _5lv6" title="([^"]*)"/u.exec(html)?.[1] ?? null;
  const title = rawTitle ? rawTitle.replace(/&amp;/gu, "&").replace(/&#039;/gu, "'").replace(/&quot;/gu, '"') : null;
  return { status: response.status, bytes: html.length, id, title };
}
async function searchCandidates(name, suburb) {
  const query = `"${name}" ${suburb || "Perth"} real estate facebook`;
  const response = await fetch(`https://search.lumy.live/search?q=${encodeURIComponent(query)}&engines=google`, { headers: { "User-Agent": UA } });
  const html = await response.text();
  const found = [...html.matchAll(/facebook\.com\/([A-Za-z0-9._-]{3,60})/gu)].map((match) => match[1]);
  return { status: response.status, bytes: html.length, slugs: [...new Set(found.filter((slug) => !NOISE.has(slug.toLowerCase()) && !/^\d+$/u.test(slug)))] };
}
const normalise = (value) => String(value || "").toLowerCase().replace(/[^a-z]/gu, "");
const TOKEN_STOP = new Set(["pty", "ltd", "limited", "group", "real", "estate", "property", "properties", "the", "and", "co", "inc", "au", "australia", "wa", "west", "australian", "licence", "license"]);
function tokenSet(value) {
  return new Set(String(value || "").toLowerCase().split(/[^a-z0-9]+/u).filter((token) => token.length > 2 && !TOKEN_STOP.has(token)));
}
// An agency page is proved by the agency's distinctive tokens appearing in the page
// title (e.g. "Bunbury LJ Hooker" for "LJ Hooker Property South West"), by an exact
// normalized containment, or by a matching brand/slug token.
function agencyTitleMatch(title, agency) {
  if (!title) return false;
  const a = normalise(title);
  const candidates = [agency.name, agency.trading_name, agency.brand].filter(Boolean);
  for (const candidate of candidates) {
    const n = normalise(candidate);
    if (n && (a.includes(n) || n.includes(a))) return true;
    const tokens = tokenSet(candidate);
    if (!tokens.size) continue;
    const hits = [...tokens].filter((token) => a.includes(token)).length;
    if (hits >= Math.min(2, tokens.size)) return true;
  }
  return false;
}
const realEstateSignal = (value) => /real estate|realty|property|propert|lj hooker|ray white|harcourts|re\/max|remax|elders|professionals|acton|belle|century 21|first national|reiwa|realmark|peard|sell|homes|estate agent/i.test(String(value || ""));
const FOREIGN = /\b(vancouver|toronto|calgary|edmonton|ottawa|montreal|canada|united states|usa|u\.?s\.?a?\b|california|texas|florida|michigan|arizona|nevada|new york|north carolina|boise|idaho|united kingdom|\buk\b|england|london|scotland|ireland|dubai|uae|new zealand|auckland|wellington|christchurch|singapore|malaysia|philippines|india|south africa)\b/iu;
const AUSTRALIAN = /\b(australia|australian|western australia|perth|fremantle|mandurah|bunbury|geraldton|albany|broome|karratha|port hedland|kalgoorlie|joondalup|rockingham|armadale|midland|swan valley|reiwa|wa)\b/iu;
const foreignLocation = (value) => FOREIGN.test(String(value || ""));

const limit = Number(args.limit || 100);
const paceMs = Number(args.pace || 4000);
const dryRun = args["dry-run"] === true || args.apply !== true;
const shard = Math.max(1, Number(args.shard || 1));
const shardCount = Math.max(1, Number(args.shards || 1));

const [pagesByAgency, decided, agencies] = await Promise.all([
  readAll("advertiser_pages?select=agency_id&agency_id=not.is.null"),
  readAll("agent_decisions?select=subject_id&decision_type=eq.page_resolution&subject_type=eq.agency"),
  readAll("agencies?select=id,name,trading_name,brand,state,primary_suburb,primary_postcode,website_url,status,is_real_estate&state=eq.WA&order=name"),
]);
const seen = new Set([...pagesByAgency.map((row) => row.agency_id), ...decided.map((row) => String(row.subject_id))]);
const unreviewed = agencies
  .filter((row) => !seen.has(row.id))
  .filter((row) => row.is_real_estate !== false)
  .filter((row) => /^[A-Za-z]/u.test(String(row.name || "").trim()));
const groups = [];
const groupIndex = new Map();
for (const row of unreviewed) {
  const key = String(row.name || "").trim().toLowerCase();
  if (!groupIndex.has(key)) { groupIndex.set(key, groups.length); groups.push({ name: row.name, rows: [] }); }
  groups[groupIndex.get(key)].rows.push(row);
}
const queue = groups.filter((group, index) => index % shardCount === (shard - 1));

console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "apply", shard, shardCount, agenciesWa: agencies.length, alreadyReviewed: seen.size, queue: queue.length, planned: Math.min(limit, queue.length), paceMs }, null, 1));
if (dryRun) { console.log(JSON.stringify(queue.slice(0, 5).map((group) => ({ name: group.name, suburb: group.rows[0].primary_suburb, website: group.rows[0].website_url })), null, 1)); process.exit(0); }

const startedAt = Date.now();
let registered = 0, notFound = 0, retry = 0, searched = 0, rowsDecided = 0;
for (const [index, group] of queue.slice(0, limit).entries()) {
  const agency = group.rows[0];
  if (index % 25 === 0) {
    const control = await embed(CONTROL.slug);
    if (control.id !== CONTROL.id) {
      appendFileSync(LOG, `${new Date().toISOString()} CONTROL FAILED (${control.status}, ${control.bytes}b) — stopping run\n`);
      console.log(JSON.stringify({ stopped: "control_failed", control, searched, registered, notFound, retry }, null, 1));
      process.exit(3);
    }
  }
  let search;
  try { search = await searchCandidates(agency.name, agency.primary_suburb); }
  catch (error) { retry += 1; appendFileSync(LOG, `${new Date().toISOString()} SEARCH-ERROR ${agency.name}: ${String(error?.message || error).slice(0, 80)}\n`); await sleep(paceMs * 2); continue; }
  await sleep(paceMs);
  searched += 1;

  let hit = null;
  const foreignRejected = [];
  for (const slug of search.slugs.slice(0, 6)) {
    let proof;
    try { proof = await embed(slug); } catch { continue; }
    await sleep(2500);
    if (!proof.id) continue;
    const titleMatch = agencyTitleMatch(proof.title, agency);
    if (foreignLocation(proof.title) && !AUSTRALIAN.test(proof.title)) {
      if (titleMatch) foreignRejected.push({ slug, page_id: proof.id, title: proof.title });
      continue;
    }
    if (titleMatch && (realEstateSignal(proof.title) || realEstateSignal(slug))) { hit = { slug, proof }; break; }
  }

  const evidence = {
    mechanism: "agency public discovery (Lumy Google proxy + page-plugin embed)",
    searched_at: new Date().toISOString(),
    search_status: search.status,
    search_bytes: search.bytes,
    query_suburb: agency.primary_suburb ?? null,
    candidate_slugs: search.slugs.slice(0, 10),
    foreign_name_match_rejected: foreignRejected,
    embed: hit ? { slug: hit.slug, page_id: hit.proof.id, title: hit.proof.title, bytes: hit.proof.bytes } : null,
    roster_website: agency.website_url ?? null,
  };
  const decideAll = async (body) => {
    for (const row of group.rows) {
      await rest("agent_decisions", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ ...body, subject_id: row.id, decision: { ...body.decision, roster_rows_in_group: group.rows.length } }),
      });
      rowsDecided += 1;
    }
  };
  try {
    if (hit) {
      const rows = await rest("advertiser_pages?on_conflict=platform,page_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          platform: "facebook", page_id: hit.proof.id, page_name: hit.proof.title, page_url: `https://www.facebook.com/${hit.slug}`,
          agent_id: null, agency_id: agency.id, status: "resolved_collectable", scan_enabled: true,
          scan_state: "needs_first_fill", confidence: 75, owner_type: "agency", resolved_at: new Date().toISOString(),
          metadata: { source: "discovery-agency-pass", page_slug: hit.slug, page_kind: "agency_page", embed_title: hit.proof.title, roster_website: agency.website_url ?? null },
        }),
      });
      await decideAll({
        decision_type: "page_resolution", subject_type: "agency", decided_at: new Date().toISOString(),
        decision: { resolved: true, collectable: true, page_id: hit.proof.id, page_url: `https://www.facebook.com/${hit.slug}`, advertiser_page_id: rows?.[0]?.id ?? null, page_kind: "agency_page", owner_type: "agency" },
        rationale: "Discovered the agency's Facebook page from its own name via public search; the plugin embed returned a numeric page id and a title matching the agency or brand. Registered as an agency-owned advertiser page.",
        confidence: 75, evidence, hermes_skill: "ad-radar-discovery-agency-pass",
      });
      registered += 1;
      appendFileSync(LOG, `${new Date().toISOString()} REGISTERED ${agency.name} -> ${hit.proof.id} "${hit.proof.title}"\n`);
    } else {
      await decideAll({
        decision_type: "page_resolution", subject_type: "agency", decided_at: new Date().toISOString(),
        decision: { resolved: false, collectable: false, page_id: null, page_url: null },
        rationale: foreignRejected.length
          ? "Searched public web results; the only title-matching pages belong to foreign jurisdictions (recorded in evidence), so no page was linked."
          : "Searched public web results for the agency name and suburb; no candidate Facebook slug produced a matching agency page.",
        confidence: 40, evidence, hermes_skill: "ad-radar-discovery-agency-pass",
      });
      notFound += 1;
    }
  } catch (error) {
    retry += 1;
    appendFileSync(LOG, `${new Date().toISOString()} WRITE-ERROR ${agency.name}: ${String(error?.message || error).slice(0, 120)}\n`);
  }
}
console.log(JSON.stringify({ searched, registered, notFound, retry, rosterRowsDecided: rowsDecided, seconds: Math.round((Date.now() - startedAt) / 1000) }, null, 1));
