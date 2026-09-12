import { createHash } from "node:crypto";
import sharp from "sharp";

import type { NativeEditorDocument, NativeFabricScene, Placement } from "../../../packages/ad-template-contract/src/types.ts";
import { PLACEMENT_DIMENSIONS } from "../../../packages/ad-template-contract/src/types.ts";
import { parseCustomerImageRef } from "./customer-image-ref.ts";

export const NATIVE_RENDERER_VERSION = "vue-fabric-editor@1-browser-export";
// Combined JSON remains below Caddy's 14 MB request limit after base64
// expansion: two 4 MB PNGs plus two 1 MB scenes and request framing.
export const MAX_NATIVE_SCENE_BYTES = 1024 * 1024;
export const MAX_NATIVE_EXPORT_BYTES = 4 * 1024 * 1024;

const MAX_SCENE_DEPTH = 24;
const MAX_SCENE_NODES = 30_000;
const MAX_OBJECT_KEYS = 256;
const MAX_STRING_LENGTH = 1_048_576;
const RESOURCE_KEYS = new Set(["src", "source"]);
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const FABRIC_OBJECT_TYPES = new Set([
  "activeselection", "arrow", "barcode", "circle", "ellipse", "group", "image", "i-text",
  "line", "path", "polygon", "polyline", "rect", "textbox", "text", "triangle",
  "thintailarrow",
]);

export type NativePngExport = { mimeType: "image/png"; base64: string };

export type ValidatedNativePng = {
  bytes: Buffer;
  hash: string;
  width: number;
  height: number;
};

export class NativeEditorValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NativeEditorValidationError";
    this.code = code;
  }
}

export function validateNativeEditorDocument(input: {
  nativeEditor: NativeEditorDocument;
  workspaceId: string;
  adId: string;
  templateId: string;
}): void {
  if (input.nativeEditor.engine !== "vue-fabric-editor" || input.nativeEditor.version !== 1) {
    throw new NativeEditorValidationError("native_editor_invalid", "Unsupported native editor document.");
  }
  validateNativeScene(input.nativeEditor.feed, "feed", input);
  validateNativeScene(input.nativeEditor.story, "story", input);
}

export function validateNativeScene(
  scene: NativeFabricScene,
  placement: Placement,
  identity: { workspaceId: string; adId: string; templateId: string },
): void {
  const expected = PLACEMENT_DIMENSIONS[placement];
  if (!expected || scene.width !== expected.width || scene.height !== expected.height) {
    throw new NativeEditorValidationError(
      "native_scene_dimensions",
      `${placement === "feed" ? "Feed" : "Story"} scene must be ${expected?.width ?? 0}x${expected?.height ?? 0}.`,
    );
  }
  if (!Array.isArray(scene.objects) || scene.objects.length > 500) {
    throw new NativeEditorValidationError("native_scene_invalid", "Native editor scene has too many objects.");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(scene);
  } catch {
    throw new NativeEditorValidationError("native_scene_invalid", "Native editor scene is not valid JSON.");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_NATIVE_SCENE_BYTES) {
    throw new NativeEditorValidationError("native_scene_too_large", "Native editor scene is too large.");
  }

  const budget = { nodes: 0 };
  walkSceneValue(scene, 0, budget, identity);
  for (const object of scene.objects) validateFabricObjectTypes(object);
}

export async function validateNativePngExport(
  value: NativePngExport,
  placement: Placement,
): Promise<ValidatedNativePng> {
  if (!value || value.mimeType !== "image/png" || typeof value.base64 !== "string") {
    throw new NativeEditorValidationError("native_export_invalid", "A PNG export is required for each placement.");
  }
  const maxEncoded = Math.ceil(MAX_NATIVE_EXPORT_BYTES / 3) * 4;
  if (value.base64.length === 0 || value.base64.length > maxEncoded || !isCanonicalBase64(value.base64)) {
    throw new NativeEditorValidationError("native_export_invalid", "Native editor export is not valid base64 PNG data.");
  }
  const bytes = Buffer.from(value.base64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_NATIVE_EXPORT_BYTES || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new NativeEditorValidationError("native_export_invalid", "Native editor export is not a valid PNG.");
  }
  const expected = PLACEMENT_DIMENSIONS[placement];
  try {
    const image = sharp(bytes, { failOn: "error", limitInputPixels: expected.width * expected.height });
    const metadata = await image.metadata();
    if (metadata.format !== "png" || metadata.width !== expected.width || metadata.height !== expected.height || (metadata.pages ?? 1) !== 1) {
      throw new NativeEditorValidationError(
        "native_export_dimensions",
        `${placement === "feed" ? "Feed" : "Story"} PNG must be ${expected.width}x${expected.height}.`,
      );
    }
    // Force a complete pixel decode. Reading metadata alone only validates the
    // PNG header and would allow truncated or corrupt image data to be saved.
    const decoded = await image.raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== expected.width || decoded.info.height !== expected.height) {
      throw new NativeEditorValidationError("native_export_invalid", "Native editor PNG could not be decoded safely.");
    }
  } catch (error) {
    if (error instanceof NativeEditorValidationError) throw error;
    throw new NativeEditorValidationError("native_export_invalid", "Native editor export is corrupt or unreadable.");
  }
  return {
    bytes,
    hash: createHash("sha256").update(bytes).digest("hex"),
    width: expected.width,
    height: expected.height,
  };
}

function walkSceneValue(
  value: unknown,
  depth: number,
  budget: { nodes: number },
  identity: { workspaceId: string; adId: string; templateId: string },
  parentKey?: string,
): void {
  budget.nodes += 1;
  if (depth > MAX_SCENE_DEPTH || budget.nodes > MAX_SCENE_NODES) {
    throw new NativeEditorValidationError("native_scene_invalid", "Native editor scene is too deeply nested or complex.");
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000) {
      throw new NativeEditorValidationError("native_scene_invalid", "Native editor scene contains an invalid number.");
    }
    return;
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      throw new NativeEditorValidationError("native_scene_invalid", "Native editor scene contains an oversized string.");
    }
    if (parentKey && RESOURCE_KEYS.has(parentKey.toLowerCase())) validateResourceRef(value, identity);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 5_000) throw new NativeEditorValidationError("native_scene_invalid", "Native editor scene array is too large.");
    for (const item of value) walkSceneValue(item, depth + 1, budget, identity);
    return;
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new NativeEditorValidationError("native_scene_invalid", "Native editor scene contains an unsupported value.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_OBJECT_KEYS) throw new NativeEditorValidationError("native_scene_invalid", "Native editor scene object has too many properties.");
  for (const [key, child] of entries) {
    if (!key || key.length > 128 || DANGEROUS_KEYS.has(key)) {
      throw new NativeEditorValidationError("native_scene_invalid", "Native editor scene contains an unsafe property.");
    }
    walkSceneValue(child, depth + 1, budget, identity, key);
  }
}

function validateFabricObjectTypes(value: Record<string, unknown>): void {
  const type = value.type;
  if (typeof type !== "string" || !FABRIC_OBJECT_TYPES.has(type.toLowerCase())) {
    throw new NativeEditorValidationError("native_scene_object_type", "Native editor scene contains an unsupported object type.");
  }
  const children = value.objects;
  if (children !== undefined) {
    if (!Array.isArray(children)) throw new NativeEditorValidationError("native_scene_invalid", "Native editor group is malformed.");
    for (const child of children) {
      if (!child || typeof child !== "object" || Array.isArray(child)) {
        throw new NativeEditorValidationError("native_scene_invalid", "Native editor group contains a malformed object.");
      }
      validateFabricObjectTypes(child as Record<string, unknown>);
    }
  }
}

function validateResourceRef(value: string, identity: { workspaceId: string; adId: string; templateId: string }): void {
  if (parseCustomerImageRef(value, identity.workspaceId, identity.adId)) return;
  const templatePrefix = `/api/adstudio/templates/${encodeURIComponent(identity.templateId)}/assets/`;
  if (value.startsWith(templatePrefix)) {
    const [encodedAssetKey, query = ""] = value.slice(templatePrefix.length).split("?", 2);
    const assetKey = decodeCanonicalRoutePart(encodedAssetKey);
    if (assetKey) {
      if (!query) return;
      const params = new URLSearchParams(query);
      if ([...params.keys()].length === 1 && params.get("adId") === identity.adId) return;
    }
  }
  throw new NativeEditorValidationError(
    "native_scene_resource_invalid",
    "Native editor images must use workspace-owned or selected-template media.",
  );
}

function decodeCanonicalRoutePart(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return /^[A-Za-z0-9._:-]+$/.test(decoded) && encodeURIComponent(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

function isCanonicalBase64(value: string): boolean {
  return value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}
