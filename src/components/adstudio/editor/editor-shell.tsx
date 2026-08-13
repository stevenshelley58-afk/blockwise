"use client";

import { useCallback } from "react";
import type { TemplatePack, Placement, LayoutLayer } from "../../../../packages/ad-template-pack-contract/src/types.js";
import { buildAdDocument, useEditorState } from "./use-editor-state.js";

// ---------------------------------------------------------------------------
// Editor Shell — Phase 6 foundation
//
// Feed and Story tabs, Konva layered canvas placeholder, layer selection,
// undo/redo, dirty/saved/error state. Full Konva implementation + Impeccable
// review pending browser inspection. Save persists the AdDocument through
// POST /api/adstudio/ads/[id]/save — the server renders Feed AND Story PNGs.
// ---------------------------------------------------------------------------

export interface EditorShellProps {
  pack: TemplatePack;
  /** Customer ad row the document saves against (created server-side). */
  adId: string;
  /** Workspace scope for the Save API call. */
  workspaceId: string;
  /** Whether Save is enabled. */
  canSave?: boolean;
}

export function EditorShell({ pack, adId, workspaceId, canSave = true }: EditorShellProps) {
  const {
    state,
    activeLayout,
    canUndo,
    canRedo,
    setActivePlacement,
    selectLayer,
    undo,
    redo,
    markSaved,
    setSaving,
    setError,
  } = useEditorState(pack);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const document = await buildAdDocument(state);
      const res = await fetch(
        `/api/adstudio/ads/${encodeURIComponent(adId)}/save?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document, expectedRevision: state.lastSavedRevision ?? 0 }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { ad?: { revisionNumber?: number }; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Save failed (${res.status})`);
      markSaved(body.ad?.revisionNumber ?? state.lastSavedRevision ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [adId, workspaceId, state, markSaved, setSaving, setError]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    if (e.key === "Escape") {
      selectLayer(null);
    }
  }, [undo, redo, selectLayer]);

  return (
    <div
      className="flex h-full flex-col bg-(--canvas)"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label="Ad Studio editor"
    >
      {/* Top bar: tabs + actions */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-(--line) bg-(--surface) px-5">
        <div className="flex items-center gap-1">
          {(["feed", "story"] as Placement[]).map(p => (
            <button
              key={p}
              onClick={() => setActivePlacement(p)}
              className={`rounded-(--r-control) px-4 py-2 text-sm font-medium transition ${
                state.activePlacement === p
                  ? "bg-(--ui-primary) text-white"
                  : "text-muted-foreground hover:bg-(--surface-subtle)"
              }`}
              aria-pressed={state.activePlacement === p}
            >
              {p === "feed" ? "Feed (1080×1350)" : "Story (1080×1920)"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {state.isDirty && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
          {state.lastSavedRevision !== null && !state.isDirty && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          <button
            onClick={undo}
            disabled={!canUndo}
            className="rounded-(--r-control) p-2 text-muted-foreground hover:bg-(--surface-subtle) disabled:opacity-30"
            aria-label="Undo"
          >
            ↩
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="rounded-(--r-control) p-2 text-muted-foreground hover:bg-(--surface-subtle) disabled:opacity-30"
            aria-label="Redo"
          >
            ↪
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || state.isSaving}
            className="rounded-(--r-control) bg-(--ui-primary) px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {state.isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </header>

      {/* Main area: layer panel + canvas */}
      <div className="flex min-h-0 flex-1">
        {/* Layer panel */}
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-(--line) bg-(--surface) p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Layers
          </h3>
          <ul className="space-y-1">
            {[...activeLayout.layers].reverse().map(layer => (
              <li key={layer.layerId}>
                <button
                  onClick={() => selectLayer(layer.layerId)}
                  className={`w-full rounded-(--r-control) px-3 py-2 text-left text-sm transition ${
                    state.selectedLayerId === layer.layerId
                      ? "bg-(--ui-primary)/10 text-(--ui-primary) ring-1 ring-(--ui-primary)/30"
                      : "text-foreground hover:bg-(--surface-subtle)"
                  }`}
                >
                  <span className="text-xs text-muted-foreground">{layerTypeLabel(layer.type)}</span>
                  <span className="ml-2">{layerLabel(layer)}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Canvas area */}
        <main className="flex flex-1 items-center justify-center bg-(--surface-subtle) p-6">
          <div
            className="relative rounded-(--r-card) bg-white shadow-lg"
            style={{ aspectRatio: activeLayout.layers[0]?.type === "plate"
              ? `${(activeLayout.layers[0] as any).geometry?.width ?? 1080} / ${(activeLayout.layers[0] as any).geometry?.height ?? 1350}`
              : "1080 / 1350",
              maxHeight: "min(72vh, 800px)",
              maxWidth: "90%",
            }}
          >
            {/* Placeholder — full Konva canvas in next iteration */}
            <div className="flex h-full w-full items-center justify-center rounded-(--r-card) bg-gray-100 text-sm text-muted-foreground">
              <div className="text-center">
                <p className="font-medium">Canvas placeholder</p>
                <p className="text-xs">{state.activePlacement === "feed" ? "1080×1350" : "1080×1920"}</p>
                <p className="mt-2 text-xs">{activeLayout.layers.length} layers</p>
                <p className="text-xs text-muted-foreground">
                  {state.selectedLayerId
                    ? `Selected: ${state.selectedLayerId}`
                    : "Select a layer to edit"}
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Error banner */}
      {state.error && (
        <div
          className="border-t border-red-200 bg-red-50 px-5 py-2 text-sm text-red-700"
          role="alert"
        >
          {state.error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function layerTypeLabel(type: LayoutLayer["type"]): string {
  switch (type) {
    case "plate": return "BG";
    case "image_slot": return "IMG";
    case "overlay_patch": return "FX";
    case "text": return "TXT";
    case "logo": return "LOG";
  }
}

function layerLabel(layer: LayoutLayer): string {
  switch (layer.type) {
    case "plate": return "Background";
    case "image_slot": return layer.inputKey;
    case "overlay_patch": return `Overlay ${Math.round(layer.opacity * 100)}%`;
    case "text": return layer.inputKey;
    case "logo": return layer.inputKey;
  }
}
