/**
 * Return true when a hostname is local, private, link-local, or otherwise not
 * globally routable. WHATWG URL parsing normalizes unusual IPv4 spellings
 * before this function receives them.
 */
export function isBlockedPublicNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "local" || host.endsWith(".local")) return true;
  if (host === "internal" || host.endsWith(".internal")) return true;
  if (host === "home.arpa" || host.endsWith(".home.arpa")) return true;
  if (host === "metadata.google.internal" || host.endsWith(".metadata.google.internal")) return true;

  // Public release and extraction URLs are synchronous, DNS-free guards. Block
  // every IPv6 literal rather than maintain an incomplete copy of the IANA
  // special-purpose registry. Public DNS hostnames remain supported.
  if (host.includes(":")) return true;

  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second, third] = octets;
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 0 && third === 0) return true;
  if (first === 192 && second === 0 && third === 2) return true;
  if (first === 192 && second === 88 && third === 99) return true;
  if (first === 192 && second === 168) return true;
  if (first === 198 && (second === 18 || second === 19)) return true;
  if (first === 198 && second === 51 && third === 100) return true;
  if (first === 203 && second === 0 && third === 113) return true;
  return first >= 224;
}
