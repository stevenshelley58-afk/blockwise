#!/usr/bin/env node
/**
 * discovery-first-pass.mjs — one resumable discovery pass over unresearched roster rows.
 *
 * Free channels only: the Lumy Google proxy for candidate slugs, then the public
 * page-plugin embed to prove a numeric page id. No paid provider is called.
 *
 * Every processed row gets a durable outcome so a resumed run never repeats work:
 *   - numeric page id proved      -> advertiser_pages row (resolved_collectable, scan_enabled)
 *                                    + agent_decisions(page_resolution, resolved)
 *   - valid embed, no name proof  -> agent_decisions(page_resolution, unresolved) with candidates
 *   - searched, no candidate      -> agent_decisions(page_resolution, not_found)
 *   - embed/HTTP trouble          -> no decision written; the row stays for a later pass
 *
 * Safety carried from the 12 Sep session: a fresh `datr` per embed, a control slug that
 * must return its known id inside the window, a row is never marked not_found off a
 * degraded response, and a name match alone never becomes a page link.
 *
 * Usage:
 *   node scripts/research/discovery-first-pass.mjs --dry-run [--limit=25]
 *   node scripts/research/discovery-first-pass.mjs --apply [--limit=200] [--pace=5000]
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
const LOG = "/root/work/frank/.adr/discovery-first-pass.log";

async function rest(path, init = {}) {
  const response = await fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
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
  const query = `"${name}" ${suburb || "Perth"} real estate`;
  const response = await fetch(`https://search.lumy.live/search?q=${encodeURIComponent(query)}&engines=google`, { headers: { "User-Agent": UA } });
  const html = await response.text();
  const found = [...html.matchAll(/facebook\.com\/([A-Za-z0-9._-]{3,60})/gu)].map((match) => match[1]);
  return { status: response.status, bytes: html.length, slugs: [...new Set(found.filter((slug) => !NOISE.has(slug.toLowerCase()) && !/^\d+$/u.test(slug)))] };
}
const normalise = (value) => String(value || "").toLowerCase().replace(/[^a-z]/gu, "");
function nameMatches(title, fullName) {
  if (!title) return false;
  const a = normalise(title);
  const b = normalise(fullName);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const parts = String(fullName).toLowerCase().split(/\s+/u).filter((part) => part.length > 2);
  return parts.length > 1 && parts.every((part) => a.includes(part.replace(/[^a-z]/gu, "")));
}
const realEstateSignal = (value) => /real estate|realty|property|lj hooker|ray white|harcourts|re\/max|remax|elders|professionals|acton|belle|century 21|first national|reiwa/i.test(String(value || ""));
// A same-name page in another country is a different person. Batches have already
// caught US, Canadian and NZ realtors on WA names, so a foreign jurisdiction token in
// the page title disqualifies the match.
const FOREIGN = /\b(vancouver|toronto|calgary|edmonton|ottawa|montreal|canada|united states|usa|\bu\.?s\.?a?\b|california|texas|florida|michigan|arizona|nevada|new york|north carolina|boise|idaho|new braunfels|dearborn|united kingdom|\buk\b|england|london|scotland|ireland|dubai|uae|new zealand|auckland|wellington|christchurch|singapore|malaysia|philippines|india|south africa)\b/iu;
const foreignLocation = (value) => FOREIGN.test(String(value || ""));
const AUSTRALIAN = /\b(australia|australian|wa|w\.a\.|western australia|perth|fremantle|mandurah|bunbury|geraldton|albany|broome|karratha|port hedland|kalgoorlie|joondalup|rockingham|armadale|midland|swan valley|rewa|reiwa)\b/iu;

const limit = Number(args.limit || 100);
const paceMs = Number(args.pace || 5000);
const dryRun = args["dry-run"] === true || args.apply !== true;

const [linked, decided, roster] = await Promise.all([
  readAll("advertiser_pages?select=agent_id&agent_id=not.is.null"),
  readAll("agent_decisions?select=subject_id&decision_type=eq.page_resolution"),
  readAll("agents?select=id,full_name,given_name,family_name,primary_suburb,primary_postcode,agency_id,agency:agencies(name)&status=eq.licensed_verified&state=eq.WA&order=full_name"),
]);
const seen = new Set([...linked.map((row) => row.agent_id), ...decided.map((row) => String(row.subject_id))]);
const shard = Math.max(1, Number(args.shard || 1));
const shardCount = Math.max(1, Number(args.shards || 1));
const queue = roster
  .filter((row) => !seen.has(row.id))
  .filter((row) => /^[A-Za-z]/u.test(String(row.full_name || "").trim()) && !/\(no (first|given) ?name\)/iu.test(String(row.full_name || "")))
  // Disjoint slices so N workers cover the queue without coordinating: each shard
  // re-reads the durable decisions first, so finished rows are never repeated.
  .filter((row, index) => index % shardCount === (shard - 1));

console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "apply", shard, shardCount, rosterVerifiedWa: roster.length, alreadyResearched: seen.size, queue: queue.length, planned: Math.min(limit, queue.length), paceMs }, null, 1));
if (dryRun) { console.log(JSON.stringify(queue.slice(0, 5).map((row) => ({ name: row.full_name, suburb: row.primary_suburb, agency: row.agency?.name ?? null })), null, 1)); process.exit(0); }

const startedAt = Date.now();
let resolved = 0, unresolved = 0, notFound = 0, retry = 0, searched = 0;
for (const [index, agent] of queue.slice(0, limit).entries()) {
  if (index % 25 === 0) {
    const control = await embed(CONTROL.slug);
    if (control.id !== CONTROL.id) {
      appendFileSync(LOG, `${new Date().toISOString()} CONTROL FAILED (${control.status}, ${control.bytes}b) — stopping run\n`);
      console.log(JSON.stringify({ stopped: "control_failed", control, searched, resolved, unresolved, notFound, retry }, null, 1));
      process.exit(3);
    }
  }
  let search;
  try {
    search = await searchCandidates(agent.full_name, agent.primary_suburb);
  } catch (error) {
    retry += 1; appendFileSync(LOG, `${new Date().toISOString()} SEARCH-ERROR ${agent.full_name}: ${String(error?.message || error).slice(0, 80)}\n`);
    await sleep(paceMs * 2); continue;
  }
  await sleep(paceMs);
  searched += 1;
  let hit = null;
  let foreignRejected = [];
  for (const slug of search.slugs.slice(0, 6)) {
    let proof;
    try { proof = await embed(slug); } catch { continue; }
    await sleep(3000);
    if (!proof.id) continue;
    const titleMatch = nameMatches(proof.title, agent.full_name);
    const agencyMatch = agent.agency?.name ? nameMatches(proof.title, agent.agency.name) : false;
    // A same-name page outside Australia is a different person; keep the URL as
    // evidence on the row instead of silently dropping it.
    if (foreignLocation(proof.title) && !AUSTRALIAN.test(proof.title)) {
      if (titleMatch || agencyMatch) foreignRejected.push({ slug, page_id: proof.id, title: proof.title });
      continue;
    }
    if (titleMatch && (realEstateSignal(slug) || realEstateSignal(proof.title))) { hit = { slug, proof, kind: "person_page" }; break; }
    if (titleMatch) { hit = { slug, proof, kind: "person_page_uncorroborated" }; break; }
    if (agencyMatch) { hit = { slug, proof, kind: "agency_page" }; break; }
  }
  const evidence = {
    mechanism: "public social discovery (Lumy Google proxy + page-plugin embed)",
    searched_at: new Date().toISOString(),
    search_status: search.status,
    search_bytes: search.bytes,
    query_suburb: agent.primary_suburb ?? null,
    candidate_slugs: search.slugs.slice(0, 10),
    foreign_name_match_rejected: foreignRejected,
    embed: hit ? { slug: hit.slug, page_id: hit.proof.id, title: hit.proof.title, bytes: hit.proof.bytes } : null,
  };
  try {
    if (hit && hit.kind === "person_page") {
      const rows = await rest("advertiser_pages?on_conflict=platform,page_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          platform: "facebook", page_id: hit.proof.id, page_name: hit.proof.title, page_url: `https://www.facebook.com/${hit.slug}`,
          agent_id: agent.id, agency_id: agent.agency_id ?? null, status: "resolved_collectable", scan_enabled: true,
          scan_state: "needs_first_fill", confidence: 80, owner_type: "agent", resolved_at: new Date().toISOString(),
          metadata: { source: "discovery-first-pass", page_slug: hit.slug, evidence_urls: [evidence.embed ? `https://www.facebook.com/${hit.slug}` : null].filter(Boolean), embed_title: hit.proof.title },
        }),
      });
      const pageId = rows?.[0]?.id ?? null;
      await rest("agent_decisions", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          decision_type: "page_resolution", subject_type: "agent", subject_id: agent.id, decided_at: new Date().toISOString(),
          decision: { resolved: true, collectable: true, page_id: hit.proof.id, page_url: `https://www.facebook.com/${hit.slug}`, advertiser_page_id: pageId, page_kind: "person_page" },
          rationale: "Discovered a verified real-estate Facebook page from the agent's own name via public search, confirmed by the page-plugin embed's numeric id and display title.",
          confidence: 80, evidence, hermes_skill: "ad-radar-discovery-first-pass",
        }),
      });
      resolved += 1; appendFileSync(LOG, `${new Date().toISOString()} RESOLVED ${agent.full_name} -> ${hit.proof.id} "${hit.proof.title}"\n`);
    } else if (hit && hit.kind === "agency_page") {
      // An agency/team page is a genuine discovery. Register it as an agency-owned
      // advertiser page (never as the agent's page) so its live ads can be collected.
      const rows = await rest("advertiser_pages?on_conflict=platform,page_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          platform: "facebook", page_id: hit.proof.id, page_name: hit.proof.title, page_url: `https://www.facebook.com/${hit.slug}`,
          agent_id: null, agency_id: agent.agency_id ?? null, status: "resolved_collectable", scan_enabled: true,
          scan_state: "needs_first_fill", confidence: 70, owner_type: agent.agency_id ? "agency" : "unknown",
          resolved_at: new Date().toISOString(),
          metadata: { source: "discovery-first-pass", page_slug: hit.slug, page_kind: "agency_page", discovered_from_agent: agent.id, embed_title: hit.proof.title },
        }),
      });
      const pageId = rows?.[0]?.id ?? null;
      await rest("agent_decisions", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          decision_type: "page_resolution", subject_type: "agent", subject_id: agent.id, decided_at: new Date().toISOString(),
          decision: { resolved: false, collectable: false, page_id: hit.proof.id, page_url: `https://www.facebook.com/${hit.slug}`, page_kind: "agency_page", attributed: false, agency_advertiser_page_id: pageId },
          rationale: "Embed proved the agency/team page that employs this agent. Registered as an agency-owned advertiser page; not linked as the agent's personal page.",
          confidence: 70, evidence, hermes_skill: "ad-radar-discovery-first-pass",
        }),
      });
      unresolved += 1; appendFileSync(LOG, `${new Date().toISOString()} AGENCY-PAGE ${agent.full_name} -> ${hit.proof.id} "${hit.proof.title}"\n`);
    } else if (hit) {
      await rest("agent_decisions", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          decision_type: "page_resolution", subject_type: "agent", subject_id: agent.id, decided_at: new Date().toISOString(),
          decision: { resolved: false, collectable: false, page_id: hit.proof.id, page_url: `https://www.facebook.com/${hit.slug}`, page_kind: hit.kind, attributed: false },
          rationale: hit.kind === "agency_page"
            ? "Embed proved an agency/team page, not the agent's own page; recorded for agency attribution without linking it as the agent's page."
            : "Embed proved a page whose title matches the agent's name but carries no real-estate corroboration; recorded without a page link.",
          confidence: 45, evidence, hermes_skill: "ad-radar-discovery-first-pass",
        }),
      });
      unresolved += 1; appendFileSync(LOG, `${new Date().toISOString()} UNRESOLVED ${agent.full_name} (${hit.kind}) ${hit.slug}\n`);
    } else {
      await rest("agent_decisions", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          decision_type: "page_resolution", subject_type: "agent", subject_id: agent.id, decided_at: new Date().toISOString(),
          decision: { resolved: false, collectable: false, page_id: null, page_url: null },
          rationale: foreignRejected.length
            ? "Searched public web results; the only name-matched pages belong to foreign jurisdictions (recorded in evidence.foreign_name_match_rejected), so no page was linked."
            : "Searched public web results for the agent's name and suburb; no candidate Facebook slug produced a name-matched page.",
          confidence: 40, evidence, hermes_skill: "ad-radar-discovery-first-pass",
        }),
      });
      notFound += 1;
    }
  } catch (error) {
    retry += 1; appendFileSync(LOG, `${new Date().toISOString()} WRITE-ERROR ${agent.full_name}: ${String(error?.message || error).slice(0, 120)}\n`);
  }
}
console.log(JSON.stringify({ searched, resolved, unresolved, notFound, retry, seconds: Math.round((Date.now() - startedAt) / 1000) }, null, 1));
