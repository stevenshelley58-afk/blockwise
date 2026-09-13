/**
 * Stable Blockwise errors for CRM failures.
 *
 * Frappe exception types and tracebacks are never surfaced to the browser.
 * Callers translate a CrmError code into an HTTP status; the message is safe
 * to log but must not be forwarded verbatim to a client.
 */

export const CRM_ERROR_CODES = [
  "crm_unavailable",
  "conflict",
  "not_found",
  "forbidden",
  /**
   * The workspace has no usable CRM yet: no site mapping, no stored
   * credential, or a provisioning attempt that has not completed. It is a
   * distinct state so the surface can say setup is in progress instead of
   * showing a ready, empty CRM or a bare connection error.
   */
  "setup_pending",
  "unexpected",
] as const;
export type CrmErrorCode = (typeof CRM_ERROR_CODES)[number];

const SAFE_MESSAGES: Record<CrmErrorCode, string> = {
  crm_unavailable: "The CRM is unavailable. Your change was not saved.",
  conflict: "This enquiry changed since you loaded it. Refresh and try again.",
  not_found: "That enquiry was not found.",
  forbidden: "You do not have access to that enquiry.",
  setup_pending: "This workspace's CRM is still being set up.",
  unexpected: "The CRM rejected the request.",
};

/** HTTP status every code maps to when it reaches a route handler. */
export const CRM_ERROR_STATUS: Record<CrmErrorCode, number> = {
  crm_unavailable: 503,
  conflict: 409,
  not_found: 404,
  forbidden: 403,
  setup_pending: 503,
  unexpected: 502,
};

export class CrmError extends Error {
  readonly code: CrmErrorCode;
  readonly status: number;
  /** Redacted diagnostic for server logs only. */
  readonly detail: string | null;

  constructor(code: CrmErrorCode, detail?: string | null) {
    super(SAFE_MESSAGES[code]);
    this.name = "CrmError";
    this.code = code;
    this.status = CRM_ERROR_STATUS[code];
    this.detail = detail ?? null;
  }
}

export class CrmConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmConfigurationError";
  }
}

export function isCrmError(error: unknown): error is CrmError {
  return error instanceof CrmError;
}

export function isCrmConflict(error: unknown): boolean {
  return isCrmError(error) && error.code === "conflict";
}

export function isCrmUnavailable(error: unknown): boolean {
  return isCrmError(error) && error.code === "crm_unavailable";
}

/**
 * Map a Frappe error response onto a stable code.
 *
 * Frappe reports a thrown exception with `exc_type` plus either a plain
 * `exception` string or a JSON-encoded `_server_messages` list. A stale
 * revision is the only condition that maps to `conflict`.
 */
export function mapFrappeError(body: unknown, httpStatus: number): CrmError {
  const record = isRecord(body) ? body : {};
  const excType = typeof record.exc_type === "string" ? record.exc_type : "";
  const serverMessages = parseServerMessages(record._server_messages);
  const exception = typeof record.exception === "string" ? record.exception : "";
  const text = `${exception} ${serverMessages}`.trim();

  if (excType === "DoesNotExistError" || /doesnotexist/i.test(excType)) {
    return new CrmError("not_found", redact(text));
  }
  if (/changed since you loaded/i.test(text) || /ValidationError/.test(excType)) {
    return new CrmError("conflict", redact(text));
  }
  if (excType === "PermissionError" || excType === "AuthenticationError" || /Not permitted/i.test(text)) {
    return new CrmError("forbidden", redact(text));
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return new CrmError("forbidden", `crm_http_${httpStatus}`);
  }
  if (httpStatus >= 500) {
    return new CrmError("crm_unavailable", `crm_http_${httpStatus}`);
  }
  return new CrmError("unexpected", redact(`${excType} ${text}`.trim()));
}

function parseServerMessages(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return "";
    return parsed
      .map((entry) => (isRecord(entry) && typeof entry.message === "string" ? entry.message : ""))
      .join(" ");
  } catch {
    return "";
  }
}

/** Keep server-log diagnostics bounded and free of newlines. */
function redact(value: string): string | null {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed ? collapsed.slice(0, 300) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
