import type { AdStudioCreative, AdStudioFormat } from "./types.ts";

export type CreativeExportFormat = "png" | "jpeg";

export type CreativeExportRender = {
  creativeId: string;
  variantId: string;
  format: AdStudioFormat;
  width: number;
  height: number;
  mimeType: "image/png" | "image/jpeg";
  dataUrl?: string;
  storagePath?: string;
};

export function renderKey(input: Pick<CreativeExportRender, "creativeId" | "mimeType">) {
  return `${input.creativeId}:${input.mimeType}`;
}

export function buildRenderMap(renders: CreativeExportRender[] | undefined): Map<string, CreativeExportRender> {
  const map = new Map<string, CreativeExportRender>();
  for (const render of renders ?? []) {
    map.set(renderKey(render), render);
  }
  return map;
}

export function findCreativeRender(
  renders: Map<string, CreativeExportRender>,
  creative: AdStudioCreative | undefined,
  mimeType: CreativeExportRender["mimeType"],
): CreativeExportRender | null {
  if (!creative) return null;
  return renders.get(renderKey({ creativeId: creative.creativeId, mimeType })) ?? null;
}

export function decodeCreativeRender(
  render: CreativeExportRender,
  expected: Pick<AdStudioCreative, "creativeId" | "format"> & { canvas: Pick<AdStudioCreative["canvas"], "width" | "height"> },
): Uint8Array {
  if (render.creativeId !== expected.creativeId || render.format !== expected.format) {
    throw new Error("Creative render does not match the export creative.");
  }
  if (render.width !== expected.canvas.width || render.height !== expected.canvas.height) {
    throw new Error(`Creative render for ${expected.format} has invalid dimensions.`);
  }

  if (!render.dataUrl) {
    throw new Error("Creative render data is missing.");
  }

  const prefix = `data:${render.mimeType};base64,`;
  if (!render.dataUrl.startsWith(prefix)) {
    throw new Error("Creative render must be a base64 data URL."