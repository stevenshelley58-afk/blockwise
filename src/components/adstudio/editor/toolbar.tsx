"use client";

// Editor toolbar (Track A, §7): undo/redo, format switch, zoom, Advanced
// toggle (persisted per user), save-state chip. shadcn primitives only.

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EditorMode } from "@/lib/adstudio/v2/editor-state.ts";

const ADVANCED_STORAGE_KEY = "adstudio-editor-advanced";

export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  format,
  onFormatChange,
  hasStory,
  mode,
  onModeChange,
  advancedUnlockable,
  saving,
  dirty,
  zoom,
  onZoomChange,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  format: "4:5" | "9:16";
  onFormatChange: (format: "4:5" | "9:16") => void;
  hasStory: boolean;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  advancedUnlockable: boolean;
  saving: boolean;
  dirty: boolean;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}) {
  const [persistedAdvanced, setPersistedAdvanced] = useState(false);
  useEffect(() => {
    try {
      setPersistedAdvanced(localStorage.getItem(ADVANCED_STORAGE_KEY) === "1");
    } catch {
      // private mode etc. — toolbar still works per session.
    }
  }, []);

  const effectiveMode: EditorMode = mode === "studio" ? "studio" : persistedAdvanced ? "advanced" : "guided";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line-soft,#2a313b)] px-3 py-2">
      <Button size="sm" variant="ghost" disabled={!canUndo} onClick={onUndo} aria-label="Undo">Undo</Button>
      <Button size="sm" variant="ghost" disabled={!canRedo} onClick={onRedo} aria-label="Redo">Redo</Button>
      <div className="mx-1 h-5 w-px bg-[var(--line-soft,#2a313b)]" aria-hidden />
      <Button size="sm" variant="ghost" onClick={() => onZoomChange(Math.max(1, zoom - 0.25))} aria-label="Zoom out">−</Button>
      <span className="min-w-10 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
      <Button size="sm" variant="ghost" onClick={() => onZoomChange(Math.min(3, zoom + 0.25))} aria-label="Zoom in">+</Button>
      {hasStory ? (
        <Tabs value={format} onValueChange={(value) => onFormatChange(value as "4:5" | "9:16")}>
          <TabsList>
            <TabsTrigger value="4:5">Feed</TabsTrigger>
            <TabsTrigger value="9:16">Story</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-[var(--muted,#8a94a3)]" aria-live="polite">
          {saving ? "Saving…" : dirty ? "Unsaved" : "Saved"}
        </span>
        {advancedUnlockable && mode !== "studio" ? (
          <Button
            size="sm"
            variant={effectiveMode === "advanced" ? "default" : "outline"}
            onClick={() => {
              const next = effectiveMode !== "advanced";
              try {
                localStorage.setItem(ADVANCED_STORAGE_KEY, next ? "1" : "0");
              } catch {
                // ignore
              }
              setPersistedAdvanced(next);
              onModeChange(next ? "advanced" : "guided");
            }}
          >
            Advanced
          </Button>
        ) : null}
      </div>
    </div>
  );
}
