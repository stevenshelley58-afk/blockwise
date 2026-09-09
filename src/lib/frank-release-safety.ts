import { isRecord } from "./frank-release-integrity.ts";
import { publicFrankReleaseUrl } from "./frank-release-public-url.ts";

const PRIVATE_REF_PATTERN = /\b(?:openbao|vault|secret|file|private|provider):\/\//iu;
const UNSAFE_MARKUP_PATTERN = /(?:<\/?[a-z][^>]*>|javascript\s*:|-----begin [a-z ]+-----)/iu;
const PRIVATE_VALUE_PATTERN = /(?:bearer\s+[a-z0-9._~+/=-]{16,}|(?:sk|pk|rk)_(?:live|test)_[a-z0-9]+)/iu;
const SECRET_CONTENT_PATTERN = /\b(?:secret|password|credential|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|private[ _-]?key)\b\s*(?::|=|is\b|value\b|data\b|payload\b|material\b)/iu;
const RESTRICTED_IMPLEMENTATION_PATTERN = /\b(?:private|provider|prospect|outreach)\b(?:[\s_-]+)(?:data|payload|record|ref|id|token|credential|source(?:[\s_-]+material)?|body|request|response)s?\b/iu;
const RESTRICTED_REF_PATH_PATTERN = /(?:^|[/:._-])(?:private|provider|prospect|outreach|secret|credential|openbao|vault)(?:$|[/:._-])/iu;
const EMAIL_VALUE_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/u;
const PHONE_VALUE_PATTERN = /\+?\d[\d ()-]{7,}\d/u;
const NETWORK_URL_PATTERN = /https?:[\\/]{2}[^\s<>"'`]+/giu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;

const PHONE_FORMAT_EXEMPT_KEYS = new Set([
  "checked_at",
  "decided_at",
  "first_seen",
  "generated_at",
  "last_seen",
  "published_at",
  "released_at",
  "scanned_at",
  "checksum",
  "release_hash",
  "sha256",
  "signature",
]);
const SCOPE_PHONE_FORMAT_EXEMPT_KEYS = new Set(["id", "project_id", "workspace_id"]);

// These receipt names prove a completed scan; they do not carry the scanned data.
const ALLOWED_EVIDENCE_KEYS = new Set(["piiscan", "secretscan"]);
const FORBIDDEN_KEY_PARTS = [
  "apikey",
  "authorization",
  "contact",
  "credential",
  "email",
  "lead",
  "model",
  "openbao",
  "outreach",
  "password",
  "phone",
  "privatekey",
  "prompt",
  "prospect",
  "provider",
  "rationale",
  "rawpayload",
  "recipient",
  "refreshtoken",
  "secret",
  "token",
  "vault",
] as const;

export type FrankReleaseSafetyReason =
  | "forbidden_field"
  | "private_reference"
  | "unsafe_content"
  | "pii"
  | "unsafe_url"
  | "unsupported_value";

export class FrankReleaseSafetyError extends Error {
  readonly path: string;
  readonly reason: FrankReleaseSafetyReason;

  constructor(reason: FrankReleaseSafetyReason, path: string) {
    super(`Unsafe Frank release value at ${path}.`);
    this.name = "FrankReleaseSafetyError";
    this.path = path;
    this.reason = reason;
  }
}

/** Fail closed when any part of a purported public release carries private data. */
export function assertSafeFrankReleaseEnvelope(value: unknown): void {
  walkRelease(value, "$", "", new WeakSet<object>());
}

function walkRelease(value: unknown, path: string, key: string, active: WeakSet<object>): void {
  if (typeof value === "string") {
    assertSafeString(value, path, key);
    return;
  }
  if (Array.isArray(value)) {
    assertNotCyclic(value, path, active);
    try {
      value.forEach((entry, index) => walkRelease(entry, `${path}[${index}]`, key, active));
    } finally {
      active.delete(value);
    }
    return;
  }
  if (isRecord(value)) {
    assertNotCyclic(value, path, active);
    try {
      for (const [childKey, child] of Object.entries(value)) {
        const normalizedKey = normalizeKey(childKey);
        if (isForbiddenKey(normalizedKey)) {
          throw new FrankReleaseSafetyError("forbidden_field", `${path}.${childKey}`);
        }
        walkRelease(child, `${path}.${childKey}`, childKey, active);
      }
    } finally {
      active.delete(value);
    }
    return;
  }
  if (
    value !== null
    && typeof value !== "boolean"
    && !(typeof value === "number" && Number.isFinite(value))
  ) {
    throw new FrankReleaseSafetyError("unsupported_value", path);
  }
}

function assertNotCyclic(value: object, path: string, active: WeakSet<object>): void {
  if (active.has(value)) {
    throw new FrankReleaseSafetyError("unsupported_value", path);
  }
  active.add(value);
}

function assertSafeString(value: string, path: string, key: string): void {
  if (PRIVATE_REF_PATTERN.test(value)) {
    throw new FrankReleaseSafetyError("private_reference", path);
  }

  for (const match of value.matchAll(NETWORK_URL_PATTERN)) {
    const candidate = trimSentencePunctuation(match[0]);
    if (publicFrankReleaseUrl(candidate, { referenceLike: isReferenceLikeKey(key) }) === null) {
      throw new FrankReleaseSafetyError("unsafe_url", path);
    }
  }
  const nonNetworkText = value.replace(NETWORK_URL_PATTERN, "");
  const sensitiveText = path.endsWith(".sanitization_receipts.secret_scan.receipt_id")
    ? nonNetworkText.replace(/^secret[-_.:]scan(?=[-_.:]|$)/iu, "")
    : nonNetworkText;

  if (
    UNSAFE_MARKUP_PATTERN.test(sensitiveText)
    || PRIVATE_VALUE_PATTERN.test(sensitiveText)
    || SECRET_CONTENT_PATTERN.test(sensitiveText)
    || RESTRICTED_IMPLEMENTATION_PATTERN.test(sensitiveText)
    || (isReferenceLikeKey(key) && RESTRICTED_REF_PATH_PATTERN.test(sensitiveText))
  ) {
    throw new FrankReleaseSafetyError("unsafe_content", path);
  }

  if (EMAIL_VALUE_PATTERN.test(value)) {
    throw new FrankReleaseSafetyError("pii", path);
  }
  const phoneFormatExempt = PHONE_FORMAT_EXEMPT_KEYS.has(key) || SHA256_PATTERN.test(value);
  if (!phoneFormatExempt && !SCOPE_PHONE_FORMAT_EXEMPT_KEYS.has(key) && PHONE_VALUE_PATTERN.test(value)) {
    throw new FrankReleaseSafetyError("pii", path);
  }
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function isForbiddenKey(normalizedKey: string): boolean {
  if (ALLOWED_EVIDENCE_KEYS.has(normalizedKey)) return false;
  return FORBIDDEN_KEY_PARTS.some((part) => normalizedKey.includes(part));
}

function isReferenceLikeKey(key: string): boolean {
  return key === "url"
    || /_url$/iu.test(key)
    || /(?:^|_)(?:ref|refs|receipt|receipt_id|trace_id)$/iu.test(key);
}

function trimSentencePunctuation(value: string): string {
  return value.replace(/[),.;!?]+$/gu, "");
}
