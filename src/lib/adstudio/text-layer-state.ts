import type { AdStudioTextLayers } from "./types.ts";

/**
 * Persist this before starting the inpaint request. This constructor stays
 * browser-safe because clone campaign metadata is also used by the workbench.
 */
export function buildingTextLayers(renderRef: string, deterministicOnly = false): AdStudioTextLayers {
  return {
    status: "building",
    builtAt: new Date().toISOString(),
    derivedFrom: renderRef,
    deterministicOnly,
    plate: "",
    styles: {},
    validFor: [],
  };
}
