#!/usr/bin/env node
/**
 * resolve-slug-pages.mjs — resolve paused slug-only advertiser pages to numeric Meta
 * page ids using the public page-plugin embed (free, no paid provider).
 *
 * The 444 paused rows have a verified page URL/slug but `page_id IS NULL`, so the
 * first-fill scheduler cannot dispatch them. The embed returns the canonical numeric
 * id in `href="https://www.facebook.com/<ID>?ref=embed_page"`; a valid id also gives
 * the page's display title for identity corroboration.
 *
 * Safety rules carried over from the 12 Sep session:
 *   - fresh random `datr` cookie on every request (a reused one silently degrades);
 *   - a control slug must return its known id inside the same window, or the run stops;
 *   - a 0-byte body or a non-200 is never evidence of absence, only a retry;
 *   - an already-numeric page id is never overwritten.
 *
 * Usage:
 *   node scripts/research/resolve-slug-pages.mjs --dry-run [--limit=20]
 *   node scripts/research/resolve-slug-pages.mjs --apply   [--limit=100] [--pace=4000]
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
const PACED_LOG = "/root/work/frank/.adr/slug-resolve.log";

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

async function embed(href) {
  const params = new URLSearchParams({ href, tabs: "timeline", width: "340", height: "130", locale: "en_US" });
  const url = `https://www.facebook.com/plugins/page.php?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Cookie: `datr=${datr()}`,
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  const html = await response.text();
  const id = /facebook\.com\/(\d{10,})\?ref=embed_page/u.exec(html)?.[1] ?? null;
  const title = /class="_1drp _5lv6" title="([^"]*)"/u.exec(html)?.[1] ?? null;
  return { status: response.status, bytes: html.length, id, title: title ? title.replace(/&amp;/gu, "&").replace(/&#039;/gu, "'").replace(/&quot;/gu, '"') : null };
}

const CONTROL = { slug: "BastonAndCoProperty", id: "1414666615513753" };
const limit = Number(args.limit || 50);
const paceMs = Number(args.pace || 4000);
const dryRun = args["dry-run"] === true || args.apply !== true;

const pages = await readAll(
  "advertiser_pages?select=id,page_name,page_url,page_id,status,scan_enabled,scan_state,owner_type,agent_id,agency_id,metadata&page_id=is.null&order=page_name.asc",
);
const targets = pages.filter((page) => {
  // Resolved-but-duplicate rows keep a null page id on purpose; only unresolved rows
  // are candidates. This keeps re-runs idempotent.
  if (page.status === "stale_needs_review") return false;
  const slug = page.metadata?.page_slug || (page.page_url || "").split("/").filter(Boolean).pop();
  return slug && !/^\d+$/u.test(slug);
}).slice(0, limit);

console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "apply", candidates: pages.length, planned: targets.length, paceMs }, null, 1));
if (!targets.length) process.exit(0);
if (dryRun) {
  console.log(JSON.stringify(targets.slice(0, 5).map((page) => ({ name: page.page_name, slug: page.metadata?.page_slug ?? null, status: page.status })), null, 1));
  process.exit(0);
}

let resolved = 0;
let ambiguous = 0;
let failed = 0;
const startedAt = Date.now();
for (const [index, page] of targets.entries()) {
  const slug = page.metadata?.page_slug || (page.page_url || "").split("/").filter(Boolean).pop();
  if (index % 25 === 0) {
    const control = await embed(`https://www.facebook.com/${CONTROL.slug}`);
    if (control.id !== CONTROL.id) {
      appendFileSync(PACED_LOG, `${new Date().toISOString()} CONTROL FAILED (${control.status}, ${control.bytes}b) — stopping run\n`);
      console.log(JSON.stringify({ stopped: "control_failed", control, resolved, ambiguous, failed }, null, 1));
      process.exit(3);
    }
    appendFileSync(PACED_LOG, `${new Date().toISOString()} control ok (${control.bytes}b)\n`);
  }
  let result;
  try {
    result = await embed(`https://www.facebook.com/${slug}`);
  } catch (error) {
    failed += 1;
    appendFileSync(PACED_LOG, `${new Date().toISOString()} ERROR ${slug} ${String(error?.message || error).slice(0, 80)}\n`);
    await sleep(paceMs * 2);
    continue;
  }
  if (result.id) {
    // The numeric page may already be registered by another row (the slug-only row is a
    // duplicate candidate). Never violate the (platform, page_id) unique key: record the
    // duplicate and leave the existing resolved row authoritative.
    const existing = await rest(`advertiser_pages?select=id,status,scan_enabled&page_id=eq.${result.id}&limit=1`);
    if (existing?.[0]?.id && existing[0].id !== page.id) {
      await rest(`advertiser_pages?id=eq.${page.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "stale_needs_review",
          scan_enabled: false,
          metadata: { ...(page.metadata || {}), page_slug: slug, duplicate_of: existing[0].id, slug_resolved_at: new Date().toISOString(), slug_embed_title: result.title },
        }),
      });
      resolved += 1;
      appendFileSync(PACED_LOG, `${new Date().toISOString()} DUPLICATE ${slug} -> ${result.id} already registered by ${existing[0].id}\n`);
      await sleep(paceMs);
      continue;
    }
    await rest(`advertiser_pages?id=eq.${page.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        page_id: result.id,
        page_url: `https://www.facebook.com/${slug}`,
        status: "resolved_collectable",
        scan_enabled: true,
        scan_state: "needs_first_fill",
        backoff_until: null,
        consecutive_failures: 0,
        metadata: {
          ...(page.metadata || {}),
          page_slug: slug,
          slug_resolved_at: new Date().toISOString(),
          slug_resolved_by: "resolve-slug-pages.mjs",
          slug_embed_title: result.title,
          slug_embed_bytes: result.bytes,
        },
      }),
    });
    resolved += 1;
    appendFileSync(PACED_LOG, `${new Date().toISOString()} RESOLVED ${slug} -> ${result.id} "${result.title}"\n`);
  } else if (result.bytes >= 30000) {
    // A healthy-size reply with no numeric id: the slug exists but is not a Page, or the
    // embed resolved something else. Record as ambiguous; never treat as absence.
    ambiguous += 1;
    appendFileSync(PACED_LOG, `${new Date().toISOString()} NO-ID ${slug} (${result.status}, ${result.bytes}b)\n`);
  } else if (result.bytes >= 15000) {
    // The known ~18 KB degraded shell. Ambiguous by construction (the control itself has
    // returned one), so it is not evidence the slug is absent.
    ambiguous += 1;
    appendFileSync(PACED_LOG, `${new Date().toISOString()} SHELL ${slug} (${result.status}, ${result.bytes}b)\n`);
  } else {
    failed += 1;
    appendFileSync(PACED_LOG, `${new Date().toISOString()} RETRY ${slug} (${result.status}, ${result.bytes}b)\n`);
  }
  await sleep(paceMs);
}
console.log(JSON.stringify({ resolved, ambiguous, failed, seconds: Math.round((Date.now() - startedAt) / 1000) }, null, 1));
