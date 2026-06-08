import { createHash } from "node:crypto";

/**
 * Privacy-preserving visitor identity: salted hash of (UTC day, IP, user
 * agent). Rotates daily, is irreversible, and requires no cookies, matching
 * the approach used by Vercel Web Analytics and Plausible.
 */
export function dailyVisitorHash(ip: string, userAgent: string, salt: string, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return createHash("sha256").update(`${salt}:${day}:${ip}:${userAgent}`).digest("hex").slice(0, 32);
}
