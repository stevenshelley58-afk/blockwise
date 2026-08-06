// Pure editor state over AdDocInstance (Track A, §7). No React in here —
// the hook in use-editor-doc.ts owns the undo/redo stack and autosave.

import type { AdDocInstance, AdTemplateDocV2, NormBox } from "@/lib/adstudio/v2/template-doc";

export type EditorMode = "guided" | "advanced" | "studio";

export type EditorAction =
  | { type: "set-text"; key: string; value: string }
  | { type: "replace-image"; key: string; src: string }
  | { type: "image-focal"; key: string; focal: { x: number; y: number }; zoom?: number }
  | { type: "override"; layerId: string; op: "move"; box: NormBox; mode?: EditorMode }
  | { type: "override"; layerId: string; op: "font-size"; sizeRatio: number; mode?: EditorMode }
  | { type: "override"; layerId: string; op: "align"; align: "left" | "center" | "right"; mode?: EditorMode }
  | { type: "override"; layerId: string; op: "color"; color: string; mode?: EditorMode; palette?: string[] };

export type EditorGuard = { allowed: boolean; reason?: string };

export const ADVANCED_OVERRIDE_OPS = ["move", "font-size", "align", "color"] as const;
export const GUIDED_OVERRIDE_OPS = ["color"] as const;

export function templateLayer(template: AdTemplateDocV2, layerId: string) {
  for (const layout of [template.formats.feed, template.formats.story]) {
    const layer = layout?.layers.find((item) => item.id === layerId);
    if (layer) return layer;
  }
  return null;
}

export function textInputFor(template: AdTemplateDocV2, key: string) {
  return template.inputs.text.find((input) => input.key === key) ?? null;
}

export function imageInputFor(template: AdTemplateDocV2, key: string) {
  return template.inputs.images.find((input) => input.key === key) ?? null;
}

/**
 * The guided-mode guard rails: text/image edits always allowed (clamped),
 * overrides limited to the whitelist, locked layers untouchable in every
 * mode, guided colours limited to the brand palette when one is provided.
 */
export function guardAction(
  template: AdTemplateDocV2,
  instance: AdDocInstance,
  action: EditorAction,
  mode: EditorMode,
): EditorGuard {
  if (action.type === "set-text") {
    return textInputFor(template, action.key)
      ? { allowed: true }
      : { allowed: false, reason: `No text input "${action.key}" in this template.` };
  }
  if (action.type === "replace-image" || action.type === "image-focal") {
    return imageInputFor(template, action.key)
      ? { allowed: true }
      : { allowed: false, reason: `No image input "${action.key}" in this template.` };
  }

  const layer = templateLayer(template, action.layerId);
  if (!layer) return { allowed: false, reason: `Unknown layer "${action.layerId}".` };
  if (template.editPolicy.lockedLayerIds.includes(action.layerId)) {
    return { allowed: false, reason: "This layer is locked by the template." };
  }

  const whitelist = mode === "guided" ? GUIDED_OVERRIDE_OPS : ADVANCED_OVERRIDE_OPS;
  if (!(whitelist as readonly string[]).includes(action.op)) {
    return { allowed: false, reason: `Enable Advanced mode to ${action.op} layers.` };
  }

  if (action.op === "color") {
    const palette = action.palette ?? [];
    if (mode === "guided" && palette.length > 0 && !palette.includes(action.color)) {
      return { allowed: false, reason: "Guided mode recolours to your brand palette only." };
    }
    if (!/^#[0-9a-f]{6}$/i.test(action.color)) {
      return { allowed: false, reason: "Colours must be #rrggbb." };
    }
  }
  return { allowed: true };
}

/**
 * Applies an action to the instance WITHOUT guards — call guardAction first.
 * Overrides replace the previous override of the same layer+op (last wins),
 * keeping the doc lean instead of appending an unbounded history.
 */
export function applyEditorAction(
  template: AdTemplateDocV2,
  instance: AdDocInstance,
  action: EditorAction,
): AdDocInstance {
  switch (action.type) {
    case "set-text": {
      const input = textInputFor(template, action.key);
      if (!input) return instance;
      return {
        ...instance,
        values: {
          ...instance.values,
          text: { ...instance.values.text, [action.key]: action.value.slice(0, input.maxLength) },
        },
      };
    }
    case "replace-image":
      return {
        ...instance,
        values: {
          ...instance.values,
          images: {
            ...instance.values.images,
            [action.key]: { ...(instance.values.images[action.key] ?? {}), src: action.src },
          },
        },
      };
    case "image-focal":
      return {
        ...instance,
        values: {
          ...instance.values,
          images: {
            ...instance.values.images,
            [action.key]: {
              ...(instance.values.images[action.key] ?? {}),
              focal: action.focal,
              ...(action.zoom !== undefined ? { zoom: Math.min(3, Math.max(1, action.zoom)) } : {}),
            },
          },
        },
      };
    case "override": {
      const existing = instance.overrides.filter(
        (override) => !(override.layerId === action.layerId && override.op === action.op),
      );
      const next =
        action.op === "move"
          ? { layerId: action.layerId, op: "move", box: action.box } as const
          : action.op === "font-size"
            ? { layerId: action.layerId, op: "font-size", sizeRatio: action.sizeRatio } as const
            : action.op === "align"
              ? { layerId: action.layerId, op: "align", align: action.align } as const
              : { layerId: action.layerId, op: "color", color: action.color } as const;
      return { ...instance, overrides: [...existing, next] };
    }
  }
}

/** Effective box/typography deltas for a layer, resolved from overrides. */
export function layerOverrides(instance: AdDocInstance, layerId: string) {
  const result: {
    box?: NormBox;
    sizeRatio?: number;
    align?: "left" | "center" | "right";
    color?: string;
  } = {};
  for (const override of instance.overrides) {
    if (override.layerId !== layerId) continue;
    if (override.op === "move") result.box = override.box;
    if (override.op === "font-size") result.sizeRatio = override.sizeRatio;
    if (override.op === "align") result.align = override.align;
    if (override.op === "color") result.color = override.color;
  }
  return result;
}

// ─── undoable reducer (pure; the hook in components/ wraps it) ──────────────

export type EditorDocState = {
  instance: AdDocInstance;
  past: AdDocInstance[];
  future: AdDocInstance[];
  lastGesture: string | null;
  denied: string | null;
};

export type EditorReducerInput =
  | { kind: "edit"; action: EditorAction; mode: EditorMode; gestureId: string }
  | { kind: "undo" }
  | { kind: "redo" };

/**
 * Undo/redo always succeed (no-op at the ends of the stack). Denied edits
 * record a reason but never push history. A continuing gesture (drag,
 * typing burst) coalesces onto one undo snapshot.
 */
export function makeEditorReducer(template: AdTemplateDocV2, palette: string[]) {
  return (state: EditorDocState, input: EditorReducerInput): EditorDocState => {
    if (input.kind === "undo") {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        instance: previous,
        past: state.past.slice(0, -1),
        future: [...state.future, state.instance],
        lastGesture: null,
        denied: null,
      };
    }
    if (input.kind === "redo") {
      if (state.future.length === 0) return state;
      const next = state.future[state.future.length - 1];
      return {
        ...state,
        instance: next,
        past: [...state.past, state.instance],
        future: state.future.slice(0, -1),
        lastGesture: null,
        denied: null,
      };
    }

    const guard = guardAction(template, state.instance, input.action, input.mode);
    if (!guard.allowed) return { ...state, denied: guard.reason ?? "Not allowed." };
    const next = applyEditorAction(template, state.instance, input.action);
    if (next === state.instance) return state;

    const continuing = input.gestureId === state.lastGesture;
    return {
      instance: next,
      past: continuing ? state.past : [...state.past.slice(-49), state.instance],
      future: [],
      lastGesture: input.gestureId,
      denied: null,
    };
  };
}
