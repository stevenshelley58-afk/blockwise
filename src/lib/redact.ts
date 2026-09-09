/**
 * Redact secrets and PII from values destined for logs, error monitors and
 * webhook-failure receipts. Never log raw payloads that may contain
 * credentials, cookies, tokens, email bodies or payment data.
 */

const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|token|secret|password|passwd|api[-_]?key|access[-_]?key|refresh|session|signature|card|cvv|cvc|csc|iban|ssn|email_body|body_html|text_body|ip_address|username|email)/i;

/** Keys that are always safe to keep (identifiers used for debugging). */
const SAFE_KEY_PATTERN = /^(id|status|error|code|message|bucket|subject_key|workspace_id|provider|attempt|event_id|timestamp)$/i;

export function redactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => redactValue(entry, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) && !SAFE_KEY_PATTERN.test(key)
      ? "[redacted]"
      : redactValue(entry, depth + 1);
  }
  return out;
}

const BEARER_PATTERN = /bearer\s+[\w.\-~+/=]{8,}/gi;
const JWT_PATTERN = /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/g;
const HEADER_SECRET_PATTERN =
  /\b(x-api-key|api[_-]?key|authorization|set-cookie|private[_-]?token|shared[_-]?secret)(\s*[:=]\s*)[^\s,;&"]+/gi;
const URL_SENSITIVE_QUERY_PATTERN =
  /(https?:\/\/[^\s?#]+)\?[^\s#]*(?:email|token|secret|session|authorization|api[_-]?key|password|ip_address|username)=[^\s#]*/gi;
const EMAIL_BODY_MARKER = /(?<=^|\s)(Dear|Hi|Hello)\s[^.,;\n]{2,40},?[\s\S]{0,400}/g;

/** Shared by the email outbox to redact provider errors before persisting. */
export function redactString(value: string): string {
  return value
    .replace(BEARER_PATTERN, "[redacted]")
    .replace(JWT_PATTERN, "[redacted]")
    .replace(HEADER_SECRET_PATTERN, (_match, key: string, sep: string) => `${key}${sep}[redacted]`)
    .replace(URL_SENSITIVE_QUERY_PATTERN, "[redacted url]")
    .replace(EMAIL_BODY_MARKER, "[redacted email body]");
}
