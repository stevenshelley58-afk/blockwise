"use client";

import { useState, useCallback, useRef } from "react";
import type { TemplatePack, Layout, LayoutLayer, Placement, Rect, ColourRole } from "../../../../packages/ad-template-pack-contract/src/types.js";
import type { AdDocumentParsed } from "../../../../packages/ad-template-pack-contract/src/schema.js";

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

// ---------------------------------------------------------------------------
// AdDocument builder — client-safe (Web Crypto, no node:crypto).
// Matches the server's canonical-JSON hashing so document_hash is meaningful.
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key: string, v: unknown) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}

async function sha256HexClient(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Build the AdDocument v1 described by the editor's current state. */
export async function buildAdDocument(state: EditorState): Promise<AdDocumentParsed> {
  const pack = state.pack;
  const doc = {
    schema: "blockwise.ad-document/v1" as const,
    templateId: pack.templateId,
    templateVersion: pack.version,
    templateHash: pack.manifestSha256,
    rendererVersion: pack.rendererVersion,
    sharedImageValues: {},
    sharedTextValues: { ...state.textValues },
    feedCropOverrides: {},
    storyCropOverrides: {},
    colourMode: state.colourMode,
    resolvedColourMap: { ...state.resolvedColourMap },
    metaPrimaryText: "",
    metaHeadline: "",
    metaDescription: "",
    metaCta: "LEARN_MORE",
    revision: Math.max(1, state.lastSavedRevision ?? 0),
    documentHash: "0".repeat(64),
    lastRenderedHash: null,
  };
  return { ...doc, documentHash: await sha256HexClient(doc) };
}
