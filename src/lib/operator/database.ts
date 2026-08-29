import { createSupabaseServiceClient } from "@/lib/supabase/service";

import {
  columnKind,
  DEFAULT_PAGE,
  MAX_PAGE,
  READONLY_COLUMNS,
  type DbColumn,
  type DbTable,
} from "@/lib/operator/database-format";

export {
  columnKind,
  DEFAULT_PAGE,
  MAX_PAGE,
  READONLY_COLUMNS,
};
export type { DbColumn, DbTable };

let schemaCache: { at: number; tables: DbTable[] } | null = null;
const SCHEMA_TTL_MS = 30_000;

/** Fetch (and briefly cache) the public-schema table/column metadata. */
export async function loadDbSchema(force = false): Promise<DbTable[]> {
  if (!force && schemaCache && Date.now() - schemaCache.at < SCHEMA_TTL_MS) {
    return schemaCache.tables;
  }
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("operator_db_schema");
  if (error) {
    throw new Error(`operator_db_schema failed: ${error.message}`);
  }
  const tables = (data ?? []) as DbTable[];
  schemaCache = { at: Date.now(), tables };
  return tables;
}

/** Resolve a table by name from the live schema, or null if it is not a real public table. */
export async function resolveTable(name: string): Promise<DbTable | null> {
  if (!name || !/^[a-z0-9_]+$/i.test(name)) return null;
  const tables = await loadDbSchema();
  return tables.find((t) => t.name === name) ?? null;
}

/**
 * Coerce a raw JSON value from the client into the type Postgres expects for a
 * given column. Throws on invalid input so the API can return a 400.
 */
export function coerceValue(column: DbColumn, raw: unknown): unknown {
  const kind = columnKind(column.type);
  if (raw === null || raw === undefined || raw === "") {
    if (!column.nullable) throw new Error(`${column.name} is required and cannot be empty`);
    return null;
  }
  switch (kind) {
    case "int": {
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new Error(`${column.name} must be an integer`);
      return n;
    }
    case "float": {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`${column.name} must be a number`);
      return n;
    }
    case "bool":
      return raw === true || raw === "true" || raw === "t" || raw === "1";
    case "json":
      if (typeof raw === "object") return raw;
      try {
        return JSON.parse(String(raw));
      } catch {
        throw new Error(`${column.name} must be valid JSON`);
      }
    case "array":
      throw new Error(`${column.name} is an array column and cannot be edited inline yet`);
    default:
      return String(raw);
  }
}
