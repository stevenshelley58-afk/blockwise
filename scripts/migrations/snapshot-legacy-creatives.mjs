#!/usr/bin/env node
// Gate 0 read-only inventory for legacy AdStudio creatives.
//
// Usage: node scripts/migrations/snapshot-legacy-creatives.mjs --dry-run
//
// The exact manifest is sensitive production evidence and is written only to
// the repository-ignored artifacts directory. This executable has no live mode.

import { chmod, link, lstat, mkdir, open, readFile, realpath, stat, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const BUCKET = "workspace-artifacts";
const PAGE_SIZE = 1000;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const execFileAsync = promisify(execFile);

function requireEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing env: set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return { url, serviceRoleKey };
}

export function classifyProposedRenderKind(canvas) {
  const objects = canvas?.objects;
  if (!Array.isArray(objects)) return { kind: "unknown", reason: "objects_not_array" };
  if (objects.length === 0) return { kind: "unknown", reason: "empty_objects" };
  if (!objects.every(isValidCanvasObjectShape)) {
    return { kind: "unknown", reason: "malformed_object_shape" };
  }
  if (objects.length === 1 && objects[0]?.objectId === "template_clone_image") {
    return { kind: "flat_clone", reason: "exact_clone_marker" };
  }
  if (objects.length === 1) return { kind: "unknown", reason: "single_non_clone" };
  if (objects.some((object) => object?.objectId === "template_clone_image")) {
    return { kind: "unknown", reason: "hybrid_clone_marker" };
  }
  if (objects.length > 1 && objects.every((object) => object?.objectId !== "template_clone_image")) {
    return { kind: "legacy_composite", reason: "multiple_legacy_objects" };
  }
  return { kind: "unknown", reason: "ambiguous_object_shape" };
}

function isValidCanvasObjectShape(object) {
  const optionalFinitePositive = ["height", "size", "lineHeight", "weight"].every(
    (field) => object?.[field] === undefined || (Number.isFinite(object[field]) && object[field] > 0),
  );
  const optionalFiniteNonNegative = ["radius"].every(
    (field) => object?.[field] === undefined || (Number.isFinite(object[field]) && object[field] >= 0),
  );
  return Boolean(
    object !== null &&
    typeof object === "object" &&
    !Array.isArray(object) &&
    typeof object.objectId === "string" &&
    object.objectId.trim().length > 0 &&
    ["text", "image", "logo", "shape", "safe_zone"].includes(object.type) &&
    typeof object.role === "string" &&
    object.role.trim().length > 0 &&
    Number.isFinite(object.x) &&
    Number.isFinite(object.y) &&
    Number.isFinite(object.width) &&
    object.width > 0 &&
    optionalFinitePositive &&
    optionalFiniteNonNegative &&
    (object.opacity === undefined || (Number.isFinite(object.opacity) && object.opacity >= 0 && object.opacity <= 1)) &&
    (object.align === undefined || ["left", "center", "right"].includes(object.align)) &&
    (object.clip === undefined || ["rect", "circle", "arch"].includes(object.clip)) &&
    (object.imageAnchor === undefined ||
      ["center", "top", "bottom", "left", "right", "top_left", "top_right", "bottom_left", "bottom_right"].includes(
        object.imageAnchor,
      )) &&
    (object.font === undefined || ["brand_heading", "brand_body"].includes(object.font)) &&
    (object.fontFamily === undefined || typeof object.fontFamily === "string") &&
    (object.fill === undefined || typeof object.fill === "string") &&
    (object.content === undefined || typeof object.content === "string") &&
    (object.assetId === undefined || typeof object.assetId === "string") &&
    (object.customerSupplied === undefined || typeof object.customerSupplied === "boolean") &&
    typeof object.locked === "boolean",
  );
}

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain non-finite numbers.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry));
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TypeError(`Canonical JSON cannot contain undefined at ${key}.`);
      result[key] = canonicalValue(value[key]);
    }
    return result;
  }
  throw new TypeError(`Canonical JSON cannot contain ${typeof value}.`);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Canonical(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Text(value) {
  return sha256Bytes(Buffer.from(value, "utf8"));
}

export function buildRenderInputRecord({ row, campaign, variant, brandKit, assets, rendererSourceSha256 }) {
  const identity = brandKit.identity_json ?? {};
  const typography = brandKit.typography_json ?? {};
  const sortedAssets = [...assets].sort(
    (left, right) =>
      left.objectIndex - right.objectIndex ||
      left.slot.localeCompare(right.slot) ||
      String(left.objectId).localeCompare(String(right.objectId)),
  );
  const input = {
    schema: "adstudio-legacy-render-input/v1",
    identity: {
      workspaceId: row.workspace_id,
      creativeId: row.id,
      campaignId: campaign.id,
      variantId: variant.id,
      brandKitId: brandKit.id,
    },
    format: row.format,
    dimensions: {
      rowWidth: row.width,
      rowHeight: row.height,
      canvasWidth: row.canvas_json?.width,
      canvasHeight: row.canvas_json?.height,
    },
    canvas: row.canvas_json,
    brandContext: {
      businessName: identity.businessName ?? brandKit.business_name ?? "",
      tradingName: identity.tradingName ?? null,
      typography: {
        headingFont: typography.headingFont ?? "",
        bodyFont: typography.bodyFont ?? "",
        fallbackHeading: typography.fallbackHeading === "serif" ? "serif" : "sans-serif",
        fallbackBody: typography.fallbackBody === "serif" ? "serif" : "sans-serif",
      },
    },
    rendererSourceSha256,
    assets: sortedAssets,
  };
  return {
    input,
    canvasSha256: sha256Canonical(row.canvas_json),
    renderInputSha256: sha256Canonical(input),
  };
}

const DEFAULT_MAX_ASSET_BYTES = 25 * 1024 * 1024;

function resolvedAssetMetadata({ reference, bytes, mimeType, objectIndex, objectId, slot, maxBytes }) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.byteLength === 0) throw new Error("Asset resolved to zero bytes.");
  if (buffer.byteLength > maxBytes) throw new Error(`Asset exceeds ${maxBytes} byte limit.`);
  if (!/^image\/[a-z0-9.+-]+$/i.test(mimeType)) throw new Error(`Asset MIME type is not an image: ${mimeType}`);
  return {
    objectIndex,
    objectId,
    slot,
    referenceSha256: sha256Text(reference),
    contentSha256: sha256Bytes(buffer),
    mimeType: mimeType.toLowerCase(),
    byteLength: buffer.byteLength,
  };
}

function mimeTypeForPublicPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".avif") return "image/avif";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  throw new Error(`Unsupported public image extension: ${extension || "none"}`);
}

function ipv4Number(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function ipv4InCidr(value, base, prefix) {
  const shift = 32 - prefix;
  return shift === 32 || (value >>> shift) === (base >>> shift);
}

// Keep this fail-closed policy aligned with the IANA special-purpose registries.
// Only the registry's explicitly globally-reachable exceptions are allowed.
// https://www.iana.org/assignments/iana-ipv4-special-registry/
// https://www.iana.org/assignments/iana-ipv6-special-registry/
const BLOCKED_IPV4_CIDRS = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
].map(([base, prefix]) => [ipv4Number(base), prefix]);

const GLOBALLY_REACHABLE_IPV4_EXCEPTIONS = [
  ["192.0.0.9", 32],
  ["192.0.0.10", 32],
].map(([base, prefix]) => [ipv4Number(base), prefix]);

function ipv6Number(address) {
  let normalized = address.replace(/^\[|\]$/g, "").toLowerCase();
  const dottedMatch = normalized.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMatch) {
    const ipv4 = ipv4Number(dottedMatch[2]);
    if (ipv4 === null) return null;
    normalized = `${dottedMatch[1]}${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  if (normalized.split("::").length > 2) return null;
  const [headText, tailText] = normalized.split("::");
  const head = headText ? headText.split(":") : [];
  const tail = tailText ? tailText.split(":") : [];
  if (!normalized.includes("::") && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (normalized.includes("::") && missing < 1)) return null;
  const parts = [...head, ...Array(missing).fill("0"), ...tail];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.reduce((value, part) => (value << 16n) | BigInt(Number.parseInt(part, 16)), 0n);
}

function ipv6InCidr(value, base, prefix) {
  const shift = 128n - BigInt(prefix);
  return (value >> shift) === (base >> shift);
}

const BLOCKED_IPV6_CIDRS = [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3ffe::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
].map(([base, prefix]) => [ipv6Number(base), prefix]);

const GLOBALLY_REACHABLE_IPV6_EXCEPTIONS = [
  ["2001:1::1", 128],
  ["2001:1::2", 128],
  ["2001:1::3", 128],
  ["2001:3::", 32],
  ["2001:4:112::", 48],
  ["2001:20::", 28],
  ["2001:30::", 28],
].map(([base, prefix]) => [ipv6Number(base), prefix]);

export function isGloballyRoutableAddress(address) {
  const normalized = String(address).replace(/^\[|\]$/g, "").toLowerCase();
  const family = isIP(normalized);
  if (family === 4) {
    const value = ipv4Number(normalized);
    if (value === null) return false;
    if (GLOBALLY_REACHABLE_IPV4_EXCEPTIONS.some(([base, prefix]) => ipv4InCidr(value, base, prefix))) return true;
    return !BLOCKED_IPV4_CIDRS.some(([base, prefix]) => ipv4InCidr(value, base, prefix));
  }
  if (family !== 6) return false;
  const value = ipv6Number(normalized);
  if (value === null) return false;
  const mappedPrefix = ipv6Number("::ffff:0:0");
  if (ipv6InCidr(value, mappedPrefix, 96)) {
    return isGloballyRoutableAddress(
      `${Number((value >> 24n) & 0xffn)}.${Number((value >> 16n) & 0xffn)}.${Number((value >> 8n) & 0xffn)}.${Number(
        value & 0xffn,
      )}`,
    );
  }
  const nat64Prefix = ipv6Number("64:ff9b::");
  if (ipv6InCidr(value, nat64Prefix, 96)) {
    return isGloballyRoutableAddress(
      `${Number((value >> 24n) & 0xffn)}.${Number((value >> 16n) & 0xffn)}.${Number((value >> 8n) & 0xffn)}.${Number(
        value & 0xffn,
      )}`,
    );
  }
  if (!ipv6InCidr(value, ipv6Number("2000::"), 3)) return false;
  if (GLOBALLY_REACHABLE_IPV6_EXCEPTIONS.some(([base, prefix]) => ipv6InCidr(value, base, prefix))) return true;
  return !BLOCKED_IPV6_CIDRS.some(([base, prefix]) => ipv6InCidr(value, base, prefix));
}

function addressIdentity(address) {
  const normalized = String(address).replace(/^\[|\]$/g, "").toLowerCase();
  const family = isIP(normalized);
  if (family === 4) return { family, value: BigInt(ipv4Number(normalized)) };
  if (family === 6) return { family, value: ipv6Number(normalized) };
  return null;
}

function addressesEqual(left, right) {
  const leftIdentity = addressIdentity(left);
  const rightIdentity = addressIdentity(right);
  if (!leftIdentity || !rightIdentity) return false;
  if (leftIdentity.family === rightIdentity.family) return leftIdentity.value === rightIdentity.value;
  const ipv6 = leftIdentity.family === 6 ? leftIdentity : rightIdentity;
  const ipv4 = leftIdentity.family === 4 ? leftIdentity : rightIdentity;
  return ipv6InCidr(ipv6.value, ipv6Number("::ffff:0:0"), 96) && (ipv6.value & 0xffffffffn) === ipv4.value;
}

async function assertSafeRemoteUrl(value, lookupHost) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Remote assets must use HTTPS.");
  if (url.username || url.password) throw new Error("Remote asset credentials are forbidden.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") {
    throw new Error("Remote asset host is private or reserved.");
  }
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookupHost(hostname, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || addresses.length === 0) throw new Error("Remote asset host did not resolve.");
  const normalizedAddresses = addresses.map((entry) => ({ address: entry.address, family: isIP(entry.address) }));
  if (normalizedAddresses.some((entry) => !entry.family || !isGloballyRoutableAddress(entry.address))) {
    throw new Error("Remote asset host is private or reserved.");
  }
  normalizedAddresses.sort((left, right) => left.family - right.family || left.address.localeCompare(right.address));
  return { url, ...normalizedAddresses[0] };
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name);
  const value = headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function cancelBody(body) {
  if (!body) return;
  if (typeof body.cancel === "function") await body.cancel().catch(() => {});
  else if (typeof body.destroy === "function") body.destroy();
}

async function readBoundedBody(body, maxBytes, declaredLength) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("Asset byte limit must be a positive integer.");
  const parsedLength = declaredLength === undefined || declaredLength === null || declaredLength === ""
    ? null
    : Number(declaredLength);
  if (parsedLength !== null && (!Number.isSafeInteger(parsedLength) || parsedLength < 0)) {
    throw new Error("Asset content length is invalid.");
  }
  if (parsedLength !== null && parsedLength > maxBytes) {
    throw new Error(`Asset exceeds ${maxBytes} byte limit.`);
  }
  if (!body) throw new Error("Asset response has no body.");
  const chunks = [];
  let total = 0;
  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error(`Asset exceeds ${maxBytes} byte limit.`);
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
  } else if (body[Symbol.asyncIterator]) {
    for await (const value of body) {
      total += value.byteLength;
      if (total > maxBytes) {
        if (typeof body.destroy === "function") body.destroy();
        throw new Error(`Asset exceeds ${maxBytes} byte limit.`);
      }
      chunks.push(Buffer.from(value));
    }
  } else {
    throw new Error("Asset response body is not a readable stream.");
  }
  return Buffer.concat(chunks, total);
}

async function defaultRemoteRequest({ url, address, family, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { Accept: "image/*", Host: url.host },
        servername: isIP(hostname) ? undefined : hostname,
        lookup: (_host, _options, callback) => callback(null, address, family),
      },
      (response) => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
          remoteAddress: response.socket.remoteAddress,
        });
      },
    );
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Remote asset request timed out.")));
    request.once("error", reject);
    request.end();
  });
}

async function downloadRemoteAsset({ reference, remoteRequest, lookupHost, maxBytes, timeoutMs }) {
  let current = reference;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const endpoint = await assertSafeRemoteUrl(current, lookupHost);
    const response = await remoteRequest({ ...endpoint, timeoutMs });
    if (!addressesEqual(response.remoteAddress, endpoint.address) || !isGloballyRoutableAddress(response.remoteAddress)) {
      await cancelBody(response.body);
      throw new Error("Remote asset connected address did not match the validated address.");
    }
    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = headerValue(response.headers, "location");
      await cancelBody(response.body);
      if (!location) throw new Error("Remote asset redirect is missing a location.");
      current = new URL(location, endpoint.url).toString();
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      await cancelBody(response.body);
      throw new Error(`Remote asset returned HTTP ${response.statusCode}.`);
    }
    const mimeType = headerValue(response.headers, "content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (!mimeType) throw new Error("Remote asset is missing its MIME type.");
    return {
      bytes: await readBoundedBody(response.body, maxBytes, headerValue(response.headers, "content-length")),
      mimeType,
    };
  }
  throw new Error("Remote asset exceeded the redirect limit.");
}

export function decodeBoundedDataImage(reference, maxBytes, decode = (value) => Buffer.from(value, "base64")) {
  const match = reference.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw new Error("Asset data URL must be a base64 image.");
  const encoded = match[2].replace(/\s+/g, "");
  if (!/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(encoded)) {
    throw new Error("Asset data URL contains invalid base64.");
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const decodedLength = (encoded.length / 4) * 3 - padding;
  if (decodedLength > maxBytes) throw new Error(`Asset exceeds ${maxBytes} byte limit.`);
  return { mimeType: match[1], bytes: decode(encoded) };
}

async function assertPublicPathIsConfined(publicRoot, filePath) {
  const root = path.resolve(publicRoot);
  const relative = path.relative(root, filePath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Public asset path traversal is forbidden.");
  }
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink()) throw new Error("Public root must not be a symbolic link or junction.");
  const rootReal = await realpath(root);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("Public asset path contains a symbolic link or junction.");
  }
  const targetReal = await realpath(filePath);
  if (targetReal !== rootReal && !targetReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error("Public asset real path is outside public root.");
  }
  return targetReal;
}

async function readBoundedPublicFile(publicRoot, filePath, maxBytes) {
  const targetReal = await assertPublicPathIsConfined(publicRoot, filePath);
  const beforeOpen = await stat(targetReal);
  if (!beforeOpen.isFile()) throw new Error("Public asset is not a regular file.");
  if (beforeOpen.size > maxBytes) throw new Error(`Asset exceeds ${maxBytes} byte limit.`);
  const handle = await open(targetReal, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new Error("Public asset is not a regular file.");
    if (opened.size > maxBytes) throw new Error(`Asset exceeds ${maxBytes} byte limit.`);
    const body = handle.createReadStream({ autoClose: false });
    try {
      return await readBoundedBody(body, maxBytes, opened.size);
    } finally {
      body.destroy();
    }
  } finally {
    await handle.close();
  }
}

export async function resolveAssetReference({
  reference,
  workspaceId,
  objectIndex,
  objectId,
  slot,
  storageDownload,
  publicRoot,
  remoteRequest = defaultRemoteRequest,
  lookupHost = dnsLookup,
  maxBytes = DEFAULT_MAX_ASSET_BYTES,
  timeoutMs = 15_000,
}) {
  if (typeof reference !== "string" || !reference.trim()) throw new Error("Asset reference is missing.");
  if (reference.startsWith("data:")) {
    const decoded = decodeBoundedDataImage(reference, maxBytes);
    return resolvedAssetMetadata({
      reference,
      bytes: decoded.bytes,
      mimeType: decoded.mimeType,
      objectIndex,
      objectId,
      slot,
      maxBytes,
    });
  }

  if (reference.startsWith("/api/adstudio/media?")) {
    const mediaUrl = new URL(reference, "https://inventory.invalid");
    const storagePath = mediaUrl.searchParams.get("path")?.trim();
    if (!storagePath) throw new Error("Private storage asset is missing its path.");
    if (!storagePath.startsWith(`${workspaceId}/`)) {
      throw new Error("Private storage asset is outside workspace scope.");
    }
    if (storagePath.includes("\\") || storagePath.split("/").includes("..")) {
      throw new Error("Private storage asset path traversal is forbidden.");
    }
    if (typeof storageDownload !== "function") throw new Error("Private storage downloader is unavailable.");
    const downloaded = await storageDownload(storagePath);
    if (!downloaded?.body) throw new Error("Private storage downloader must return a readable stream.");
    return resolvedAssetMetadata({
      reference,
      bytes: await readBoundedBody(downloaded.body, maxBytes, downloaded.contentLength),
      mimeType: downloaded.mimeType,
      objectIndex,
      objectId,
      slot,
      maxBytes,
    });
  }

  if (reference.startsWith("/")) {
    if (!publicRoot) throw new Error("Public asset root is unavailable.");
    const root = path.resolve(publicRoot);
    const filePath = path.resolve(root, `.${reference}`);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      throw new Error("Public asset path traversal is forbidden.");
    }
    const bytes = await readBoundedPublicFile(root, filePath, maxBytes);
    return resolvedAssetMetadata({
      reference,
      bytes,
      mimeType: mimeTypeForPublicPath(filePath),
      objectIndex,
      objectId,
      slot,
      maxBytes,
    });
  }

  if (/^https?:\/\//i.test(reference)) {
    if (typeof remoteRequest !== "function") throw new Error("Remote asset requester is unavailable.");
    const downloaded = await downloadRemoteAsset({ reference, remoteRequest, lookupHost, maxBytes, timeoutMs });
    return resolvedAssetMetadata({
      reference,
      bytes: downloaded.bytes,
      mimeType: downloaded.mimeType,
      objectIndex,
      objectId,
      slot,
      maxBytes,
    });
  }

  throw new Error(`Unsupported asset reference: ${reference}`);
}

export async function resolveCanvasAssets({ canvas, workspaceId, ...resolverOptions }) {
  if (!Array.isArray(canvas?.objects)) throw new Error("Canvas objects must be an array before assets are resolved.");
  const assets = [];
  for (const [objectIndex, object] of canvas.objects.entries()) {
    let reference;
    let slot;
    if (object?.type === "image") {
      reference = object.content ?? object.assetId;
      slot = "image";
      if (typeof reference !== "string" || !reference.trim()) {
        throw new Error(`Image asset is missing at object index ${objectIndex}.`);
      }
    } else if (object?.type === "logo" && typeof object.assetId === "string" && object.assetId.trim()) {
      reference = object.assetId;
      slot = "logo";
    } else {
      continue;
    }
    if (typeof object.objectId !== "string" || !object.objectId) {
      throw new Error(`Asset object ID is missing at object index ${objectIndex}.`);
    }
    assets.push(
      await resolveAssetReference({
        ...resolverOptions,
        reference,
        workspaceId,
        objectIndex,
        objectId: object.objectId,
        slot,
      }),
    );
  }
  return assets;
}

async function loadPagedWorkspaceRows(supabase, table, columns, workspaceId, pageSize) {
  const rows = [];
  let cursor = null;
  while (true) {
    let query = supabase
      .from(table)
      .select(columns)
      .eq("workspace_id", workspaceId)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (cursor !== null) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    const page = data ?? [];
    if (page.length === 0) break;
    const nextCursor = page.at(-1)?.id;
    if (!nextCursor || nextCursor === cursor) throw new Error(`Could not advance ${table} pagination.`);
    rows.push(...page);
    cursor = nextCursor;
  }
  return rows;
}

async function loadWorkspaceRowsById(supabase, table, columns, workspaceId, ids, pageSize) {
  const rows = [];
  const uniqueIds = [...new Set(ids)].sort();
  for (let index = 0; index < uniqueIds.length; index += 100) {
    const chunk = uniqueIds.slice(index, index + 100);
    let cursor = null;
    while (true) {
      let query = supabase
        .from(table)
        .select(columns)
        .eq("workspace_id", workspaceId)
        .in("id", chunk)
        .order("id", { ascending: true })
        .limit(pageSize);
      if (cursor !== null) query = query.gt("id", cursor);
      const { data, error } = await query;
      if (error) throw new Error(`Could not read ${table}: ${error.message}`);
      const page = data ?? [];
      if (page.length === 0) break;
      const nextCursor = page.at(-1)?.id;
      if (!nextCursor || nextCursor === cursor) throw new Error(`Could not advance ${table} pagination.`);
      rows.push(...page);
      cursor = nextCursor;
    }
  }
  return rows;
}

export async function loadWorkspaceGraph({ supabase, workspaceId, pageSize = PAGE_SIZE }) {
  const creatives = await loadPagedWorkspaceRows(
    supabase,
    "adstudio_creatives",
    "id,workspace_id,campaign_id,variant_id,format,width,height,canvas_json,render_status,updated_at",
    workspaceId,
    pageSize,
  );
  const campaignsRows = await loadWorkspaceRowsById(
    supabase,
    "adstudio_campaigns",
    "id,workspace_id,brand_kit_id",
    workspaceId,
    creatives.map((row) => row.campaign_id),
    pageSize,
  );
  const variantsRows = await loadWorkspaceRowsById(
    supabase,
    "adstudio_campaign_variants",
    "id,workspace_id,campaign_id",
    workspaceId,
    creatives.map((row) => row.variant_id),
    pageSize,
  );
  const brandKitsRows = await loadWorkspaceRowsById(
    supabase,
    "adstudio_brand_kits",
    "id,workspace_id,business_name,identity_json,typography_json",
    workspaceId,
    campaignsRows.map((row) => row.brand_kit_id),
    pageSize,
  );
  const campaigns = new Map(campaignsRows.map((row) => [row.id, row]));
  const variants = new Map(variantsRows.map((row) => [row.id, row]));
  const brandKits = new Map(brandKitsRows.map((row) => [row.id, row]));
  let graphValid = true;
  for (const creative of creatives) {
    const campaign = campaigns.get(creative.campaign_id);
    const variant = variants.get(creative.variant_id);
    const brandKit = campaign ? brandKits.get(campaign.brand_kit_id) : null;
    if (
      creative.workspace_id !== workspaceId ||
      !campaign ||
      campaign.workspace_id !== workspaceId ||
      !variant ||
      variant.workspace_id !== workspaceId ||
      variant.campaign_id !== creative.campaign_id ||
      !brandKit ||
      brandKit.workspace_id !== workspaceId
    ) {
      graphValid = false;
      break;
    }
  }
  if (!graphValid) throw new Error("Workspace graph validation failed.");
  return { creatives, campaigns, variants, brandKits };
}

function dimensionsMatch(row) {
  const values = [row.width, row.height, row.canvas_json?.width, row.canvas_json?.height];
  return (
    values.every((value) => Number.isInteger(value) && value > 0) &&
    row.width === row.canvas_json.width &&
    row.height === row.canvas_json.height
  );
}

export async function buildWorkspaceInventory({ graph, workspaceId, rendererSourceSha256, resolverOptions = {} }) {
  const rows = [];
  for (const row of [...graph.creatives].sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
    const campaign = graph.campaigns.get(row.campaign_id);
    const variant = graph.variants.get(row.variant_id);
    const brandKit = campaign ? graph.brandKits.get(campaign.brand_kit_id) : null;
    if (!campaign || !variant || !brandKit) throw new Error("Workspace graph validation failed.");
    const classification = classifyProposedRenderKind(row.canvas_json);
    const issues = [];
    if (["objects_not_array", "empty_objects", "malformed_object_shape"].includes(classification.reason)) {
      issues.push({ code: "canvas_shape_invalid", message: "Canvas objects do not satisfy the required renderer shape." });
    }
    if (!dimensionsMatch(row)) {
      issues.push({ code: "dimension_mismatch", message: "Stored row and canvas dimensions differ or are invalid." });
    }
    let assets = [];
    try {
      assets = await resolveCanvasAssets({
        ...resolverOptions,
        canvas: row.canvas_json,
        workspaceId,
      });
    } catch {
      issues.push({ code: "asset_resolution_failed", message: "At least one renderer-consumed asset did not resolve." });
    }
    let renderRecord = null;
    if (issues.length === 0) {
      renderRecord = buildRenderInputRecord({
        row,
        campaign,
        variant,
        brandKit,
        assets,
        rendererSourceSha256,
      });
    }
    rows.push({
      workspaceId,
      creativeId: row.id,
      campaignId: row.campaign_id,
      variantId: row.variant_id,
      sourceVersion: row.updated_at ?? null,
      renderStatus: row.render_status ?? null,
      format: row.format,
      width: row.width,
      height: row.height,
      proposedRenderKind: classification.kind,
      classificationReason: classification.reason,
      canvasSha256: renderRecord?.canvasSha256 ?? sha256Canonical(row.canvas_json),
      renderInputSha256: renderRecord?.renderInputSha256 ?? null,
      assets,
      issues,
    });
  }
  const counts = {
    total: rows.length,
    flatClone: rows.filter((row) => row.proposedRenderKind === "flat_clone").length,
    legacyComposite: rows.filter((row) => row.proposedRenderKind === "legacy_composite").length,
    unknown: rows.filter((row) => row.proposedRenderKind === "unknown").length,
    unresolved: rows.filter((row) => row.issues.length > 0 || !row.renderInputSha256).length,
    eligibleLegacy: rows.filter(
      (row) => row.proposedRenderKind === "legacy_composite" && row.issues.length === 0 && row.renderInputSha256,
    ).length,
    alreadySnapshotted: rows.filter((row) => row.renderStatus === "legacy_snapshot").length,
  };
  return {
    workspaceId,
    counts,
    creativeIdSetSha256: sha256Canonical(rows.map((row) => row.creativeId)),
    renderInputSetSha256: sha256Canonical(rows.map((row) => [row.creativeId, row.renderInputSha256])),
    rows,
  };
}

function sumCounts(workspaces) {
  const totals = {
    total: 0,
    flatClone: 0,
    legacyComposite: 0,
    unknown: 0,
    unresolved: 0,
    eligibleLegacy: 0,
    alreadySnapshotted: 0,
  };
  for (const workspace of workspaces) {
    for (const key of Object.keys(totals)) totals[key] += workspace.counts[key];
  }
  return totals;
}

function inventoryPassDigest(workspaces) {
  return sha256Canonical(
    [...workspaces]
      .sort((left, right) => String(left.workspaceId).localeCompare(String(right.workspaceId)))
      .map((workspace) => ({
        ...workspace,
        rows: [...workspace.rows].sort((left, right) => String(left.creativeId).localeCompare(String(right.creativeId))),
      })),
  );
}

function workspaceIdSetDigest(workspaces) {
  return sha256Canonical(workspaces.map((workspace) => workspace.workspaceId).sort());
}

export function buildInventoryManifest({
  projectRef,
  sourceCommit,
  toolSourceSha256,
  rendererSourceSha256,
  capturedAtStart,
  capturedAtEnd,
  firstPass,
  secondPass,
}) {
  const workspaces = [...firstPass].sort((left, right) => String(left.workspaceId).localeCompare(String(right.workspaceId)));
  const firstPassSha256 = inventoryPassDigest(firstPass);
  const secondPassSha256 = inventoryPassDigest(secondPass);
  const totals = sumCounts(workspaces);
  const withoutManifestHash = {
    schema: "adstudio-legacy-inventory/v1",
    preliminaryPreFence: true,
    projectRef,
    sourceCommit,
    toolSourceSha256,
    rendererSourceSha256,
    capturedAtStart,
    capturedAtEnd,
    queryVersion: "workspace-keyset-v1",
    totals,
    drift: {
      detected: firstPassSha256 !== secondPassSha256,
      firstPassSha256,
      secondPassSha256,
      firstWorkspaceIdSetSha256: workspaceIdSetDigest(firstPass),
      secondWorkspaceIdSetSha256: workspaceIdSetDigest(secondPass),
    },
    acceptanceEligible: firstPassSha256 === secondPassSha256 && totals.unknown === 0 && totals.unresolved === 0,
    workspaces,
  };
  return {
    ...withoutManifestHash,
    manifestSha256: sha256Canonical(withoutManifestHash),
  };
}

async function runGit(repoRoot, args) {
  return execFileAsync("git", args, { cwd: repoRoot, encoding: "utf8", windowsHide: true });
}

function repoRelativePath(repoRoot, target) {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(target));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Evidence path must be a file inside the repository.");
  }
  return relative.split(path.sep).join("/");
}

export async function assertIgnoredOutputPath({ repoRoot, outputPath }) {
  const relative = repoRelativePath(repoRoot, outputPath);
  let tracked;
  try {
    ({ stdout: tracked } = await runGit(repoRoot, ["ls-files", "--", relative]));
  } catch {
    throw new Error("Could not prove manifest output is untracked and ignored by git.");
  }
  if (tracked.trim()) throw new Error("Manifest output must not be tracked by git.");
  try {
    await runGit(repoRoot, ["check-ignore", "--quiet", "--", relative]);
  } catch {
    throw new Error("Manifest output must be ignored by git.");
  }
}

export async function collectVerifiedSourceEvidence({ repoRoot, scriptPath, rendererPath }) {
  const paths = [scriptPath, rendererPath];
  const relativePaths = paths.map((target) => repoRelativePath(repoRoot, target));
  try {
    for (const relative of relativePaths) {
      await runGit(repoRoot, ["ls-files", "--error-unmatch", "--", relative]);
      await runGit(repoRoot, ["diff", "--quiet", "HEAD", "--", relative]);
      await runGit(repoRoot, ["cat-file", "-e", `HEAD:${relative}`]);
      const { stdout: workingBlob } = await runGit(repoRoot, ["hash-object", `--path=${relative}`, relative]);
      const { stdout: committedBlob } = await runGit(repoRoot, ["rev-parse", `HEAD:${relative}`]);
      if (workingBlob.trim() !== committedBlob.trim()) throw new Error("Working source differs from HEAD.");
    }
  } catch {
    throw new Error("Inventory script and renderer must be tracked and match HEAD before evidence capture.");
  }
  const { stdout } = await runGit(repoRoot, ["rev-parse", "HEAD"]);
  return {
    sourceCommit: stdout.trim(),
    toolSourceSha256: sha256Bytes(await readFile(scriptPath)),
    rendererSourceSha256: sha256Bytes(await readFile(rendererPath)),
  };
}

function pathIsWithin(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

async function windowsIdentitySid() {
  const command = "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value";
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  });
  const sid = stdout.trim();
  if (!/^S-1-(?:\d+-)+\d+$/.test(sid)) throw new Error("Could not determine the current Windows security identity.");
  return sid;
}

async function verifyWindowsAcl(target, sid) {
  const command = [
    "$acl = Get-Acl -LiteralPath $env:ADSTUDIO_EVIDENCE_PATH",
    "if (-not $acl.AreAccessRulesProtected) { exit 11 }",
    "$sid = $env:ADSTUDIO_EVIDENCE_SID",
    "$allow = @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' })",
    "if ($allow.Count -ne 1) { exit 12 }",
    "$actual = $allow[0].IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value",
    "if ($actual -ne $sid) { exit 13 }",
    "$full = [Security.AccessControl.FileSystemRights]::FullControl",
    "if (($allow[0].FileSystemRights -band $full) -ne $full) { exit 14 }",
  ].join("; ");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ADSTUDIO_EVIDENCE_PATH: target, ADSTUDIO_EVIDENCE_SID: sid },
  });
}

async function applyAndVerifyPrivatePermissions(target, { directory = false } = {}) {
  if (process.platform === "win32") {
    const sid = await windowsIdentitySid();
    const rights = directory ? `(OI)(CI)F` : `(F)`;
    await execFileAsync("icacls.exe", [target, "/inheritance:r", "/grant:r", `*${sid}:${rights}`], {
      encoding: "utf8",
      windowsHide: true,
    });
    await verifyWindowsAcl(target, sid);
    return "windows-protected-acl";
  }
  const expected = directory ? 0o700 : 0o600;
  await chmod(target, expected);
  const actual = (await stat(target)).mode & 0o777;
  if (actual !== expected) {
    throw new Error(`Evidence permissions verification failed: expected ${expected.toString(8)}, received ${actual.toString(8)}.`);
  }
  return directory ? "posix-0700" : "posix-0600";
}

async function ensurePrivateDirectoryChain(repoRoot, directory) {
  const root = path.resolve(repoRoot);
  const rootReal = await realpath(root);
  const relative = path.relative(root, directory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Manifest directory must stay inside the repository.");
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
      info = await lstat(current);
    }
    if (info.isSymbolicLink()) throw new Error("Manifest path contains a symbolic link or junction.");
    if (!info.isDirectory()) throw new Error("Manifest directory path contains a non-directory entry.");
    const currentReal = await realpath(current);
    if (!pathIsWithin(rootReal, currentReal)) throw new Error("Manifest directory real path escaped the repository.");
    await applyAndVerifyPrivatePermissions(current, { directory: true });
  }
}

export async function writeSecureManifest({ repoRoot, outputPath, manifest }) {
  const artifactsRoot = path.resolve(repoRoot, "artifacts");
  const target = path.resolve(repoRoot, outputPath);
  if (target !== artifactsRoot && !target.startsWith(`${artifactsRoot}${path.sep}`)) {
    throw new Error("Manifest output must stay inside the repository artifacts directory.");
  }
  await assertIgnoredOutputPath({ repoRoot, outputPath: target });
  const directory = path.dirname(target);
  await ensurePrivateDirectoryChain(repoRoot, directory);
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  const bytes = Buffer.from(`${canonicalJson(manifest)}\n`, "utf8");
  let handle;
  let permissionsScheme;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await applyAndVerifyPrivatePermissions(temporary);
    try {
      await link(temporary, target);
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error(`Manifest already exists: ${target}`);
      throw error;
    }
    permissionsScheme = await applyAndVerifyPrivatePermissions(target);
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  const writtenBytes = await readFile(target);
  if (!writtenBytes.equals(bytes)) throw new Error("Manifest bytes changed while being written.");
  return {
    outputPath: target,
    byteLength: writtenBytes.byteLength,
    fileSha256: sha256Bytes(writtenBytes),
    permissionsVerified: true,
    permissionsScheme,
  };
}

export async function listWorkspaceIds({ supabase, pageSize = PAGE_SIZE }) {
  const rows = [];
  let cursor = null;
  while (true) {
    let query = supabase.from("workspaces").select("id").order("id", { ascending: true }).limit(pageSize);
    if (cursor !== null) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw new Error(`Could not enumerate workspaces: ${error.message}`);
    const page = data ?? [];
    if (page.length === 0) break;
    const nextCursor = page.at(-1)?.id;
    if (!nextCursor || nextCursor === cursor) throw new Error("Could not advance workspace pagination.");
    rows.push(...page);
    cursor = nextCursor;
  }
  return rows.map((row) => row.id).sort();
}

export async function runInventory({
  supabase,
  repoRoot,
  outputPath,
  projectRef,
  sourceCommit,
  toolSourceSha256,
  rendererSourceSha256,
  resolverOptions = {},
  now = () => new Date().toISOString(),
  logger = console.log,
  writeManifest = writeSecureManifest,
}) {
  const capturedAtStart = now();
  const collectPass = async () => {
    const workspaceIds = await listWorkspaceIds({ supabase });
    const workspaces = [];
    for (const workspaceId of workspaceIds) {
      const graph = await loadWorkspaceGraph({ supabase, workspaceId });
      workspaces.push(
        await buildWorkspaceInventory({ graph, workspaceId, rendererSourceSha256, resolverOptions }),
      );
    }
    return { workspaceIds, workspaces };
  };
  const firstPassResult = await collectPass();
  const secondPassResult = await collectPass();
  const capturedAtEnd = now();
  const manifest = buildInventoryManifest({
    projectRef,
    sourceCommit,
    toolSourceSha256,
    rendererSourceSha256,
    capturedAtStart,
    capturedAtEnd,
    firstPass: firstPassResult.workspaces,
    secondPass: secondPassResult.workspaces,
  });
  const written = await writeManifest({ repoRoot, outputPath, manifest });
  logger("Gate 0 AdStudio inventory completed in production-read-only mode.");
  logger(`Workspaces scanned: ${firstPassResult.workspaceIds.length}`);
  logger(`Creatives scanned: ${manifest.totals.total}`);
  logger(`Flat clones: ${manifest.totals.flatClone}`);
  logger(`Legacy composites: ${manifest.totals.legacyComposite}`);
  logger(`Unknown: ${manifest.totals.unknown}`);
  logger(`Unresolved: ${manifest.totals.unresolved}`);
  logger(`Drift detected: ${manifest.drift.detected ? "yes" : "no"}`);
  logger(`Manifest: ${path.relative(repoRoot, written.outputPath)}`);
  logger(`Logical manifest SHA-256: ${manifest.manifestSha256}`);
  logger(`Written file SHA-256: ${written.fileSha256}`);
  logger(`Status: ${manifest.acceptanceEligible ? "eligible for Gate 0 evidence review" : "blocked"}`);
  return { manifest, written, exitCode: manifest.acceptanceEligible ? 0 : 1 };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const forbiddenLiveFlags = ["--execute", "--live", "--write"].filter((flag) => args.includes(flag));
  if (!dryRun) {
    throw new Error("--dry-run is required; snapshot writes are disabled during Gate 0.");
  }
  if (forbiddenLiveFlags.length > 0) {
    throw new Error(`Live execution flags are forbidden during Gate 0: ${forbiddenLiveFlags.join(", ")}`);
  }
  const unsupported = args.filter((argument) => argument !== "--dry-run");
  if (unsupported.length > 0) throw new Error(`Unsupported argument: ${unsupported.join(", ")}`);

  const scriptPath = fileURLToPath(import.meta.url);
  const rendererPath = path.join(REPO_ROOT, "src", "lib", "adstudio", "creative-svg.ts");
  const outputPath = path.join(REPO_ROOT, "artifacts", "adstudio", "evidence", "legacy-manifest.json");
  const sourceEvidence = await collectVerifiedSourceEvidence({ repoRoot: REPO_ROOT, scriptPath, rendererPath });
  await assertIgnoredOutputPath({ repoRoot: REPO_ROOT, outputPath });
  const { url, serviceRoleKey } = requireEnv();
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const storageDownload = async (storagePath) => {
    const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(`${url.replace(/\/$/, "")}/storage/v1/object/authenticated/${BUCKET}/${encodedPath}`, {
      method: "GET",
      redirect: "manual",
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Accept: "image/*" },
    });
    if (response.status >= 300 && response.status < 400) throw new Error("Private workspace asset redirect is forbidden.");
    if (!response.ok || !response.body) throw new Error("Private workspace asset download failed.");
    return {
      body: response.body,
      contentLength: response.headers.get("content-length"),
      mimeType: response.headers.get("content-type")?.split(";", 1)[0]?.trim() || "application/octet-stream",
    };
  };
  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim() || new URL(url).hostname.split(".")[0];
  const result = await runInventory({
    supabase,
    repoRoot: REPO_ROOT,
    outputPath,
    projectRef,
    ...sourceEvidence,
    resolverOptions: {
      publicRoot: path.join(REPO_ROOT, "public"),
      storageDownload,
    },
  });
  process.exitCode = result.exitCode;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
