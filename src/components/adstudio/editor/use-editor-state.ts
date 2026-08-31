"use client";

import { useState, useCallback, useRef } from "react";
import type { AdTemplate, Layout, LayoutLayer, Placement, Rect, ColourRole } from "../../../../packages/ad-template-contract/src/types";
import type { AdDocumentParsed } from "../../../../packages/ad-template-contract/src/schema";

// ---------------------------------------------------------------------------
// Editor state — Phase 6 foundation
// ---------------------------------------------------------------------------

export interface EditorImageValue {
  inputKey: string;
  /**
   * Browser preview URL. New picks begin as data URLs; after Save the server
   * returns a private workspace-artifacts media reference, which is safe to
   * persist and remains usable by the authenticated media proxy.
   */
  dataUrl: string | null;
  /** Local object/data URL retained while a direct upload is in flight. */
  previewUrl?: string | null;
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

export function readEditorDefaults(pack: AdTemplate): PackEditorDefaults {
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
      : isRecord(raw.metadata) ? raw.metadata : {};
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

export function editorTextInputs(pack: AdTemplate): EditorTextInput[] {
  const defaults = readEditorDefaults(pack);
  const existing = new Set(pack.textInputs.map(input => input.key));
  return [...pack.textInputs, ...defaults.textInputs.filter(input => !existing.has(input.key))];
}

export interface EditorState {
  pack: AdTemplate;
  activePlacement: Placement;
  imageValues: EditorImageValue[];
  textValues: Record<string, string>;
  colourMode: "template" | "brand_pack" | "custom";
  resolvedColourMap: Record<ColourRole, string>;
  selectedLayerId: string | null;
  isDirty: boolean;
  /** Monotonic edit token used to keep a late save from clearing newer edits. */
  editVersion?: number;
  isSaving: boolean;
  lastSavedRevision: number | null;
  error: string | null;
  /** Meta primary text / headline / description / CTA (shared across placements). */
  metaCopy: MetaCopy;
  /**
   * "Use template copy" checkbox. ON fills EMPTY fields with the template's
   * suggestions; OFF clears only the fields the template filled that the
   * customer has not edited since (see templateFilled). Customer copy is
   * never destroyed unpredictably.
   */
  templateCopyApplied: boolean;
  /**
   * Provenance of template-filled values that are still unedited: which text
   * keys and meta fields hold exactly what the template put there. Edited or
   * saved values are removed, so unchecking can never clear them.
   */
  templateFilled: { text: string[]; meta: string[] };
  /**
   * Customer-facing display name for Meta previews. Brand Pack value is the
   * default; an explicit override here wins. Empty string → Brand Pack
   * fallback (or a generic placeholder).
   */
  brandBusinessName: string;
}

/** True when a save response still covers the editor's current edit snapshot. */
export function saveCoversEditVersion(currentVersion: number | undefined, savedVersion: number): boolean {
  return (currentVersion ?? 0) === savedVersion;
}

/**
 * The editor's starting values. Exported for tests: a NEW ad starts with
 * EMPTY placeholders — template copy is only ever inserted via the explicit
 * "Use template copy" checkbox. Saved ads restore exactly what the customer
 * last saved (never re-seeded from template defaults).
 */
export const initialEditorState = (pack: AdTemplate): EditorState => {
  return {
  pack,
  activePlacement: "feed",
  imageValues: pack.imageInputs.map(i => ({ inputKey: i.key, dataUrl: null, previewUrl: null, crops: {} })),
  // New ads start EMPTY (placeholders only in preview) — never auto-insert
  // template copy. Saved ads restore the customer's saved values below.
  textValues: Object.fromEntries(pack.textInputs.map(i => [i.key, ""])),
  colourMode: "template",
  resolvedColourMap: { ...pack.semanticColours },
  selectedLayerId: null,
  isDirty: false,
  editVersion: 0,
  isSaving: false,
  lastSavedRevision: null,
  error: null,
  // CTA keeps a sensible default even for new ads so the select is valid.
  metaCopy: { primaryText: "", headline: "", description: "", cta: "LEARN_MORE" },
  // Saved values belong to the customer — the template checkbox starts OFF.
  templateCopyApplied: false,
  templateFilled: { text: [], meta: [] },
  brandBusinessName: "",
  };
};

export function useEditorState(pack: AdTemplate, initialDocument?: AdDocumentParsed, initialRevision?: number) {
  const [state, setState] = useState<EditorState>(() => {
    const base = initialEditorState(pack);
    if (!initialDocument) return base;
    return {
      ...base,
      imageValues: base.imageValues.map(value => ({
        ...value,
        dataUrl: initialDocument.sharedImageValues[value.inputKey] ?? null,
        previewUrl: null,
        crops: {
          feed: initialDocument.feedCropOverrides[value.inputKey],
          story: initialDocument.storyCropOverrides[value.inputKey],
        },
      })),
      textValues: { ...base.textValues, ...initialDocument.sharedTextValues },
      colourMode: initialDocument.colourMode,
      resolvedColourMap: { ...base.resolvedColourMap, ...initialDocument.resolvedColourMap },
      metaCopy: {
        primaryText: initialDocument.metaPrimaryText,
        headline: initialDocument.metaHeadline,
        description: initialDocument.metaDescription,
        cta: initialDocument.metaCta,
      },
      lastSavedRevision: initialRevision ?? null,
      // Saved values belong to the customer — the template checkbox starts
      // OFF and provenance is empty, so unchecking can never erase them.
      templateCopyApplied: false,
      templateFilled: { text: [], meta: [] },
      brandBusinessName: initialDocument.brandBusinessName ?? "",
    };
  });
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
      // Editing a template-filled field makes it customer copy — remove it
      // from template provenance so unchecking later cannot clear it.
      const remaining = prev.templateFilled.text.filter(k => k !== key);
      return {
        ...prev,
        textValues: { ...prev.textValues, [key]: value },
        templateFilled: { ...prev.templateFilled, text: remaining },
        isDirty: true,
        editVersion: (prev.editVersion ?? 0) + 1,
      };
    });
  }, [pushUndo]);

  const updateImageValue = useCallback((key: string, dataUrl: string | null, previewUrl: string | null = null) => {
    setState(prev => {
      pushUndo(prev);
      return {
        ...prev,
        imageValues: prev.imageValues.map(iv =>
          iv.inputKey === key ? { ...iv, dataUrl, previewUrl } : iv
        ),
        isDirty: true,
        editVersion: (prev.editVersion ?? 0) + 1,
      };
    });
  }, [pushUndo]);

  const updateImagePreview = useCallback((key: string, previewUrl: string | null) => {
    setState(prev => ({
      ...prev,
      imageValues: prev.imageValues.map(iv => iv.inputKey === key ? { ...iv, previewUrl } : iv),
      isDirty: true,
      editVersion: (prev.editVersion ?? 0) + 1,
    }));
  }, []);

  const updateCrop = useCallback((key: string, placement: Placement, crop: Rect) => {
    setState(prev => {
      pushUndo(prev);
      return {
        ...prev,
        imageValues: prev.imageValues.map(iv =>
          iv.inputKey === key ? { ...iv, crops: { ...iv.crops, [placement]: crop } } : iv
        ),
        isDirty: true,
        editVersion: (prev.editVersion ?? 0) + 1,
      };
    });
  }, [pushUndo]);

  /** Update one Meta copy field (primary text, headline, description, CTA). */
  const updateMetaCopy = useCallback((field: keyof MetaCopy, value: string) => {
    setState(prev => {
      pushUndo(prev);
      const remaining = prev.templateFilled.meta.filter(f => f !== field);
      return {
        ...prev,
        metaCopy: { ...prev.metaCopy, [field]: value },
        templateFilled: { ...prev.templateFilled, meta: remaining },
        isDirty: true,
        editVersion: (prev.editVersion ?? 0) + 1,
      };
    });
  }, [pushUndo]);

  /** Update the overridable business name shown in Meta previews. */
  const updateBusinessName = useCallback((value: string) => {
    setState(prev => ({ ...prev, brandBusinessName: value, isDirty: true }));
  }, []);

  const setColourMode = useCallback((mode: EditorState["colourMode"], colourMap?: Record<ColourRole, string>) => {
    setState(prev => {
      pushUndo(prev);
      return {
        ...prev,
        colourMode: mode,
        resolvedColourMap: colourMap ?? (mode === "template" ? { ...prev.pack.semanticColours } : prev.resolvedColourMap),
        isDirty: true,
        editVersion: (prev.editVersion ?? 0) + 1,
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

  /**
   * "Use template copy" checkbox. ON fills EMPTY fields with the template's
   * suggested copy (one undoable step). OFF clears ONLY the fields the
   * template filled that the customer has not edited since — saved or typed
   * copy is never touched, so unchecking is predictable.
   */
  const setTemplateCopyApplied = useCallback((enabled: boolean) => {
    setState(prev => {
      pushUndo(prev);
      if (enabled) {
        const merged = applyTemplateCopy(prev.textValues, prev.metaCopy, prev.pack);
        return {
          ...prev,
          textValues: merged.textValues,
          metaCopy: merged.metaCopy,
          // Provenance = everything the template just filled (edited keys are
          // not refilled, so they cannot appear here).
          templateFilled: {
            text: Object.keys(merged.filledText),
            meta: Object.keys(merged.filledMeta),
          },
          templateCopyApplied: true,
          isDirty: true,
        };
      }
      // Uncheck: clear only still-unedited template-filled fields.
      const textValues = { ...prev.textValues };
      for (const key of prev.templateFilled.text) textValues[key] = "";
      const metaCopy = { ...prev.metaCopy };
      for (const field of prev.templateFilled.meta) metaCopy[field as keyof MetaCopy] = "";
      return {
        ...prev,
        textValues,
        metaCopy,
        templateFilled: { text: [], meta: [] },
        templateCopyApplied: false,
        isDirty: true,
      };
    });
  }, [pushUndo]);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (prev) {
      redoStack.current.push(state);
      setState({ ...prev, isSaving: state.isSaving, isDirty: true, editVersion: (state.editVersion ?? 0) + 1 });
    }
  }, [state]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (next) {
      undoStack.current.push(state);
      setState({ ...next, isSaving: state.isSaving, isDirty: true, editVersion: (state.editVersion ?? 0) + 1 });
    }
  }, [state]);

  const markSaved = useCallback((revision: number, savedEditVersion = 0) => {
    setState(prev => ({
      ...prev,
      // A user may have edited while the request was rendering. Only clear
      // dirty state when the response covers the current edit snapshot.
      isDirty: !saveCoversEditVersion(prev.editVersion, savedEditVersion),
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
    updateImagePreview,
    updateCrop,
    setColourMode,
    updateCustomColour,
    setTemplateCopyApplied,
    updateBusinessName,
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
// Template copy — the template's suggested overlay text and Meta copy. New
// ads start EMPTY; the explicit "Use template copy" checkbox fills EMPTY
// fields only, so saved customer copy is never erased. Populated fields stay
// editable.
// ---------------------------------------------------------------------------

export interface TemplateCopyValues {
  textValues: Record<string, string>;
  metaCopy: MetaCopy;
}

/** The template's suggested copy, read from the portable defaults. */
export function templateCopyValues(pack: AdTemplate): TemplateCopyValues {
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
export function hasTemplateCopy(pack: AdTemplate): boolean {
  const { textValues, metaCopy } = templateCopyValues(pack);
  const hasText = Object.values(textValues).some(value => value.trim().length > 0);
  const hasMeta = [metaCopy.primaryText, metaCopy.headline, metaCopy.description].some(value => value.trim().length > 0);
  return hasText || hasMeta;
}

/**
 * Merge template copy into the current values, filling ONLY empty fields.
 * Customer copy — saved or freshly typed — is never overwritten. The filled
 * maps record exactly which fields received template text (provenance for
 * predictable unchecking).
 */
export function applyTemplateCopy(
  currentTextValues: Record<string, string>,
  currentMetaCopy: MetaCopy,
  pack: AdTemplate,
): {
  textValues: Record<string, string>;
  metaCopy: MetaCopy;
  filledText: Record<string, string>;
  filledMeta: Partial<Record<keyof MetaCopy, string>>;
} {
  const template = templateCopyValues(pack);
  const textValues = { ...currentTextValues };
  const filledText: Record<string, string> = {};
  for (const [key, value] of Object.entries(template.textValues)) {
    if (!(key in textValues) || textValues[key].trim() === "") {
      textValues[key] = value;
      filledText[key] = value;
    }
  }
  const metaCopy = { ...currentMetaCopy };
  const filledMeta: Partial<Record<keyof MetaCopy, string>> = {};
  for (const field of ["primaryText", "headline", "description"] as const) {
    if (metaCopy[field].trim() === "") {
      metaCopy[field] = template.metaCopy[field];
      filledMeta[field] = template.metaCopy[field];
    }
  }
  // CTA is a selection — only filled when the customer has not chosen one.
  if (metaCopy.cta.trim() === "") {
    metaCopy.cta = template.metaCopy.cta;
    filledMeta.cta = template.metaCopy.cta;
  }
  return { textValues, metaCopy, filledText, filledMeta };
}

// ---------------------------------------------------------------------------

/** Build the saved customer overrides described by the editor's current state. */
export async function buildAdDocument(state: EditorState): Promise<AdDocumentParsed> {
  const pack = state.pack;
  const placeholders = new Map(editorTextInputs(pack).map(input => [input.key, input.placeholder]));
  const doc = {
    schema: "blockwise.ad-document" as const,
    templateId: pack.templateId,
    sharedImageValues: Object.fromEntries(
      state.imageValues
        .filter(iv => iv.dataUrl !== null && !/^data:image\//i.test(iv.dataUrl))
        .map(iv => [iv.inputKey, iv.dataUrl as string]),
    ),
    sharedTextValues: Object.fromEntries(
      Object.entries(state.textValues).filter(([key, value]) => {
        const trimmed = value.trim();
        return trimmed.length > 0 && trimmed !== (placeholders.get(key) ?? "").trim();
      }),
    ),
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
    // Optional override — omitted entirely when empty so old documents and
    // new documents serialize identically when the name is not overridden.
    ...(state.brandBusinessName.trim() ? { brandBusinessName: state.brandBusinessName.trim() } : {}),
    revision: Math.max(1, (state.lastSavedRevision ?? 0) + 1),
  };
  return doc;
}

/** Merge template placeholder copy for preview without persisting it as a customer edit. */
export function previewTextValues(
  template: AdTemplate,
  overrides: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    editorTextInputs(template).map(input => [input.key, overrides[input.key]?.trim() ? overrides[input.key] : input.placeholder]),
  );
}
