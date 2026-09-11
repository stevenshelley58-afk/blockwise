import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

import manifest from "../src/app/manifest.ts";
import {
  OFFLINE_FALLBACK_URL,
  PWA_CACHE_VERSION,
  STATIC_CACHE_MAX_ENTRIES,
  STATIC_CACHE_NAME,
  THUMBNAIL_CACHE_MAX_ENTRIES,
  THUMBNAIL_CACHE_NAME,
  canUseOfflineFallbackForNavigation,
  createServiceWorkerSource,
  isExcludedServiceWorkerPath,
  isAdStudioThumbnailPath,
  isCacheableStaticAssetRequest,
} from "../src/lib/pwa/sw-policy.ts";

const ORIGIN = "https://blockwise.sale";

test("manifest exposes the Blockwise install metadata", () => {
  const appManifest = manifest();

  assert.equal(appManifest.name, "Blockwise");
  assert.equal(appManifest.short_name, "Blockwise");
  assert.equal(appManifest.description, "Create, approve, export, and track real estate ads from one platform.");
  assert.equal(appManifest.start_url, "/pwa");
  assert.equal(appManifest.scope, "/");
  assert.equal(appManifest.display, "standalone");
  assert.equal(appManifest.background_color, "#ffffff");
  assert.equal(appManifest.theme_color, "#123e75");
  assert.deepEqual(
    appManifest.icons?.map((icon) => ({ src: icon.src, sizes: icon.sizes, type: icon.type, purpose: icon.purpose })),
    [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  );
});

test("root layout registers the production service worker", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");

  assert.match(layout, /ServiceWorkerRegistrar/);
  assert.match(layout, /<ServiceWorkerRegistrar \/>/);
});

test("service worker policy caches only same-origin static assets", () => {
  assert.equal(isCacheableStaticAssetRequest({ url: "/_next/static/chunks/app.js", destination: "script" }, ORIGIN), true);
  assert.equal(isCacheableStaticAssetRequest({ url: "/icons/icon-192.png", destination: "image" }, ORIGIN), true);
  // Display-image width variants go to the bounded thumbnail cache, whatever
  // ladder produced them, so they cannot evict app assets from the static cache.
  assert.equal(isCacheableStaticAssetRequest({ url: "/adstudio-thumbnails/meta/abc-384.webp", destination: "image" }, ORIGIN), false);
  assert.equal(isAdStudioThumbnailPath("/adstudio-thumbnails/meta/abc-384.webp"), true);
  assert.equal(isAdStudioThumbnailPath("/adstudio-thumbnails/meta/abc-preview.webp"), false);
  assert.equal(isCacheableStaticAssetRequest({ url: "/hero/hero-wide.jpg", destination: "image" }, ORIGIN), true);
  assert.equal(
    isCacheableStaticAssetRequest({ url: "/adstudio-samples/sample.png", destination: "image" }, ORIGIN),
    false,
  );
  assert.equal(isExcludedServiceWorkerPath("/adstudio-samples/sample.png"), true);

  assert.equal(isCacheableStaticAssetRequest({ url: "/api/report.png", destination: "image" }, ORIGIN), false);
  assert.equal(isCacheableStaticAssetRequest({ url: "/auth/callback.js", destination: "script" }, ORIGIN), false);
  assert.equal(isCacheableStaticAssetRequest({ url: "/_next/data/build/home.json" }, ORIGIN), false);
  assert.equal(isCacheableStaticAssetRequest({ url: "/icons/icon-192.png", method: "POST", destination: "image" }, ORIGIN), false);
  assert.equal(isCacheableStaticAssetRequest({ url: "https://example.com/app.js", destination: "script" }, ORIGIN), false);
  assert.equal(isCacheableStaticAssetRequest({ url: "https://abc.supabase.co/storage/logo.png", destination: "image" }, ORIGIN), false);
});

test("service worker policy uses offline fallback only for safe same-origin navigations", () => {
  assert.equal(canUseOfflineFallbackForNavigation({ url: "/home", mode: "navigate" }, ORIGIN), true);
  assert.equal(canUseOfflineFallbackForNavigation({ url: "/campaigns", destination: "document" }, ORIGIN), true);

  assert.equal(canUseOfflineFallbackForNavigation({ url: "/api/home", mode: "navigate" }, ORIGIN), false);
  assert.equal(canUseOfflineFallbackForNavigation({ url: "/auth/login", mode: "navigate" }, ORIGIN), false);
  assert.equal(canUseOfflineFallbackForNavigation({ url: "/home", method: "POST", mode: "navigate" }, ORIGIN), false);
  assert.equal(canUseOfflineFallbackForNavigation({ url: "https://accounts.google.com/o/oauth2/v2/auth", mode: "navigate" }, ORIGIN), false);
});

test("generated service worker source includes versioned cache and cleanup policy", () => {
  const source = createServiceWorkerSource();

  // Pinned on purpose: bump it here when shipped static assets change at a stable URL.
  assert.equal(PWA_CACHE_VERSION, "v5");
  assert.match(source, new RegExp(`const STATIC_CACHE_NAME = "${STATIC_CACHE_NAME}"`));
  assert.match(source, new RegExp(`const STATIC_CACHE_MAX_ENTRIES = ${STATIC_CACHE_MAX_ENTRIES}`));
  assert.match(source, new RegExp(`const THUMBNAIL_CACHE_NAME = "${THUMBNAIL_CACHE_NAME}"`));
  assert.match(source, new RegExp(`const THUMBNAIL_CACHE_MAX_ENTRIES = ${THUMBNAIL_CACHE_MAX_ENTRIES}`));
  assert.match(source, /boundedThumbnailCacheFirst/);
  assert.match(source, /keys\.length - limit/);
  assert.match(source, new RegExp(`const OFFLINE_FALLBACK_URL = "${OFFLINE_FALLBACK_URL}"`));
  assert.match(source, /caches\.delete\(key\)/);
  assert.match(source, /request\.mode === "navigate"/);
});


test("service worker serves network assets when cache reads fail", async () => {
  const listeners: Record<string, (event: any) => void> = {};
  let fetchCalls = 0;
  const context: any = {
    self: { location: { origin: ORIGIN }, addEventListener: (name: string, fn: any) => { listeners[name] = fn; } },
    caches: { open: async () => { throw new Error("cache unavailable"); } },
    fetch: async () => { fetchCalls += 1; return { ok: true, clone: () => ({}) }; },
    Response,
    Promise,
    URL,
  };
  vm.runInNewContext(createServiceWorkerSource(), context);
  let response: any;
  const event = { request: { method: "GET", url: `${ORIGIN}/_next/static/app.js`, destination: "script" }, respondWith: (p: Promise<any>) => { response = p; }, waitUntil: () => undefined };
  listeners.fetch(event);
  assert.equal((await response).ok, true);
  assert.equal(fetchCalls, 1);
});

test("service worker returns network response before cache maintenance settles", async () => {
  const listeners: Record<string, (event: any) => void> = {};
  let releasePut!: () => void;
  const putFinished = new Promise<void>((resolve) => { releasePut = resolve; });
  const cache = { match: async () => undefined, put: async () => putFinished, keys: async () => [] };
  const context: any = {
    self: { location: { origin: ORIGIN }, addEventListener: (name: string, fn: any) => { listeners[name] = fn; } },
    caches: { open: async () => cache },
    fetch: async () => ({ ok: true, clone: () => ({}) }),
    Response,
    Promise,
    URL,
  };
  vm.runInNewContext(createServiceWorkerSource(), context);
  let response: any;
  const waits: Promise<any>[] = [];
  const event = { request: { method: "GET", url: `${ORIGIN}/_next/static/app.js`, destination: "script" }, respondWith: (p: Promise<any>) => { response = p; }, waitUntil: (p: Promise<any>) => { waits.push(p); } };
  listeners.fetch(event);
  assert.equal((await response).ok, true);
  assert.equal(waits.length, 1);
  releasePut();
  await waits[0];
});

test("service worker uses a cache hit without fetching", async () => {
  const listeners: Record<string, (event: any) => void> = {};
  let fetchCalls = 0;
  const context: any = {
    self: { location: { origin: ORIGIN }, addEventListener: (name: string, fn: any) => { listeners[name] = fn; } },
    caches: { open: async () => ({ match: async () => ({ ok: true, cached: true }) }) },
    fetch: async () => { fetchCalls += 1; throw new Error("unexpected network"); },
    Response,
    Promise,
    URL,
  };
  vm.runInNewContext(createServiceWorkerSource(), context);
  let response: any;
  const event = { request: { method: "GET", url: `${ORIGIN}/_next/static/app.js`, destination: "script" }, respondWith: (p: Promise<any>) => { response = p; }, waitUntil: () => undefined };
  listeners.fetch(event);
  assert.equal((await response).cached, true);
  assert.equal(fetchCalls, 0);
});

test("service worker tolerates cache maintenance failures", async () => {
  for (const failure of ["match", "put", "keys"]) {
    const listeners: Record<string, (event: any) => void> = {};
    const cache: any = { match: async () => undefined, put: async () => undefined, keys: async () => [] };
  let opens = 0;
    cache[failure] = async () => { throw new Error(failure); };
    const context: any = {
      self: { location: { origin: ORIGIN }, addEventListener: (name: string, fn: any) => { listeners[name] = fn; } },
      caches: { open: async () => cache },
      fetch: async () => new Response("css", { status: 200, headers: { "content-type": "text/css" } }),
      Response, Promise, URL,
    };
    vm.runInNewContext(createServiceWorkerSource(), context);
    let response: Promise<Response>;
    const waits: Promise<any>[] = [];
    const event = { request: { method: "GET", url: `${ORIGIN}/_next/static/app.css`, destination: "style" }, respondWith: (p: Promise<Response>) => { response = p; }, waitUntil: (p: Promise<any>) => waits.push(p) };
    listeners.fetch(event);
    assert.equal((await response!).status, 200);
    await Promise.all(waits);
  }
});

test("service worker propagates network failure when cache misses", async () => {
  const listeners: Record<string, (event: any) => void> = {};
  const context: any = {
    self: { location: { origin: ORIGIN }, addEventListener: (name: string, fn: any) => { listeners[name] = fn; } },
    caches: { open: async () => ({ match: async () => undefined }) },
    fetch: async () => { throw new Error("network down"); }, Response, Promise, URL,
  };
  vm.runInNewContext(createServiceWorkerSource(), context);
  let response: Promise<Response>;
  const event = { request: { method: "GET", url: `${ORIGIN}/_next/static/app.js`, destination: "script" }, respondWith: (p: Promise<Response>) => { response = p; }, waitUntil: () => undefined };
  listeners.fetch(event);
  await assert.rejects(response!, /network down/);
});

test("service worker clones response before delayed cache open", async () => {
  const listeners: Record<string, (event: any) => void> = {};
  let releaseOpen!: () => void;
  const opening = new Promise<void>((resolve) => { releaseOpen = resolve; });
  let stored!: Response;
  const cache: any = { match: async () => undefined, put: async (_request: any, response: Response) => { stored = response; }, keys: async () => [] };
  let opens = 0;
  const context: any = {
    self: { location: { origin: ORIGIN }, addEventListener: (name: string, fn: any) => { listeners[name] = fn; } },
    caches: { open: async () => { opens += 1; if (opens > 1) await opening; return cache; } },
    fetch: async () => new Response("css", { status: 200 }), Response, Promise, URL,
  };
  vm.runInNewContext(createServiceWorkerSource(), context);
  let response: Promise<Response>;
  const waits: Promise<any>[] = [];
  const event = { request: { method: "GET", url: `${ORIGIN}/_next/static/app.css`, destination: "style" }, respondWith: (p: Promise<Response>) => { response = p; }, waitUntil: (p: Promise<any>) => waits.push(p) };
  listeners.fetch(event);
  const original = await response!;
  assert.equal(await original.text(), "css");
  releaseOpen();
  await Promise.all(waits);
  assert.equal(await stored.text(), "css");
});
