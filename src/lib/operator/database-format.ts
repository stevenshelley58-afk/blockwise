// Client-safe helpers shared by the operator Database viewer and its API routes.
// IMPORTANT: this module must not import server-only code (service client, env)
// so it can be bundled into the browser component.

/** Column metadata as returned by the public.operator_db_schema() RPC. */
export type DbColumn = {
  name: string;
  type: string;
  nullable: boolean;
  has_default: boolean;
  position: number;
};

export type DbTable = {
  name: string;
  approx_rows: number;
  columns: DbColumn[];
};

/**
 * Columns the operator viewer never lets you edit. `id` is the row key used in
 * the WHERE clause; created/updated timestamps are managed by the platform.
 */
export const READONLY_COLUMNS = new Set(["id", "created_at", "updated_at"]);

/** Max rows returned per page; keeps payloads and PostgREST ranges bounded. */
export const MAX_PAGE = 200;
export const DEFAULT_PAGE = 50;

/** Classify a Postgres data_type into the coarse kind the UI and coercion use. */
export function columnKind(
  type: string,
): "int" | "float" | "bool" | "json" | "array" | "uuid" | "timestamp" | "date" | "text" {
  switch (type) {
    case "integer":
    case "bigint":
    case "smallint":
      return "int";
    case "numeric":
    case "double precision":
    case "real":
      return "float";
    case "boolean":
      return "bool";
    case "json":
    case "jsonb":
      return "json";
    case "ARRAY":
      return "array";
    case "uuid":
      return "uuid";
    case "timestamp with time zone":
    case "timestamp without time zone":
      return "timestamp";
    case "date":
    case "daterange":
      return "date";
    default:
      return "text";
  }
}

/** Column-name patterns that strongly imply the value is an image/video asset. */
const MEDIA_NAME = /(image|photo|logo|preview|thumb|thumbnail|avatar|banner|media|asset|creative|poster|screenshot)/i;
const URLISH_NAME = /(url|path|src|uri|href)/i;
const MEDIA_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|mp4|webm|mov|m4v|ogg)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/i;

/**
 * Decide whether a cell should render as a media thumbnail.
 * Returns the kind plus whether we can build a usable <img>/<video> src.
 */
export function detectMedia(
  columnName: string,
  value: unknown,
): { kind: "image" | "video"; src: string | null; filename: string } | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const isUrl = /^https?:\/\//i.test(value);
  const isPath = value.startsWith("/") || /^[\w.-]+\/[\w./-]+$/.test(value);
  const extMedia = MEDIA_EXT.test(value);
  const strongName = MEDIA_NAME.test(columnName);
  const urlishName = URLISH_NAME.test(columnName);

  const looksMedia = extMedia || (strongName && (isUrl || isPath)) || (urlishName && extMedia);
  if (!looksMedia) return null;

  const kind: "image" | "video" = VIDEO_EXT.test(value) ? "video" : "image";
  const filename = value.split("?")[0].split("/").filter(Boolean).pop() ?? value;
  // Only http(s) URLs are directly renderable; bare storage paths fall back to a chip.
  return { kind, src: isUrl ? value : null, filename };
}
