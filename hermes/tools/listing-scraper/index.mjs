/**
 * Blockwise Listing Scraper — VPS endpoint.
 *
 * Runs inside the docker-compose research network. Accepts a listing URL,
 * fetches the page (static first, Obscura stealth browser fallback), extracts
 * structured property data, downloads photos inside the browser context,
 * uploads everything to Supabase storage, and returns the result.
 *
 * Zero paid services. Uses: Obscura (stealth browser), Steel (CDP),
 * RESIDENTIAL_PROXY_URL, Chromium + Playwright-core (already installed).
 *
 * Env:
 *   API_KEY              — shared secret (HERMES_API_SERVER_KEY)
 *   OBSCURA_CDP_URL      — http://blockwise-obscura:9222
 *   STEEL_CDP_URL        — http://blockwise-steel:9223
 *   RESIDENTIAL_PROXY_URL — optional residential proxy
 *   SUPABASE_URL         — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key for storage uploads
 *   PORT                 — listen port (default 8650)
 */

import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT || 8650);
const API_KEY = process.env.API_KEY || "";
const OBSCURA_CDP_URL = process.env.OBSCURA_CDP_URL || "http://blockwise-obscura:9222";
const STEEL_CDP_URL = process.env.STEEL_CDP_URL || "http://blockwise-steel:9223";
const RESIDENTIAL_PROXY_URL = process.env.RESIDENTIAL_PROXY_URL || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = "adstudio-media";

const STATIC_TIMEOUT_MS = 5_000;
const STEALTH_TIMEOUT_MS = 20_000;
const PHOTO_TIMEOUT_MS = 12_000;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_PHOTOS = 5;
const MAX_RETRIES = 2;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "Cache-Control": "max-age=0",
};

// ---------------------------------------------------------------------------
// Supabase client (lazy)
// ---------------------------------------------------------------------------

let supabase = null;
function getSupabase() {
  if (!supabase && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return supabase;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, { ok: true, service: "listing-scraper" });
  }

  // Only accept POST /scrape-listing
  if (req.method !== "POST" || !req.url?.startsWith("/scrape-listing")) {
    return sendJson(res, 404, { ok: false, error: "not_found", message: "Not found." });
  }

  // Auth
  const apiKey = req.headers["x-api-key"];
  if (!API_KEY || apiKey !== API_KEY) {
    return sendJson(res, 401, { ok: false, error: "unauthorized", message: "Invalid API key." });
  }

  // Parse body
  let body;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    return sendJson(res, 400, { ok: false, error: "invalid_url", message: "Invalid JSON body." });
  }

  const { url, workspaceId } = body || {};
  if (!url || typeof url !== "string") {
    return sendJson(res, 400, { ok: false, error: "invalid_url", message: "url is required." });
  }
  if (!workspaceId || typeof workspaceId !== "string") {
    return sendJson(res, 400, { ok: false, error: "invalid_url", message: "workspaceId is required." });
  }

  // Validate URL
  let parsed;
  try {
    parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return sendJson(res, 400, { ok: false, error: "invalid_url", message: "Invalid URL." });
  }

  if (!/\.(com\.au|net\.au|org\.au|au)$/i.test(parsed.hostname)) {
    return sendJson(res, 400, {
      ok: false,
      error: "invalid_url",
      message: "Only Australian property listing URLs (.com.au / .au) are supported.",
    });
  }

  try {
    const result = await scrapeListing(parsed.toString(), workspaceId);
    return sendJson(res, 200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scraping failed.";
    return sendJson(res, 502, { ok: false, error: "blocked", message });
  }
});

server.listen(PORT, () => {
  console.log(`[listing-scraper] listening on :${PORT}`);
});

// ---------------------------------------------------------------------------
// Core scraping logic
// ---------------------------------------------------------------------------

async function scrapeListing(url, workspaceId) {
  let html = null;
  let usedStealth = false;

  // Layer 1: Static fetch (fast path)
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      html = await staticFetch(url);
      if (html && html.length > 5000) break;
      html = null;
    } catch {
      html = null;
    }
    if (attempt < MAX_RETRIES) await sleep(3000 * (attempt + 1));
  }

  // Layer 2: Obscura stealth render (if static failed)
  if (!html) {
    try {
      html = await stealthRender(url);
      usedStealth = true;
    } catch {
      // fall through
    }
  }

  if (!html || html.length < 1000) {
    return {
      ok: false,
      error: "blocked",
      message: "The listing site blocked our request. Try again in a few minutes, or enter details manually.",
    };
  }

  // Extract data
  const listing = extractListingData(html, url);
  if (!listing) {
    return {
      ok: false,
      error: "not_listing",
      message: "That doesn't look like a property listing. Paste the URL of a specific property.",
    };
  }

  // Download photos
  const photoUrls = listing.photos.slice(0, MAX_PHOTOS);
  const downloadedPhotos = await downloadPhotos(photoUrls, url, usedStealth);

  // Upload to Supabase storage
  const slug = buildSlug(listing);
  const folder = `listing-assets/${workspaceId}/${slug}`;
  const uploadedUrls = await uploadAssets(downloadedPhotos, listing, folder);

  return {
    ok: true,
    listing: { ...listing, photos: uploadedUrls },
    brief: buildBrief(listing),
    photos: uploadedUrls,
    folder,
  };
}

// ---------------------------------------------------------------------------
// Static fetch
// ---------------------------------------------------------------------------

async function staticFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATIC_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml/i.test(contentType)) throw new Error("Not HTML");
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Stealth render via Obscura CDP
// ---------------------------------------------------------------------------

async function stealthRender(url) {
  // Try Obscura first (stealth browser), fall back to Steel (plain CDP).
  const { chromium } = await import("playwright-core");

  const cdpUrls = [OBSCURA_CDP_URL, STEEL_CDP_URL].filter(Boolean);
  let lastError = null;

  for (const cdpUrl of cdpUrls) {
    try {
      // Resolve the WebSocket debugger URL manually. Steel returns
      // ws://localhost/... which breaks cross-container; we rewrite the host.
      const wsUrl = await resolveCdpWsUrl(cdpUrl);
      const browser = await chromium.connectOverCDP(wsUrl, {
        timeout: STEALTH_TIMEOUT_MS,
      });

      try {
        const context = await browser.newContext({
          userAgent: BROWSER_HEADERS["User-Agent"],
          locale: "en-AU",
          viewport: { width: 1920, height: 1080 },
          ...(parseProxyConfig(RESIDENTIAL_PROXY_URL) ? { proxy: parseProxyConfig(RESIDENTIAL_PROXY_URL) } : {}),
        });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "networkidle", timeout: STEALTH_TIMEOUT_MS });
        // Wait a bit for any lazy-loaded content
        await page.waitForTimeout(2000);
        const html = await page.content();
        await context.close();
        return html;
      } finally {
        await browser.close().catch(() => {});
      }
    } catch (err) {
      lastError = err;
      console.error(`[listing-scraper] CDP ${cdpUrl} failed: ${err.message}`);
    }
  }

  throw lastError || new Error("No CDP endpoints available");
}

/** Fetch /json/version from a CDP HTTP endpoint and return a usable ws:// URL. */
async function resolveCdpWsUrl(httpUrl) {
  const base = httpUrl.replace(/\/$/, "");
  const parsed = new URL(base);
  // Chrome DevTools rejects Host headers that aren't localhost or an IP.
  // Resolve the docker hostname to its IP so the Host header is an IP address.
  const { lookup } = await import("node:dns/promises");
  let ip = parsed.hostname;
  try {
    const resolved = await lookup(parsed.hostname);
    ip = resolved.address;
  } catch { /* use hostname as-is */ }
  const ipBase = `${parsed.protocol}//${ip}:${parsed.port}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${ipBase}/json/version`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const info = await res.json();
    const wsUrl = info.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error("No webSocketDebuggerUrl in /json/version");
    // Rebuild the WS URL with the resolved IP and correct port.
    const wsPath = new URL(wsUrl).pathname; // e.g. /devtools/browser/<id>
    return `ws://${ip}:${parsed.port}${wsPath}`;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Photo download (server-side, defeats CDN protection)
// ---------------------------------------------------------------------------

async function downloadPhotos(photoUrls, refererUrl, usedStealth) {
  if (photoUrls.length === 0) return [];

  const results = await Promise.allSettled(
    photoUrls.map((photoUrl) => downloadSinglePhoto(photoUrl, refererUrl)),
  );

  return results
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);
}

async function downloadSinglePhoto(photoUrl, refererUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOTO_TIMEOUT_MS);
  try {
    const response = await fetch(photoUrl, {
      headers: {
        "User-Agent": BROWSER_HEADERS["User-Agent"],
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
        // Omit Referer to defeat hotlink protection, or set to listing origin
        Referer: refererUrl,
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    if (!/image\//i.test(contentType)) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > PHOTO_MAX_BYTES || buffer.length < 1000) return null;

    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    return { buffer, contentType, ext };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Supabase storage upload
// ---------------------------------------------------------------------------

async function uploadAssets(photos, listing, folder) {
  const sb = getSupabase();
  if (!sb) return photos.map((_, i) => `${folder}/photo-${i + 1}.jpg`);

  const urls = [];

  // Upload photos
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const path = `${folder}/photo-${i + 1}.${photo.ext}`;
    try {
      const { error } = await sb.storage.from(BUCKET).upload(path, photo.buffer, {
        contentType: photo.contentType,
        upsert: true,
      });
      if (error) throw error;
      const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
      urls.push(data.publicUrl);
    } catch {
      // Skip failed uploads
    }
  }

  // Upload listing.json manifest
  try {
    const manifest = JSON.stringify(listing, null, 2);
    await sb.storage.from(BUCKET).upload(`${folder}/listing.json`, Buffer.from(manifest), {
      contentType: "application/json",
      upsert: true,
    });
  } catch {
    // Non-critical
  }

  return urls;
}

// ---------------------------------------------------------------------------
// Extraction logic (mirrors src/lib/adstudio/listing-extract.ts)
// ---------------------------------------------------------------------------

function extractListingData(html, sourceUrl) {
  // Try JSON-LD first
  const jsonLdItems = extractJsonLd(html);
  const fromJsonLd = mapJsonLdToListing(jsonLdItems, sourceUrl);
  if (fromJsonLd && (fromJsonLd.address || fromJsonLd.suburb)) return fromJsonLd;

  // Try OG meta
  const og = extractOgMeta(html);
  if (og.address || og.photos?.length) {
    return {
      address: og.address || "",
      suburb: "",
      state: "",
      postcode: "",
      price: "",
      bedrooms: null,
      bathrooms: null,
      parking: null,
      propertyType: "Property",
      landSize: null,
      description: og.description || "",
      features: [],
      photos: og.photos || [],
      agentName: null,
      agencyName: null,
      agentPhone: null,
      inspectionTimes: [],
      sourceUrl,
    };
  }

  // Try visible text extraction (basic heuristic)
  const text = stripHtml(html).slice(0, 8000);
  const addressMatch = text.match(/(\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St|Lane|Drive|Dr|Court|Ct|Place|Pl|Road|Rd|Avenue|Ave|Boulevard|Blvd|Crescent|Cres|Way|Parade|Terrace))/i);
  const priceMatch = text.match(/\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?/);
  const bedMatch = text.match(/(\d+)\s*(?:bed|bedroom)/i);
  const bathMatch = text.match(/(\d+)\s*(?:bath|bathroom)/i);

  if (addressMatch || priceMatch) {
    return {
      address: addressMatch?.[1] || "",
      suburb: "",
      state: "",
      postcode: "",
      price: priceMatch?.[0] || "",
      bedrooms: bedMatch ? parseInt(bedMatch[1], 10) : null,
      bathrooms: bathMatch ? parseInt(bathMatch[1], 10) : null,
      parking: null,
      propertyType: "Property",
      landSize: null,
      description: text.slice(0, 300),
      features: [],
      photos: extractImageUrls(html, sourceUrl),
      agentName: null,
      agencyName: null,
      agentPhone: null,
      inspectionTimes: [],
      sourceUrl,
    };
  }

  return null;
}

function extractJsonLd(html) {
  const results = [];
  const pattern = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) results.push(...parsed);
      else if (parsed && typeof parsed === "object") results.push(parsed);
    } catch { /* skip */ }
  }
  return results;
}

function mapJsonLdToListing(items, sourceUrl) {
  const LISTING_TYPES = new Set(["Residence", "House", "Apartment", "RealEstateListing", "Place", "Accommodation"]);

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (item["@graph"]) {
      const inner = mapJsonLdToListing(item["@graph"], sourceUrl);
      if (inner) return inner;
    }
    const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]].filter(Boolean);
    if (!types.some((t) => LISTING_TYPES.has(t))) continue;

    const addr = typeof item.address === "object" ? item.address : {};
    const offers = item.offers && typeof item.offers === "object" ? item.offers : {};
    const photos = [];
    const images = item.image ?? item.photo;
    if (typeof images === "string") photos.push(images);
    else if (Array.isArray(images)) {
      for (const img of images.slice(0, 5)) {
        if (typeof img === "string") photos.push(img);
        else if (img?.url) photos.push(img.url);
        else if (img?.contentUrl) photos.push(img.contentUrl);
      }
    }

    return {
      address: addr.streetAddress || item.name || "",
      suburb: addr.addressLocality || "",
      state: addr.addressRegion || "",
      postcode: addr.postalCode || "",
      price: offers.price ? `$${offers.price}` : "",
      bedrooms: toNum(item.numberOfRooms ?? item.numberOfBedrooms),
      bathrooms: toNum(item.numberOfBathroomsTotal ?? item.numberOfBathrooms),
      parking: toNum(item.numberOfParkingSpaces),
      propertyType: types.find((t) => t !== "Place" && t !== "RealEstateListing") || "Property",
      landSize: item.floorSize ? String(item.floorSize) : null,
      description: (item.description || "").slice(0, 500),
      features: Array.isArray(item.amenityFeature)
        ? item.amenityFeature.map((f) => f?.name || f).filter(Boolean).slice(0, 10)
        : [],
      photos,
      agentName: item.agent?.name || null,
      agencyName: item.agent?.worksFor?.name || null,
      agentPhone: item.agent?.telephone || null,
      inspectionTimes: [],
      sourceUrl,
    };
  }
  return null;
}

function extractOgMeta(html) {
  const result = {};
  const ogImage = html.match(/<meta[^>]*property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']*)["']/i);
  if (ogImage?.[1]) result.photos = [ogImage[1]];
  const ogTitle = html.match(/<meta[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["']/i);
  if (ogTitle?.[1]) result.address = ogTitle[1];
  const ogDesc = html.match(/<meta[^>]*property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']*)["']/i);
  if (ogDesc?.[1]) result.description = ogDesc[1];
  return result;
}

function extractImageUrls(html, baseUrl) {
  const urls = [];
  const pattern = /<img[^>]*src\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const src = match[1];
    if (!src || src.startsWith("data:")) continue;
    try {
      const resolved = new URL(src, baseUrl).toString();
      if (/property|listing|house|apartment|home/i.test(resolved)) urls.push(resolved);
    } catch { /* skip */ }
    if (urls.length >= MAX_PHOTOS) break;
  }
  return urls;
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildBrief(data) {
  const parts = [];
  const specs = [
    data.bedrooms != null ? `${data.bedrooms} bed` : "",
    data.bathrooms != null ? `${data.bathrooms} bath` : "",
    data.parking != null ? `${data.parking} car` : "",
  ].filter(Boolean).join(" ");
  const type = (data.propertyType || "property").toLowerCase();
  parts.push(specs ? `${specs} ${type}` : type);
  const location = [data.address, data.suburb, data.state, data.postcode].filter(Boolean).join(", ");
  if (location) parts.push(`at ${location}`);
  if (data.price) parts.push(`Price: ${data.price}`);
  if (data.features.length > 0) parts.push(`Features: ${data.features.slice(0, 5).join(", ")}`);
  return parts.join(". ") + ".";
}

function buildSlug(data) {
  const base = [data.address, data.suburb]
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${base || "listing"}-${date}`;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function toNum(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
