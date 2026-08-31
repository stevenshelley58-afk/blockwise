import { NextResponse, type NextRequest } from "next/server";

import { requireOwnerOperator } from "@/lib/operator/auth";
import { recordAuditLog } from "@/lib/supabase/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  coerceValue,
  columnKind,
  DEFAULT_PAGE,
  MAX_PAGE,
  READONLY_COLUMNS,
  resolveTable,
  type DbColumn,
  type DbTable,
} from "@/lib/operator/database";

export const dynamic = "force-dynamic";

function hasColumn(table: DbTable, name: string): DbColumn | null {
  return table.columns.find((c) => c.name === name) ?? null;
}

function pickOrderColumn(table: DbTable, requested: string | null): string {
  if (requested && hasColumn(table, requested)) return requested;
  if (hasColumn(table, "created_at")) return "created_at";
  if (hasColumn(table, "id")) return "id";
  return table.columns[0]?.name ?? "id";
}

/** Sanitise a free-text search term for safe use inside a PostgREST or() filter. */
function safeTerm(q: string): string {
  return q.replace(/[,()*"\\]/g, " ").trim().slice(0, 100);
}

function workspaceIdOf(row: Record<string, unknown> | null | undefined): string | null {
  const v = row?.workspace_id;
  return typeof v === "string" ? v : null;
}

/* ----------------------------- READ ----------------------------- */
export async function GET(request: NextRequest) {
  const auth = await requireOwnerOperator();
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const tableName = params.get("table") ?? "";
  const table = await resolveTable(tableName);
  if (!table) return NextResponse.json({ error: "unknown_table" }, { status: 404 });

  const limit = Math.min(Math.max(Number(params.get("limit") ?? DEFAULT_PAGE), 1), MAX_PAGE);
  const offset = Math.max(Number(params.get("offset") ?? 0), 0);
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  const orderBy = pickOrderColumn(table, params.get("orderBy"));
  const search = (params.get("search") ?? "").trim();

  const supabase = createSupabaseServiceClient();
  let filter = supabase.from(table.name).select("*", { count: "estimated" });

  if (search) {
    const term = safeTerm(search);
    if (term) {
      const textCols = table.columns.filter((c) => columnKind(c.type) === "text").slice(0, 12);
      if (textCols.length) {
        filter = filter.or(textCols.map((c) => `${c.name}.ilike.%${term}%`).join(","));
      }
    }
  }

  const { data, error, count } = await filter
    .order(orderBy, { ascending: dir === "asc", nullsFirst: false })
    .range(offset, offset + limit - 1);
  if (error) {
    return NextResponse.json({ error: "read_failed", detail: error.message }, { status: 400 });
  }

  return NextResponse.json({
    table: table.name,
    rows: data ?? [],
    count: count ?? null,
    limit,
    offset,
    orderBy,
    dir,
  });
}

/* ---------------------------- UPDATE ---------------------------- */
export async function PATCH(request: NextRequest) {
  const auth = await requireOwnerOperator();
  if (!auth.ok) return auth.response;

  let body: { table?: string; id?: string; changes?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const table = await resolveTable(body.table ?? "");
  if (!table) return NextResponse.json({ error: "unknown_table" }, { status: 404 });
  if (!hasColumn(table, "id")) return NextResponse.json({ error: "table_has_no_id" }, { status: 400 });
  if (!body.id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  const changes = body.changes ?? {};
  const keys = Object.keys(changes);
  if (keys.length === 0) return NextResponse.json({ error: "no_changes" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    const col = hasColumn(table, key);
    if (!col) return NextResponse.json({ error: "unknown_column", detail: key }, { status: 400 });
    if (READONLY_COLUMNS.has(key)) return NextResponse.json({ error: "readonly_column", detail: key }, { status: 400 });
    try {
      patch[key] = coerceValue(col, changes[key]);
    } catch (e) {
      return NextResponse.json({ error: "invalid_value", detail: (e as Error).message }, { status: 400 });
    }
  }

  const supabase = createSupabaseServiceClient();
  const { data: before } = await supabase.from(table.name).select(["workspace_id", ...keys].join(",")).eq("id", body.id).maybeSingle();
  const { data: updated, error } = await supabase.from(table.name).update(patch).eq("id", body.id).select("*").maybeSingle();
  if (error) {
    return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 400 });
  }
  if (!updated) return NextResponse.json({ error: "row_not_found" }, { status: 404 });

  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of keys) diff[key] = { from: (before as Record<string, unknown> | null)?.[key] ?? null, to: patch[key] };
  await recordAuditLog(supabase, {
    workspaceId: workspaceIdOf(updated) ?? workspaceIdOf(before as Record<string, unknown> | null),
    actorProfileId: auth.userId,
    action: "operator.db.update",
    targetType: table.name,
    targetId: String(body.id),
    metadata: { changes: diff },
  });

  return NextResponse.json({ row: updated });
}

/* ---------------------------- INSERT ---------------------------- */
export async function POST(request: NextRequest) {
  const auth = await requireOwnerOperator();
  if (!auth.ok) return auth.response;

  let body: { table?: string; values?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const table = await resolveTable(body.table ?? "");
  if (!table) return NextResponse.json({ error: "unknown_table" }, { status: 404 });
  const values = body.values ?? {};

  const insert: Record<string, unknown> = {};
  for (const key of Object.keys(values)) {
    const col = hasColumn(table, key);
    if (!col) return NextResponse.json({ error: "unknown_column", detail: key }, { status: 400 });
    if (key === "id" || key === "created_at" || key === "updated_at") continue;
    if (values[key] === "" || values[key] === null || values[key] === undefined) continue;
    try {
      insert[key] = coerceValue(col, values[key]);
    } catch (e) {
      return NextResponse.json({ error: "invalid_value", detail: (e as Error).message }, { status: 400 });
    }
  }

  const supabase = createSupabaseServiceClient();
  const { data: created, error } = await supabase.from(table.name).insert(insert).select("*").maybeSingle();
  if (error) {
    return NextResponse.json({ error: "insert_failed", detail: error.message }, { status: 400 });
  }

  await recordAuditLog(supabase, {
    workspaceId: workspaceIdOf(created),
    actorProfileId: auth.userId,
    action: "operator.db.insert",
    targetType: table.name,
    targetId: created && typeof created.id === "string" ? created.id : null,
    metadata: { values: insert },
  });

  return NextResponse.json({ row: created });
}

/* ---------------------------- DELETE ---------------------------- */
export async function DELETE(request: NextRequest) {
  const auth = await requireOwnerOperator();
  if (!auth.ok) return auth.response;

  let body: { table?: string; ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const table = await resolveTable(body.table ?? "");
  if (!table) return NextResponse.json({ error: "unknown_table" }, { status: 404 });
  if (!hasColumn(table, "id")) return NextResponse.json({ error: "table_has_no_id" }, { status: 400 });
  const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : [];
  if (ids.length === 0) return NextResponse.json({ error: "no_ids" }, { status: 400 });

  const supabase = createSupabaseServiceClient();
  const { data: deleted, error } = await supabase.from(table.name).delete().in("id", ids).select("id, workspace_id");
  if (error) {
    return NextResponse.json({ error: "delete_failed", detail: error.message }, { status: 400 });
  }

  for (const row of deleted ?? []) {
    await recordAuditLog(supabase, {
      workspaceId: workspaceIdOf(row as Record<string, unknown>),
      actorProfileId: auth.userId,
      action: "operator.db.delete",
      targetType: table.name,
      targetId: typeof (row as Record<string, unknown>).id === "string" ? String((row as Record<string, unknown>).id) : null,
      metadata: {},
    });
  }

  return NextResponse.json({ deleted: (deleted ?? []).length });
}
