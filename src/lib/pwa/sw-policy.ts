export const PWA_CACHE_PREFIX = "blockwise-pwa";
// Bump when shipped static assets under cached prefixes (e.g. /ads/) change at a
// stable URL — the activate handler drops older caches, so devices refetch them
// instead of serving a stale cache-first copy.
export const PWA_CACHE_VERSION = "v3";
export const STATIC_CACHE_NAME = `${PWA_CACHE_PREFIX}-${PWA_CACHE_VERSION}-static`;
export const THUMBNAIL_CACHE_NAME = `${PWA_CACHE_PREFIX}-${PWA_CACHE_VERSION}-adstudio-thumbnails`;
export const THUMBNAIL_CACHE_MAX_ENTRIES = 240;
export const OFFLINE_FALLBACK_URL = "/offline.html";

export const PRECACHE_URLS = [OFFLINE_FALLBACK_URL, "/icons/icon-192.png", "/icons/icon-512.png"] as const;

export const EXCLUDED_PATH_PREFIXES = ["/api/", "/auth/", "/_next/data/"] as const;

export const STATIC_ASSET_PATH_PREFIXES = ["/_next/static/", "/icons/", "/hero/", "/ads/"] as const;

export const STATIC_ASSET_EXTENSIONS = [
  ".css",
  ".js",
  ".mjs",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
] as const;

export const STATIC_RESOURCE_DESTINATIONS = ["font", "image", "script", "style", "worker"] as const;

export const PROVIDER_HOST_KEYWORDS = [
  "supabase",
  "facebook.com",
  "facebook.net",
  "fbcdn.net",
  "google.com",
  "googleapis.com",
  "gstatic.com",
  "googleadservices.com",
  "doubleclick.net",
  "openai.com",
  "vercel-insights.com",
] as const;

export type ServiceWorkerRequestLike = {
  url: string;
  method?: string;
  mode?: string;
  destination?: string;
};

function toUrl(url: string, origin: string): URL {
  return new URL(url, origin);
}

function hasPathPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix));
}

export function isExcludedServiceWorkerPath(pathname: string): boolean {
  return hasPathPrefix(pathname, EXCLUDED_PATH_PREFIXES);
}

export function isProviderUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return PROVIDER_HOST_KEYWORDS.some((keyword) => hostname === keyword || hostname.endsWith(`.${keyword}`) || hostname.includes(keyword));
}

export function isStaticAssetPath(pathname: string, destination = ""): boolean {
  if (STATIC_RESOURCE_DESTINATIONS.includes(destination as (typeof STATIC_RESOURCE_DESTINATIONS)[number])) {
    return true;
  }

  const lowerPathname = pathname.toLowerCase();
  return (
    hasPathPrefix(lowerPathname, STATIC_ASSET_PATH_PREFIXES) ||
    STATIC_ASSET_EXTENSIONS.some((extension) => lowerPathname.endsWith(extension))
  );
}

export function isCacheableStaticAssetRequest(request: ServiceWorkerRequestLike, origin: string): boolean {
  if ((request.method ?? "GET").toUpperCase() !== "GET") {
    return false;
  }

  const url = toUrl(request.url, origin);
  if (url.origin !== toUrl(origin, origin).origin) {
    return false;
  }

  if (isProviderUrl(url) || isExcludedServiceWorkerPath(url.pathname)) {
    return false;
  }
  if (isAdStudioThumbnailPath(url.pathname)) return false;

  if (request.mode === "navigate" || request.destination === "document") {
    return false;
  }

  return isStaticAssetPath(url.pathname, request.destination);
}

export function isAdStudioThumbnailPath(pathname: string): boolean {
  return (
    pathname.startsWith("/adstudio-thumbnails/") &&
    (pathname.endsWith("-320.webp") || pathname.endsWith("-640.webp"))
  );
}

export function canUseOfflineFallbackForNavigation(request: ServiceWorkerRequestLike, origin: string): boolean {
  if ((request.method ?? "GET").toUpperCase() !== "GET") {
    return false;
  }

  const url = toUrl(request.url, origin);
  if (url.origin !== toUrl(origin, origin).origin) {
    return false;
  }

  if (isProviderUrl(url) || isExcludedServiceWorkerPath(url.pathname)) {
    return false;
  }

  return request.mode === "navigate" || request.destination === "document";
}

export function createServiceWorkerSource(): string {
  return `
const PWA_CACHE_PREFIX = ${JSON.stringify(PWA_CACHE_PREFIX)};
const STATIC_CACHE_NAME = ${JSON.stringify(STATIC_CACHE_NAME)};
const THUMBNAIL_CACHE_NAME = ${JSON.stringify(THUMBNAIL_CACHE_NAME)};
const THUMBNAIL_CACHE_MAX_ENTRIES = ${JSON.stringify(THUMBNAIL_CACHE_MAX_ENTRIES)};
const OFFLINE_FALLBACK_URL = ${JSON.stringify(OFFLINE_FALLBACK_URL)};
const PRECACHE_URLS = ${JSON.stringify(PRECACHE_URLS)};
const EXCLUDED_PATH_PREFIXES = ${JSON.stringify(EXCLUDED_PATH_PREFIXES)};
const STATIC_ASSET_PATH_PREFIXES = ${JSON.stringify(STATIC_ASSET_PATH_PREFIXES)};
const STATIC_ASSET_EXTENSIONS = ${JSON.stringify(STATIC_ASSET_EXTENSIONS)};
const STATIC_RESOURCE_DESTINATIONS = ${JSON.stringify(STATIC_RESOURCE_DESTINATIONS)};
const PROVIDER_HOST_KEYWORDS = ${JSON.stringify(PROVIDER_HOST_KEYWORDS)};

function hasPathPrefix(pathname, prefixes) {
  return prefixes.some((prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix));
}

function isProviderUrl(url) {
  const hostname = url.hostname.toLowerCase();
  return PROVIDER_HOST_KEYWORDS.some((keyword) => hostname === keyword || hostname.endsWith("." + keyword) || hostname.includes(keyword));
}

function isExcludedServiceWorkerPath(pathname) {
  return hasPathPrefix(pathname, EXCLUDED_PATH_PREFIXES);
}

function isStaticAssetPath(pathname, destination) {
  if (STATIC_RESOURCE_DESTINATIONS.includes(destination)) {
    return true;
  }

  const lowerPathname = pathname.toLowerCase();
  return (
    hasPathPrefix(lowerPathname, STATIC_ASSET_PATH_PREFIXES) ||
    STATIC_ASSET_EXTENSIONS.some((extension) => lowerPathname.endsWith(extension))
  );
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isCacheableStaticAssetRequest(request) {
  if (request.method !== "GET") {
    return false;
  }

  const url = new URL(request.url);
  if (!isSameOrigin(url)) {
    return false;
  }

  if (isProviderUrl(url) || isExcludedServiceWorkerPath(url.pathname)) {
    return false;
  }
  if (isAdStudioThumbnailPath(url.pathname)) return false;

  if (request.mode === "navigate" || request.destination === "document") {
    return false;
  }

  return isStaticAssetPath(url.pathname, request.destination);
}

function isAdStudioThumbnailPath(pathname) {
  return pathname.startsWith("/adstudio-thumbnails/") &&
    (pathname.endsWith("-320.webp") || pathname.endsWith("-640.webp"));
}

function canUseOfflineFallbackForNavigation(request) {
  if (request.method !== "GET") {
    return false;
  }

  const url = new URL(request.url);
  if (!isSameOrigin(url)) {
    return false;
  }

  if (isProviderUrl(url) || isExcludedServiceWorkerPath(url.pathname)) {
    return false;
  }

  return request.mode === "navigate" || request.destination === "document";
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function boundedThumbnailCacheFirst(request) {
  const cache = await caches.open(THUMBNAIL_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (!response.ok) return response;
  await cache.put(request, response.clone());
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - THUMBNAIL_CACHE_MAX_ENTRIES)).map((key) => cache.delete(key)));
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) =>
          key.startsWith(PWA_CACHE_PREFIX) && key !== STATIC_CACHE_NAME && key !== THUMBNAIL_CACHE_NAME
            ? caches.delete(key)
            : undefined
        ),
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (canUseOfflineFallbackForNavigation(request)) {
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse;
          return preloaded || (await fetch(request));
        } catch (error) {
          return (await caches.match(OFFLINE_FALLBACK_URL)) || Response.error();
        }
      })(),
    );
    return;
  }

  if (!isCacheableStaticAssetRequest(request)) {
    const url = new URL(request.url);
    if (request.method === "GET" && isSameOrigin(url) && isAdStudioThumbnailPath(url.pathname)) {
      event.respondWith(boundedThumbnailCacheFirst(request));
    }
    return;
  }

  event.respondWith(cacheFirst(request));
});
`.trim();
}
