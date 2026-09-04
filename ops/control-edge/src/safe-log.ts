const SAFE_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/** Never emit arbitrary exception text: provider errors can contain PII/secrets. */
export function safeErrorCode(error: unknown): string {
  const candidate = error instanceof Error ? error.message : "";
  return SAFE_CODE.test(candidate) ? candidate : "unknown_error";
}

export function safeSuffix(value: unknown): string {
  const candidate = typeof value === "string" ? value : "";
  return candidate.length > 8 ? candidate.slice(-8) : candidate;
}
