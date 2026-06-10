import assert from "node:assert/strict";
import test from "node:test";

import manifest from "../src/app/manifest.ts";
import {
  OFFLINE_FALLBACK_URL,
  STATIC_CACHE_NAME,
  canUseOfflineFallbackForNavigation,
  createServiceWorkerSource,
  isCacheableStaticAssetRequest,
} from "../src/lib/pwa/sw-policy.ts";

const ORIGIN = "https://blockwise.sale";

test("manifest exposes the Blockwise install metadata", () => {
  const appManifest = manifest();

  assert.equal(appManifest.name, "Blockwise");
  assert.equal(appManifest.short_name, "Blockwise");
  assert.equal(appManifest.start_url, "/");
  assert.equal(appManifest.scope, "/");
  assert.equal(appManifest.display, "browser");
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

test("service worker policy caches only same-origin static assets", () => {
  assert.equal(isCacheableStaticAssetRequest({ url: "/_next/static/chunks/app.js", destination: "script" }, ORIGIN), true);
  assert.equal(isCacheableStaticAssetRequest({ url: "/icons/icon-192.png", destination: "image" }, ORIGIN), true);
  assert.equal(isCacheableStaticAssetRequest({ url: "/hero/hero-wide.jpg", destination: "image" }, ORIGIN), true);

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

  assert.match(source, new RegExp(`const STATIC_CACHE_NAME = "${STATIC_CACHE_NAME}"`));
  assert.match(source, new RegExp(`const OFFLINE_FALLBACK_URL = "${OFFLINE_FALLBACK_URL}"`));
  assert.match(source, /caches\.delete\(key\)/);
  assert.match(source, /request\.mode === "navigate"/);
});
