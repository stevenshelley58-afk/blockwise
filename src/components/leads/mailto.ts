/**
 * Safe mailto: and tel: construction for the lead workspace.
 *
 * "Email lead" opens the agent's own mail app. Blockwise never sends, tracks
 * or relays the message, and opening a draft proves nothing about whether it
 * was read. The rules enforced here:
 *
 * - A recipient must be a single bare address. Anything with whitespace, angle
 *   brackets, quotes or a header separator is rejected outright, so a lead
 *   form value cannot smuggle in a second recipient or a bcc.
 * - Control characters, including CR and LF, can never reach the URL. They are
 *   the header-injection vector for mailto.
 * - Subject and body are encoded independently with encodeURIComponent, so an
 *   ampersand, question mark or newline in the draft cannot break out into
 *   another header.
 * - No tracking pixel, bcc, forwarding alias or hidden note is ever added.
 */

/** Conservative ceiling for a mail link. Longer drafts fall back to copy. */
export const MAILTO_URL_CEILING = 1800;

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
/** Characters that separate or terminate an RFC 5322 header. */
const HEADER_INJECTION_PATTERN = /[\s<>,;"'()[\]:\\]/;
const ALL_CONTROL_CHARACTERS = new RegExp("[\\u0000-\\u001F\\u007F]", "g");
const CONTROL_CHARACTERS_EXCEPT_NEWLINE = new RegExp("[\\u0000-\\u0009\\u000B-\\u001F\\u007F]", "g");

export type EmailDraft = {
  to: string | null;
  subject: string;
  body: string;
};

/**
 * Returns a single bare address, or null when the value cannot be used as a
 * mailto recipient. Rejection is deliberate: the caller falls back to "copy
 * the address" rather than opening a link that might do something else.
 */
export function normalizeRecipient(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (ALL_CONTROL_CHARACTERS.test(trimmed)) return null;
  if (HEADER_INJECTION_PATTERN.test(trimmed)) return null;
  if (trimmed.length > 254) return null;
  return EMAIL_PATTERN.test(trimmed) ? trimmed : null;
}

/** Strips every control character, then collapses runs of whitespace. */
export function sanitizeSubject(value: string): string {
  return value.replace(ALL_CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Keeps plain-text newlines, drops every other control character. */
export function sanitizeBody(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARACTERS_EXCEPT_NEWLINE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 5000);
}

/** Builds the mailto URL, or null when the recipient is unusable. */
export function buildMailtoUrl(draft: EmailDraft): string | null {
  const to = normalizeRecipient(draft.to);
  if (!to) return null;
  const subject = sanitizeSubject(draft.subject);
  const body = sanitizeBody(draft.body);
  const query = ["subject=" + encodeURIComponent(subject), "body=" + encodeURIComponent(body)].join("&");
  return "mailto:" + encodeURIComponent(to) + "?" + query;
}

export function isMailtoTooLong(url: string): boolean {
  return url.length > MAILTO_URL_CEILING;
}

/**
 * Returns a tel: URL for a number that is safe to dial, or null. A call proves
 * nothing about being answered, so the caller must still log contact.
 */
export function buildTelUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || ALL_CONTROL_CHARACTERS.test(trimmed)) return null;
  if (!/^[\d+()\s.-]+$/.test(trimmed)) return null;
  const normalized = trimmed.replace(/[()\s.-]/g, "");
  if (!/^\+?\d{7,15}$/.test(normalized)) return null;
  return "tel:" + normalized;
}
