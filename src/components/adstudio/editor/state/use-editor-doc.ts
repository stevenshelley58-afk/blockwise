"use client";

// Editor hook (Track A, §7): useReducer over AdDocInstance with the shared
// pure reducer from lib, plus mode state and debounced autosave. The Konva
// canvas and panels consume this; undo/redo always succeed (no-op at ends).

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { AdDocInstance, AdTemplateDocV2 } from "@/lib/adstudio/v2/template-doc";
import {
  makeEditorReducer,
  type EditorAction,
  type EditorMode,
} from "@/lib/adstudio/v2/editor-state.ts";

export function useEditorDoc({
  template,
  instance: initialInstance,
  mode: initialMode = "guided",
  brandPalette = [],
  onSave,
  saveDelayMs = 800,
}: {
  template: AdTemplateDocV2;
  instance: AdDocInstance;
  mode?: EditorMode;
  brandPalette?: string[];
  onSave?: (instance: AdDocInstance) => Promise<void> | void;
  saveDelayMs?: number;
}) {
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [state, dispatch] = useReducer(makeEditorReducer(template, brandPalette), {
    instance: initialInstance,
    past: [],
    future: [],
    lastGesture: null,
    denied: null,
  });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  const edit = useCallback(
    (action: EditorAction, gestureId = `g${Math.random().toString(36).slice(2)}`) =>
      dispatch({ kind: "edit", action, mode, gestureId }),
    [mode],
  );
  const undo = useCallback(() => dispatch({ kind: "undo" }), []);
  const redo = useCallback(() => dispatch({ kind: "redo" }), []);

  // Debounced autosave on any committed instance change (skip the mount render).
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setDirty(true);
    if (!onSave) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await onSave(state.instance);
        setDirty(false);
      } finally {
        setSaving(false);
      }
    }, saveDelayMs);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state.instance, onSave, saveDelayMs]);

  return useMemo(
    () => ({
      instance: state.instance,
      mode,
      setMode,
      denied: state.denied,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      undo,
      redo,
      edit,
      saving,
      dirty,
    }),
    [state.instance, state.denied, state.past.length, state.future.length, mode, undo, redo, edit, saving, dirty],
  );
}
