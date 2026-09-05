"use client";

import { useState, useCallback, useRef } from "react";
import type { TemplatePack, Layout, LayoutLayer, Placement, Rect, ColourRole } from "../../../../packages/ad-template-pack-contract/src/types.ts";

// ---------------------------------------------------------------------------
// Editor state — Phase 6 foundation
// ---------------------------------------------------------------------------

export interface EditorImageValue {
  inputKey: string;
  /** Uploaded image buffer (for rendering). */
  buffer: Buffer | null;
  /** Crop override for the current placement. */
  crop?: Rect;
}

export interface EditorState {
  pack: TemplatePack;
  activePlacement: Placement;
  imageValues: EditorImageValue[];
  textValues: Record<string, string>;
  colourMode: "template" | "brand_pack";
  resolvedColourMap: Record<ColourRole, string>;
  selectedLayerId: string | null;
  isDirty: boolean;
  isSaving: boolean;
  lastSavedRevision: number | null;
  error: string | null;
}

const initialState = (pack: TemplatePack): EditorState => ({
  pack,
  activePlacement: "feed",
  imageValues: pack.imageInputs.map(i => ({ inputKey: i.key, buffer: null })),
  textValues: Object.fromEntries(pack.textInputs.map(i => [i.key, ""])),
  colourMode: "template",
  resolvedColourMap: { ...pack.semanticColours },
  selectedLayerId: null,
  isDirty: false,
  isSaving: false,
  lastSavedRevision: null,
  error: null,
});

export function useEditorState(pack: TemplatePack) {
  const [state, setState] = useState<EditorState>(() => initialState(pack));
  const undoStack = useRef<EditorState[]>([]);
  const redoStack = useRef<EditorState[]>([]);

  const pushUndo = useCallback((prev: EditorState) => {
    undoStack.current.push(prev);
    redoStack.current = [];
  }, []);

  const setActivePlacement = useCallback((placement: Placement) => {
    setState(prev => ({ ...prev, activePlacement: placement }));
  }, []);

  const selectLayer = useCallback((layerId: string | null) => {
    setState(prev => ({ ...prev, selectedLayerId: layerId }));
  }, []);

  const updateTextValue = useCallback((key: string, value: string) => {
    setState(prev => {
      pushUndo(prev);
      return {
        ...prev,
        textValues: { ...prev.textValues, [key]: value },
        isDirty: true,
      };
    });
  }, [pushUndo]);

  const updateImageValue = useCallback((key: string, buffer: Buffer | null) => {
    setState(prev => {
      pushUndo(prev);
      return {
        ...prev,
        imageValues: prev.imageValues.map(iv =>
          iv.inputKey === key ? { ...iv, buffer } : iv
        ),
        isDirty: true,
      };
    });
  }, [pushUndo]);

  const updateCrop = useCallback((key: string, crop: Rect) => {
    setState(prev => {
      pushUndo(prev);
      return {
        ...prev,
        imageValues: prev.imageValues.map(iv =>
          iv.inputKey === key ? { ...iv, crop } : iv
        ),
        isDirty: true,
      };
    });
  }, [pushUndo]);

  const setColourMode = useCallback((mode: "template" | "brand_pack", colourMap?: Record<ColourRole, string>) => {
    setState(prev => {
      pushUndo(prev);
      return {
        ...prev,
        colourMode: mode,
        resolvedColourMap: colourMap ?? (mode === "template" ? { ...prev.pack.semanticColours } : prev.resolvedColourMap),
        isDirty: true,
      };
    });
  }, [pushUndo]);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (prev) {
      redoStack.current.push(state);
      setState(prev);
    }
  }, [state]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (next) {
      undoStack.current.push(state);
      setState(next);
    }
  }, [state]);

  const markSaved = useCallback((revision: number) => {
    setState(prev => ({
      ...prev,
      isDirty: false,
      isSaving: false,
      lastSavedRevision: revision,
    }));
  }, []);

  const setSaving = useCallback((saving: boolean) => {
    setState(prev => ({ ...prev, isSaving: saving }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState(prev => ({ ...prev, error }));
  }, []);

  const activeLayout: Layout = state.activePlacement === "feed" ? state.pack.feedLayout : state.pack.storyLayout;

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  return {
    state,
    activeLayout,
    canUndo,
    canRedo,
    setActivePlacement,
    selectLayer,
    updateTextValue,
    updateImageValue,
    updateCrop,
    setColourMode,
    undo,
    redo,
    markSaved,
    setSaving,
    setError,
  };
}
