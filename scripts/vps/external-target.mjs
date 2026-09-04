#!/usr/bin/env node

import net from "node:net";

const managedSuffixes = [".vercel.app", ".supabase.co"];

function normalizeHostname(hostname) {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/u, "");
}

function ipv4Parts(host) {
  const parts = host.split(".").map((part) => Number(part));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

function isReservedIpv4(host) {
  const parts = ipv4Parts(host);
  if (!parts) return false;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) || (a === 198 && b >= 18 && b <= 19) ||
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224;
}

function ipv6Parts(host) {
  const value = host.toLowerCase();
  if (!value.includes(":")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const parse = (part) => part ? part.split(":").map((word) => Number.parseInt(word, 16)) : [];
  const left = parse(halves[0]);
  const right = halves.length === 2 ? parse(halves[1]) : [];
  if ([...left, ...right].some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) return null;
  if (halves.length === 1 && left.length !== 8) return null;
  if (halves.length === 2 && left.length + right.length >= 8) return null;
  return halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right] : left;
}

function isReservedIp(host) {
  const normalized = normalizeHostname(host);
  if (net.isIP(normalized) === 4) return isReservedIpv4(normalized);
  if (net.isIP(normalized) !== 6) return false;
  const words = ipv6Parts(normalized);
  if (!words) return true;
  const mapped = words.slice(0, 6).every((word, index) => (index === 5 ? word === 0xffff : word === 0));
  if (mapped) return isReservedIpv4(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  return words.every((word) => word === 0) || (words.every((word, index) => index === 7 ? word === 1 : word === 0)) ||
    (words[0] & 0xfe00) === 0xfc00 || (words[0] & 0xffc0) === 0xfe80 ||
    (words[0] & 0xff00) === 0xff00 || (words[0] === 0x2001 && words[1] === 0x0db8);
}

export function validateExternalUrl(raw, { requireHttps = true } = {}) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let url;
  try { url = new URL(raw.trim()); } catch { return null; }
  if ((requireHttps && url.protocol !== "https:") || (!requireHttps && !["http:", "https:"].includes(url.protocol))) return null;
  if (url.username || url.password || !url.hostname) return null;
  const host = normalizeHostname(url.hostname);
  if (host === "localhost" || isReservedIp(host) || host === "vercel.app" || host === "supabase.co" ||
    managedSuffixes.some((suffix) => host.endsWith(suffix))) return null;
  return url;
}

if (process.argv[1] && process.argv[2] !== undefined) {
  process.exitCode = validateExternalUrl(process.argv[2], {
    requireHttps: process.env.BLOCKWISE_EXTERNAL_URL_ALLOW_HTTP !== "true",
  }) ? 0 : 1;
}
