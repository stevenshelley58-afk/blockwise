"use client";

import { useState, useCallback, useRef } from "react";
import type { TemplatePack, Layout, LayoutLayer, Placement, Rect, ColourRole } from "../../../../packages/ad-template-pack-contract/src/types";
import type { AdDocumentParsed } from "../../../../packages/ad-template-pack-contract/src/schema";

// ---------------------------------------------------------------------------
// Editor state — Phase 6 foundation
// ---------------------------------------------------------------------------

export interface EditorImageValue {
  inputKey: string;
  /**
   * Session-local data URL of the picked image.
   * Doubles as the browser preview AND the value Save sends: the save route
   * fetches document.sharedImageValues URLs server-side, and data: URLs are
   * fetchable there, so the renderer receives real image buffers. No upload
   * library yet — the image never leaves the client except as base64 in the
   * document (see inputs-panel "session only" label).
   */
  dataUrl: string | null;
  /**
   * Per-placement crop overrides, normalized to [0,1] over the source image
   * (matching the renderer's cropOverrides contract, keyed by input key).
   * Feed and Story keep SEPARATE rects — one image, two crops.
   */
  crops: Partial<Record<Placement, Rect>>;
}

/** Meta feed copy — one shared set of values for every placement. */
export interface MetaCopy {
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
}

export interface EditorTextInput {
  key: string;
  label: string;
  placeholder: string;
  maxLength: number;
}

type PackEditorDefaults = {
  textInputs: EditorTextInput[];
  textValues: Record<string, string>;
  metaCopy: Partial<MetaCopy>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function readEditorDefaults(pack: TemplatePack): PackEditorDefaults {
  const raw = pack as unknown as Record<string, unknown>;
  const metadata = isRecord(raw.metadata) ? raw.metadata : {};
  const metaCopyDefaults = isRecord(metadata.metaCopyDefaults) ? metadata.metaCopyDefaults : {};
  const guidance = isRecord(metadata.aiWritingGuidance) ? metadata.aiWritingGuidance : {};
  const defaults = Object.keys(metadata).length > 0
    ? { overlayTextInputs: [], textValues: {}, metaCopy: {
      primaryText: Array.isArray(metaCopyDefaults.primaryText) ? metaCopyDefaults.primaryText[0] : undefined,
      headline: Array.isArray(metaCopyDefaults.headlines) ? metaCopyDefaults.headlines[0] : undefined,
      description: Array.isArray(metaCopyDefaults.descriptions) ? metaCopyDefaults.descriptions[0] : undefined,
      cta: typeof metaCopyDefaults.cta === "string" ? metaCopyDefaults.cta : undefined,
    }, aiWritingGuidance: guidance }
    : isRecord(raw.editorDefaults)
      ? raw.editorDefaults
      : isRecord(raw.v2) ? raw.v2 : {};
  const rawInputs = Array.isArray(defaults.overlayTextInputs) ? defaults.overlayTextInputs : [];
  const textInputs = rawInputs.flatMap((value): EditorTextInput[] => {
    if (!isRecord(value) || typeof value.key !== "string") return [];
    return [{
      key: value.key,
      label: typeof value.label === "string" ? value.label : value.key,
      placeholder: typeof value.placeholder === "string" ? value.placeholder : "",
      maxLength: typeof value.maxLength === "number" && value.maxLength > 0 ? Math.floor(value.maxLength) : 120,
    }];
  });
  const rawValues = isRecord(defaults.textValues) ? defaults.textValues : {};
  const textValues = Object.fromEntries(Object.entries(rawValues).filter(([, value]) => typeof value === "string")) as Record<string, string>;
  const rawMeta: Record<string, unknown> = isRecord(defaults.metaCopy) ? defaults.metaCopy : {
    ...metaCopyDefaults,
    headline: Array.isArray(metaCopyDefaults.headlines) ? metaCopyDefaults.headlines[0] : undefined,
    description: Array.isArray(metaCopyDefaults.descriptions) ? metaCopyDefaults.descriptions[0] : undefined,
    primaryText: Array.isArray(metaCopyDefaults.primaryText) ? metaCopyDefaults.primaryText[0] : undefined,
  };
  const metaCopy: Partial<MetaCopy> = {};
  for (const field of ["primaryText", "headline", "description", "cta"] as const) {
    if (typeof rawMeta[field] === "string") metaCopy[field] = rawMeta[field] as string;
  }
  return { textInputs, textValues, metaCopy };
}

export function editorTextInputs(pack: TemplatePack): EditorTextInput[] {
  const defaults = readEditorDefaults(pack);
  const existing = new Set(pack.textInputs.map(input => input.key));
  return [...pack.textInputs, ...defaults.textInputs.filter(input => !existing.has(input.key))];
}

export interface EditorState {
  pack: TemplatePack;
  activePlacement: Placement;
  imageValues: EditorImageValue[];
  textValues: Record<string, string>;
  colourMode: "template" | "brand_pack" | "custom";
  resolvedColourMap: Record<ColourRole, string>;
  selectedLayerId: string | null;
  isDirty: boolean;
  isSaving: boolean;
  lastSavedRevision: number | null;
  error: string | null;
  /** Meta primary text / headline / description / CTA (shared across placements). */
  metaCopy: MetaCopy;
}

/**
 * Saved-document seed loaded server-side for an EXISTING ad. New ads pass
 * null and start with empty placeholder text — template copy is only ever
 * inserted by an explicit "Use template copy" click, and saved customer copy
 * is never erased on reopen.
 */
export interface SavedEditorSeed {
  textValues: Record<string, string>;
  metaCopy: MetaCopy;
  colourMode: EditorState["colourMode"];
  resolvedColourMap: Record<ColourRole, string> | null;
  lastSavedRevision: number;
}

/**
 * The editor's starting state. Exported for tests: a new ad (saved = null)
 * starts with EMPTY placeholders; an existing ad restores its saved values.
 */
export function initialEditorState(pack: TemplatePack, saved?: SavedEditorSeed | null): EditorState {
  const emptyTextValues = Object.fromEntries(pack.textInputs.map(i => [i.key, ""]));
  const savedMeta = saved?.metaCopy;
  return {
  pack,
  activePlacement: "feed",
  imageValues: pack.imageInputs.map(i => ({ inputKey: i.key, dataUrl: null, crops: {} })),
  // New ads start EMPTY (placeholders only) — never auto-insert template copy.
  // Saved ads restore exactly what the customer last saved.
  textValues: saved ? { ...emptyTextValues, ...saved.textValues } : emptyTextValues,
  colourMode: saved?.colourMode ?? "template",
  resolvedColourMap: saved?.resolvedColourMap ?? { ...pack.semanticColours },
  selectedLayerId: null,
  isDirty: false,
  isSaving: false,
  lastSavedRevision: saved?.lastSavedRevision ?? null,
  error: null,
  metaCopy: {
    primaryText: savedMeta?.primaryText ?? "",
    headline: savedMeta?.headline ?? "",
    description: savedMeta?.description ?? "",
    // CTA keeps a sensible default even for new ads so the select is valid.
    cta: "LEARN_MORE",
    ...(savedMeta?.cta ? { cta: savedMeta.cta } : {}),
  },
  };
}

export function useEditorState(pack: TemplatePack, saved?: SavedEditorSeed | null) {
  const [state, setState] = useState<EditorState>(() => initialEditorState(pack, saved));
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

  const updateImageValue = useCallback((key: string, dataUrl: string | null) => {
    setState(prev => {
      pushUndo(prev);
      return {
        ...prev,
        imageValues: prev.imageValues.map(iv =>
          iv.inputKey === key ? { ...iv, dataUrl } : iv
        ),
        isDirty: true,
      };
    });
  }, [pushUndo]);

  const updateCrop = useCallback((key: string, placement: Placement, crop: Rect) => {
    setState(prev => {
      pushUndo(prev);
      return {
        ...prev,
        imageValues: prev.imageValues.map(iv =>
          iv.inputKey === key ? { ...iv, crops: { ...iv.crops, [placement]: crop } } : iv
        ),
        isDirty: true,
      };
    });
  }, [pushUndo]);

  /** Update one Meta copy field (primary text, headline, description, CTA). */
  const updateMetaCopy = useCallback((field: keyof MetaCopy, value: string) => {
    setState(prev => {
      pushUndo(prev);
      return {
        ...prev,
        metaCopy: { ...prev.metaCopy, [field]: value },
        isDirty: true,
      };
    });
  }, [pushUndo]);

  const setColourMode = useCallback((mode: EditorState["colourMode"], colourMap?: Record<ColourRole, string>) => {
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

  /** Update one custom colour role while in custom mode. */
  const updateCustomColour = useCallback((role: ColourRole, hex: string) => {
    setState(prev => {
      pushUndo(prev);
      return {
        ...prev,
        colourMode: "custom",
        resolvedColourMap: { ...prev.resolvedColourMap, [role]: hex },
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

  /**
   * "Use template copy" — fills EMPTY fields with the template's suggested
   * copy in one undoable step. Saved or typed customer copy is preserved.
   */
  const useTemplateCopy = useCallback(() => {
    setState(prev => {
      pushUndo(prev);
      const merged = applyTemplateCopy(prev.textValues, prev.metaCopy, prev.pack);
      return {
        ...prev,
        textValues: merged.textValues,
        metaCopy: merged.metaCopy,
        isDirty: true,
      };
    });
  }, [pushUndo]);

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
    updateCustomColour,
    useTemplateCopy,
    undo,
    redo,
    markSaved,
    setSaving,
    setError,
    updateMetaCopy,
  };
}

// ---------------------------------------------------------------------------
// Colour mode resolution — template palette vs workspace Brand Pack.
// The editor page loads the workspace's latest Brand Pack server-side and
// passes its `colours` block in. Roles the brand kit has no field for
// (inverseText) stay on the template value — we never invent a palette.
// ---------------------------------------------------------------------------

/** Brand Pack colour fields that map onto template colour roles. */
export interface BrandPackColours {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

const BRAND_PACK_ROLE_MAP: Record<keyof BrandPackColours, ColourRole> = {
  background: "background",
  primary: "primary",
  secondary: "secondary",
  accent: "accent",
  text: "mainText",
};

const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Map a Brand Pack `colours` block onto template colour roles (partial). */
export function brandPackColoursToRoleMap(
  colours: BrandPackColours | null | undefined,
): Partial<Record<ColourRole, string>> {
  const map: Partial<Record<ColourRole, string>> = {};
  if (!colours) return map;
  for (const [field, role] of Object.entries(BRAND_PACK_ROLE_MAP) as [keyof BrandPackColours, ColourRole][]) {
    const hex = colours[field];
    if (typeof hex === "string" && HEX_COLOUR.test(hex.trim())) {
      map[role] = hex.trim();
    }
  }
  return map;
}

/**
 * Resolve the render palette for a colour mode: brand roles override the
 * template palette, roles missing from the brand kit (e.g. inverseText)
 * keep the template value. Custom mode uses the customer's per-role palette
 * verbatim. Never invents a palette.
 */
export function resolveColourMap(
  templateColours: Record<ColourRole, string>,
  mode: EditorState["colourMode"],
  brandColourMap?: Partial<Record<ColourRole, string>> | null,
  customColourMap?: Partial<Record<ColourRole, string>> | null,
): Record<ColourRole, string> {
  if (mode === "brand_pack" && brandColourMap) {
    return { ...templateColours, ...brandColourMap };
  }
  if (mode === "custom" && customColourMap) {
    return { ...templateColours, ...customColourMap };
  }
  return { ...templateColours };
}

// ---------------------------------------------------------------------------
// Template copy — the pack's suggested overlay text and Meta copy. New ads
// start EMPTY; an explicit "Use template copy" click fills EMPTY fields only,
// so saved customer copy is never erased. Populated fields stay editable.
// ---------------------------------------------------------------------------

export interface TemplateCopyValues {
  textValues: Record<string, string>;
  metaCopy: MetaCopy;
}

/** The template's suggested copy, read from the portable defaults. */
export function templateCopyValues(pack: TemplatePack): TemplateCopyValues {
  const defaults = readEditorDefaults(pack);
  return {
    textValues: { ...defaults.textValues },
    metaCopy: {
      primaryText: defaults.metaCopy.primaryText ?? "",
      headline: defaults.metaCopy.headline ?? "",
      description: defaults.metaCopy.description ?? "",
      cta: defaults.metaCopy.cta ?? "LEARN_MORE",
    },
  };
}

/** True when the template offers any copy worth inserting. */
export function hasTemplateCopy(pack: TemplatePack): boolean {
  const { textValues, metaCopy } = templateCopyValues(pack);
  const hasText = Object.values(textValues).some(value => value.trim().length > 0);
  const hasMeta = [metaCopy.primaryText, metaCopy.headline, metaCopy.description].some(value => value.trim().length > 0);
  return hasText || hasMeta;
}

/**
 * Merge template copy into the current values, filling ONLY empty fields.
 * Customer copy — saved or freshly typed — is never overwritten.
 */
export function applyTemplateCopy(
  currentTextValues: Record<string, string>,
  currentMetaCopy: MetaCopy,
  pack: TemplatePack,
): { textValues: Record<string, string>; metaCopy: MetaCopy } {
  const template = templateCopyValues(pack);
  const textValues = { ...currentTextValues };
  for (const [key, value] of Object.entries(template.textValues)) {
    if (!(key in textValues) || textValues[key].trim() === "") textValues[key] = value;
  }
  const metaCopy = { ...currentMetaCopy };
  for (const field of ["primaryText", "headline", "description"] as const) {
    if (metaCopy[field].trim() === "") metaCopy[field] = template.metaCopy[field];
  }
  // CTA is a selection — only filled when the customer has not chosen one.
  if (metaCopy.cta.trim() === "") metaCopy.cta = template.metaCopy.cta;
  return { textValues, metaCopy };
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
    sharedImageValues: Object.fromEntries(
      state.imageValues
        .filter(iv => iv.dataUrl !== null)
        .map(iv => [iv.inputKey, iv.dataUrl as string]),
    ),
    sharedTextValues: { ...state.textValues },
    // Per-placement crop overrides, keyed by input key, normalized [0,1]
    // over the source image. Feed and Story stay independent; the renderer
    // falls back to the slot's defaultCrop when an override is absent.
    feedCropOverrides: Object.fromEntries(
      state.imageValues.flatMap(iv => {
        const crop = iv.crops.feed;
        return crop ? [[iv.inputKey, crop] as const] : [];
      }),
    ),
    storyCropOverrides: Object.fromEntries(
      state.imageValues.flatMap(iv => {
        const crop = iv.crops.story;
        return crop ? [[iv.inputKey, crop] as const] : [];
      }),
    ),
    colourMode: state.colourMode,
    resolvedColourMap: { ...state.resolvedColourMap },
    metaPrimaryText: state.metaCopy.primaryText,
    metaHeadline: state.metaCopy.headline,
    metaDescription: state.metaCopy.description,
    metaCta: state.metaCopy.cta,
    revision: Math.max(1, state.lastSavedRevision ?? 0),
    documentHash: "0".repeat(64),
    lastRenderedHash: null,
  };
  return { ...doc, documentHash: await sha256HexClient(doc) };
}
