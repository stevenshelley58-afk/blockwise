export class OpsInvalidCursorError extends Error {
  constructor() {
    super("invalid operations cursor");
    this.name = "OpsInvalidCursorError";
  }
}

/** Parse list size without conflating an omitted value with an empty one. */
export function parseOpsLimit(searchParams: Pick<URLSearchParams, "has" | "get">): number {
  const raw = searchParams.has("limit")
    ? searchParams.get("limit")
    : searchParams.has("pageSize")
      ? searchParams.get("pageSize")
      : null;
  if (raw === null) return 50;
  if (raw.trim() === "") throw new RangeError("invalid_limit");
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new RangeError("invalid_limit");
  return Math.min(100, parsed);
}

/** Preserve explicit empty cursors so the route can fail closed instead of treating them as page one. */
export function readOpsCursor(searchParams: Pick<URLSearchParams, "has" | "get">): string | undefined {
  return searchParams.has("cursor") ? (searchParams.get("cursor") ?? "") : undefined;
}

export function encodeOpsCursor(cursor: { updatedAt: string; id: string }): string {
  const updatedAt = normalizeCursorTimestamp(cursor.updatedAt, false);
  return Buffer.from(JSON.stringify({ updatedAt, id: cursor.id }), "utf8").toString("base64url");
}

export function decodeOpsCursor(value: string | undefined): { updatedAt: string; id: string } | null {
  if (value === undefined) return null;
  if (value.length === 0 || value.length > 512 || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new OpsInvalidCursorError();
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.length === 0 || decoded.toString("base64url") !== value) throw new OpsInvalidCursorError();
    const parsed = JSON.parse(decoded.toString("utf8")) as { updatedAt?: unknown; id?: unknown };
    if (typeof parsed.updatedAt !== "string" || typeof parsed.id !== "string") throw new OpsInvalidCursorError();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)) throw new OpsInvalidCursorError();
    return { updatedAt: normalizeCursorTimestamp(parsed.updatedAt, true), id: parsed.id.toLowerCase() };
  } catch (error) {
    if (error instanceof OpsInvalidCursorError) throw error;
    throw new OpsInvalidCursorError();
  }
}

function normalizeCursorTimestamp(value: string, requireCanonical: boolean): string {
  if (value.length === 0 || value.length > 64) throw new OpsInvalidCursorError();
  const date = new Date(value);
  const canonical = Number.isFinite(date.getTime()) ? date.toISOString() : "";
  if (!canonical || (requireCanonical && canonical !== value)) throw new OpsInvalidCursorError();
  return canonical;
}
