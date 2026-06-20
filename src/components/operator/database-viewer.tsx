/* eslint-disable @next/next/no-img-element */
"use client";

import { Columns3, Database, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  columnKind,
  detectMedia,
  READONLY_COLUMNS,
  type DbColumn,
  type DbTable,
} from "@/lib/operator/database-format";

type Row = Record<string, unknown>;
type Edits = Record<string, Record<string, string>>;
type Toast = { msg: string; err?: boolean } | null;

const DEFAULT_TABLE = "ai_runs";
const VISIBLE_DEFAULT = 8;

function pkName(table: DbTable): string {
  return table.columns.some((c) => c.name === "id") ? "id" : table.columns[0]?.name ?? "id";
}
function defaultVisible(table: DbTable): Set<string> {
  return new Set(table.columns.slice(0, VISIBLE_DEFAULT).map((c) => c.name));
}

const GREEN = ["completed", "active", "approved", "complete", "healthy", "success", "ready", "enabled", "true"];
const AMBER = ["pending", "waiting", "review", "draft", "queued", "building", "not_started", "processing", "running"];
const ROSE = ["failed", "error", "unavailable", "rejected", "blocked", "false", "expired"];
function statusTone(v: string): string {
  const s = v.toLowerCase();
  if (GREEN.some((x) => s.includes(x))) return "green";
  if (ROSE.some((x) => s.includes(x))) return "rose";
  if (AMBER.some((x) => s.includes(x))) return "amber";
  return "slate";
}

export function DatabaseViewer() {
  const [tables, setTables] = useState<DbTable[]>([]);
  const [tableName, setTableName] = useState<string>(DEFAULT_TABLE);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [schemaReady, setSchemaReady] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [orderBy, setOrderBy] = useState<string | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Edits>({});
  const [savingRows, setSavingRows] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{ rowId: string; col: string } | null>(null);

  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [colSearch, setColSearch] = useState("");
  const [toast, setToast] = useState<Toast>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string, err = false) => {
    setToast({ msg, err });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3800);
  }, []);

  const table = useMemo(() => tables.find((t) => t.name === tableName) ?? null, [tables, tableName]);
  const pk = table ? pkName(table) : "id";
  const hasId = !!table && table.columns.some((c) => c.name === "id");
  const dirtyCount = useMemo(
    () => Object.values(edits).reduce((a, r) => a + Object.keys(r).length, 0),
    [edits],
  );

  // ---- load schema ----
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/operator/database/schema", { cache: "no-store" });
        if (!res.ok) throw new Error(`schema ${res.status}`);
        const json = (await res.json()) as { tables: DbTable[] };
        setTables(json.tables);
        const start = json.tables.find((t) => t.name === DEFAULT_TABLE) ?? json.tables[0];
        if (start) {
          setTableName(start.name);
          setVisible(defaultVisible(start));
        }
        setSchemaReady(true);
      } catch {
        showToast("Failed to load database schema", true);
        setLoading(false);
      }
    })();
  }, [showToast]);

  // ---- debounce search ----
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ---- load rows ----
  const loadRows = useCallback(async () => {
    if (!tableName) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ table: tableName, limit: "100" });
      if (search) qs.set("search", search);
      if (orderBy) {
        qs.set("orderBy", orderBy);
        qs.set("dir", dir);
      }
      const res = await fetch(`/api/operator/database/rows?${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.detail ?? json?.error ?? `rows ${res.status}`);
      setRows(json.rows as Row[]);
      setCount(typeof json.count === "number" ? json.count : null);
    } catch (e) {
      setRows([]);
      setCount(null);
      showToast(`Read failed: ${(e as Error).message}`, true);
    } finally {
      setLoading(false);
    }
  }, [tableName, search, orderBy, dir, showToast]);

  useEffect(() => {
    if (schemaReady) loadRows();
  }, [schemaReady, loadRows]);

  // ---- table switch ----
  function switchTable(name: string) {
    if (dirtyCount > 0 && !window.confirm("Discard unsaved changes?")) return;
    const t = tables.find((x) => x.name === name);
    setTableName(name);
    setVisible(t ? defaultVisible(t) : new Set());
    setEdits({});
    setSelected(new Set());
    setOrderBy(null);
    setSearchInput("");
    setSearch("");
    setEditingCell(null);
  }

  // ---- edit helpers ----
  const rowId = (r: Row) => String(r[pk]);
  function cellValue(r: Row, col: string): string | null {
    const id = rowId(r);
    if (edits[id] && col in edits[id]) return edits[id][col];
    const v = r[col];
    return v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  function isDirty(id: string, col: string) {
    return !!edits[id] && col in edits[id];
  }
  function setEdit(id: string, col: string, value: string) {
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), [col]: value } }));
  }
  function clearEditsForRow(id: string) {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function editableCol(col: DbColumn, raw: unknown): boolean {
    if (!hasId) return false;
    if (READONLY_COLUMNS.has(col.name)) return false;
    const kind = columnKind(col.type);
    if (kind === "json" || kind === "array") return false;
    if (detectMedia(col.name, raw)) return false;
    return true;
  }

  // ---- save ----
  async function saveAll() {
    const ids = Object.keys(edits);
    if (ids.length === 0) return;
    setSavingRows(new Set(ids));
    let ok = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        const res = await fetch("/api/operator/database/rows", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ table: tableName, id, changes: edits[id] }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.detail ?? json?.error ?? `save ${res.status}`);
        setRows((prev) => prev.map((r) => (rowId(r) === id ? (json.row as Row) : r)));
        clearEditsForRow(id);
        ok += 1;
      } catch (e) {
        failed += 1;
        showToast(`Save failed for ${id.slice(0, 8)}: ${(e as Error).message}`, true);
      }
    }
    setSavingRows(new Set());
    if (failed === 0) showToast(`Saved ${ok} ${ok === 1 ? "row" : "rows"} to ${tableName}`);
  }

  function discardAll() {
    setEdits({});
    setEditingCell(null);
  }

  // ---- delete ----
  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Permanently delete ${ids.length} row(s) from ${tableName}? This cannot be undone.`)) return;
    try {
      const res = await fetch("/api/operator/database/rows", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ table: tableName, ids }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.detail ?? json?.error ?? `delete ${res.status}`);
      setSelected(new Set());
      showToast(`Deleted ${json.deleted} row(s) from ${tableName}`);
      loadRows();
    } catch (e) {
      showToast(`Delete failed: ${(e as Error).message}`, true);
    }
  }

  // ---- sorting ----
  function sortBy(col: string) {
    if (orderBy === col) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setOrderBy(col);
      setDir("asc");
    }
  }

  // ---- selection ----
  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (!hasId) return;
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map(rowId))));
  }

  const visibleColumns = useMemo(
    () => (table ? table.columns.filter((c) => visible.has(c.name)) : []),
    [table, visible],
  );
  const orderedCols = useMemo(() => {
    if (!table) return [] as DbColumn[];
    const pkCol = table.columns.find((c) => c.name === pk);
    const rest = visibleColumns.filter((c) => c.name !== pk);
    return pkCol ? [pkCol, ...rest] : rest;
  }, [table, visibleColumns, pk]);

  function renderCell(r: Row, col: DbColumn) {
    const id = rowId(r);
    const raw = r[col.name];
    const kind = columnKind(col.type);
    const editing = editingCell?.rowId === id && editingCell.col === col.name;
    const editable = editableCol(col, raw);

    if (editing) {
      const val = cellValue(r, col.name) ?? "";
      return (
        <input
          autoFocus
          defaultValue={val}
          onBlur={(e) => {
            if (e.target.value !== val) setEdit(id, col.name, e.target.value);
            setEditingCell(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditingCell(null);
          }}
        />
      );
    }

    const display = cellValue(r, col.name);
    const media = detectMedia(col.name, raw);
    if (media) {
      if (media.src && media.kind === "image") {
        return (
          <span className="dbv-thumb">
            <span className="dbv-thumb-wrap">
              <img src={media.src} alt={media.filename} loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} />
            </span>
            <span className="dbv-fname">{media.filename}</span>
          </span>
        );
      }
      if (media.src && media.kind === "video") {
        return (
          <span className="dbv-thumb">
            <span className="dbv-thumb-wrap">
              <video src={media.src} muted preload="metadata" />
              <span className="dbv-play">▶</span>
            </span>
            <span className="dbv-fname">{media.filename}</span>
          </span>
        );
      }
      return (
        <span className="dbv-filechip" title={String(raw)}>
          🖼 {media.filename}
        </span>
      );
    }

    const open = () => editable && setEditingCell({ rowId: id, col: col.name });

    let inner: ReactNode;
    if (display === null) inner = <span className="dbv-null">NULL</span>;
    else if (kind === "bool") {
      const on = display === "true";
      inner = (
        <span
          className={`dbv-bool ${on ? "on" : ""}`}
          onClick={() => hasId && !READONLY_COLUMNS.has(col.name) && setEdit(id, col.name, on ? "false" : "true")}
        >
          <span className="dbv-sw" />
          {display}
        </span>
      );
    } else if (kind === "json") inner = <span className="dbv-jbadge" title={display}>{"{ } json"}</span>;
    else if (kind === "array") inner = <span className="dbv-abadge" title={display}>[ array ]</span>;
    else if (kind === "uuid") inner = <span className="dbv-mono">{display}</span>;
    else if (kind === "int" || kind === "float") inner = <span className="dbv-mono">{display}</span>;
    else if (kind === "timestamp" || kind === "date") inner = <span className="dbv-muted">{display.replace("T", " ").slice(0, 19)}</span>;
    else if (col.name === "status" || col.name.endsWith("_status") || col.type === "USER-DEFINED" || col.name === "provider")
      inner = <span className={`dbv-tag ${statusTone(display)}`}>{display}</span>;
    else inner = display;

    return (
      <div className={`dbv-cell ${editable ? "dbv-editable" : ""}`} onClick={open}>
        {inner}
      </div>
    );
  }

  // ---- column picker groups ----
  const colGroups = useMemo(() => {
    if (!table) return [] as Array<{ group: string; cols: DbColumn[] }>;
    const q = colSearch.toLowerCase();
    const groups: Record<string, DbColumn[]> = { Identifiers: [], Relations: [], Data: [], Timestamps: [] };
    for (const c of table.columns) {
      if (q && !c.name.includes(q)) continue;
      let g = "Data";
      if (c.name === "id") g = "Identifiers";
      else if (c.type === "uuid" && c.name.endsWith("_id")) g = "Relations";
      else if (columnKind(c.type) === "timestamp" || columnKind(c.type) === "date" || c.name.endsWith("_at")) g = "Timestamps";
      groups[g].push(c);
    }
    return Object.entries(groups)
      .filter(([, cols]) => cols.length)
      .map(([group, cols]) => ({ group, cols }));
  }, [table, colSearch]);

  function toggleColumn(name: string) {
    if (name === pk) return;
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div className="dbv">
      <div className="dbv-banner">
        <b>Live · production</b> — reads and writes run against Supabase under the service role (operator-only). Editing
        is disabled for <code>id</code>, <code>created_at</code>, <code>updated_at</code>, JSON and array columns. Every
        save and delete is written to <code>audit_logs</code>.
      </div>

      <div className="dbv-toolbar">
        <Database size={16} color="var(--accent)" />
        <select
          className="dbv-select"
          value={tableName}
          onChange={(e) => switchTable(e.target.value)}
          aria-label="Table"
        >
          {tables.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name} ({t.columns.length} cols · {t.approx_rows < 0 ? "?" : t.approx_rows} rows)
            </option>
          ))}
        </select>
        <span className="dbv-count">
          <b>{rows.length}</b> loaded{count != null ? ` · ~${count} total` : ""}
        </span>

        <div className="dbv-search">
          <Search size={15} />
          <input placeholder="Search text columns…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>

        <button className="dbv-btn" onClick={() => loadRows()} title="Reload">
          <RefreshCw size={14} /> Reload
        </button>

        <div style={{ position: "relative" }}>
          <button className="dbv-btn" onClick={() => setColPickerOpen((o) => !o)}>
            <Columns3 size={14} /> Columns <span className="dbv-badge">{visible.size}/{table?.columns.length ?? 0}</span>
          </button>
          {colPickerOpen && table ? (
            <div className="dbv-pop" style={{ right: 0, top: "calc(100% + 6px)" }}>
              <div className="dbv-pop-search">
                <input placeholder="Search fields…" value={colSearch} onChange={(e) => setColSearch(e.target.value)} autoFocus />
              </div>
              <div className="dbv-pop-list">
                {colGroups.map(({ group, cols }) => (
                  <div key={group}>
                    <div className="dbv-pgroup">{group}</div>
                    {cols.map((c) => {
                      const locked = c.name === pk;
                      return (
                        <label key={c.name} className={`dbv-prow ${locked ? "locked" : ""}`}>
                          <input
                            type="checkbox"
                            className="dbv-checkbox"
                            checked={visible.has(c.name)}
                            disabled={locked}
                            onChange={() => toggleColumn(c.name)}
                          />
                          <span>{c.name}</span>
                          <span className="dbv-pc-type">{c.type}</span>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="dbv-pop-foot">
                <span>
                  {visible.size} of {table.columns.length} shown
                </span>
                <button className="dbv-link" onClick={() => setVisible(defaultVisible(table))}>
                  Reset to default
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="dbv-spacer" />

        {dirtyCount > 0 ? (
          <>
            <span className="dbv-changes">
              {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}
            </span>
            <button className="dbv-btn ghost" onClick={discardAll}>
              Discard
            </button>
          </>
        ) : null}
        <button className="dbv-btn primary" onClick={saveAll} disabled={dirtyCount === 0 || savingRows.size > 0}>
          {savingRows.size > 0 ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="dbv-gridwrap">
        {loading ? (
          <div className="dbv-loading">Loading {tableName}…</div>
        ) : rows.length === 0 ? (
          <div className="dbv-empty">
            No rows in <b>{tableName}</b>
            {search ? " for this search" : ""}.
          </div>
        ) : (
          <table className="dbv-grid">
            <thead>
              <tr>
                <th className="dbv-check">
                  <input
                    type="checkbox"
                    className="dbv-checkbox"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={toggleAll}
                    disabled={!hasId}
                  />
                </th>
                {orderedCols.map((c) => (
                  <th key={c.name} className={c.name === pk ? "dbv-pkcol" : ""}>
                    <div className="dbv-th">
                      <span className={c.name === pk ? "dbv-pk" : ""}>{c.name}</span>
                      {c.name === pk ? <span className="dbv-ctype dbv-pk">PK</span> : null}
                      {!c.nullable && c.name !== pk ? <span className="dbv-req">•</span> : null}
                      <span className="dbv-ctype">{c.type === "timestamp with time zone" ? "timestamptz" : c.type}</span>
                      <button className={`dbv-sort ${orderBy === c.name ? "on" : ""}`} onClick={() => sortBy(c.name)} title="Sort">
                        {orderBy === c.name ? (dir === "asc" ? "▲" : "▼") : "↕"}
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const id = rowId(r);
                const sel = selected.has(id);
                const saving = savingRows.has(id);
                return (
                  <tr key={id} className={sel ? "sel" : ""}>
                    <td className="dbv-check">
                      <input
                        type="checkbox"
                        className="dbv-checkbox"
                        checked={sel}
                        onChange={() => toggleRow(id)}
                        disabled={!hasId}
                      />
                    </td>
                    {orderedCols.map((c) => (
                      <td
                        key={c.name}
                        className={`${c.name === pk ? "dbv-pkcol " : ""}${editableCol(c, r[c.name]) ? "dbv-editable " : ""}${
                          isDirty(id, c.name) ? "dbv-dirty " : ""
                        }${saving ? "dbv-saving" : ""}`}
                      >
                        {c.name === pk ? <div className="dbv-cell">{renderCell(r, c)}</div> : renderCell(r, c)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected.size > 0 ? (
        <div className="dbv-bulk">
          <span>
            <b>{selected.size}</b> selected
          </span>
          <button className="dbv-bb danger" onClick={deleteSelected}>
            <Trash2 size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            Delete
          </button>
          <button className="dbv-bb-x" onClick={() => setSelected(new Set())}>
            ✕
          </button>
        </div>
      ) : null}

      {toast ? (
        <div className={`dbv-toast ${toast.err ? "err" : ""}`}>
          <span>{toast.msg}</span>
          <button className="dbv-toast-x" onClick={() => setToast(null)}>
            ✕
          </button>
        </div>
      ) : null}
    </div>
  );
}
