import type {
  ColourRole,
  LayoutLayer,
} from "../../../../packages/ad-template-contract/src/types";

export const META_EDIT_FIELDS = ["primaryText", "headline", "description", "cta"] as const;

export type MetaEditField = (typeof META_EDIT_FIELDS)[number];

export type EditorLayerTarget = {
  kind: "layer";
  layerId: string;
  inputKey: string;
  type: "text" | "image_slot" | "logo";
  colourRole?: ColourRole;
};

export type EditorMetaTarget = {
  kind: "meta";
  field: MetaEditField;
};

export type EditorTarget = EditorLayerTarget | EditorMetaTarget;

export function editorTargetForLayer(layer: LayoutLayer): EditorLayerTarget | null {
  if (layer.type === "text") {
    return {
      kind: "layer",
      layerId: layer.layerId,
      inputKey: layer.inputKey,
      type: layer.type,
      colourRole: layer.colourRole,
    };
  }
  if (layer.type === "image_slot" || layer.type === "logo") {
    return {
      kind: "layer",
      layerId: layer.layerId,
      inputKey: layer.inputKey,
      type: layer.type,
    };
  }
  return null;
}
