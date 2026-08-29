// v2 media helpers. Canonical renders land in workspace-artifacts under
// <workspaceId>/adstudio/renders/; customer slot bytes are resolved from that
// same workspace-scoped bucket before a document is re-rendered.

import { createHash } from "node:crypto";
import sharp from "sharp";

import { storagePathFromMediaSrc } from "../image-src.ts";
import { AD_IMAGE_MAX_BYTES } from "../../upload/asset-file.ts";
import type { AdDocInstance, AdTemplateDocV2 } from "./template-doc.ts";

type WorkspaceArtifactDownloadStorage = {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
    };
  };
};

type WorkspaceArtifactUploadStorage = {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        bytes: Uint8Array,
        options: { contentType: string; upsert: boolean },
      ): Promise<{ error: { message: string } | null }>;
    };
  };
};

export class AdDocSlotMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdDocSlotMediaError";
  }
}

const SUPPORTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];
const MAX_INLINE_IMAGE_DATA_URL_LENGTH = Math.ceil((AD_IMAGE_MAX_BYTES * 4) / 3) + 256;
export const AD_IMAGE_MAX_EDGE_PX = 8_192;
export const AD_IMAGE_MAX_PIXELS = 32_000_000;

function detectedImageMimeType(bytes: Buffer): SupportedImageMimeType | null {
  if (
    bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
  ) return "image/jpeg";
  if (
    bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return "image/png";
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).equals(Buffer.from("RIFF"))
    && bytes.subarray(8, 12).equals(Buffer.from("WEBP"))
  ) return "image/webp";
  return null;
}

/**
 * Defend the save route independently of the browser uploader. Storage object
 * metadata is caller-controlled, so the bytes themselves are the authority.
 */
export function validateAdDocSlotImageBytes(
  bytes: Buffer,
  expectedMimeType?: SupportedImageMimeType,
): SupportedImageMimeType {
  if (bytes.length === 0) throw new AdDocSlotMediaError("The photo is empty. Upload it again before saving.");
  if (bytes.length > AD_IMAGE_MAX_BYTES) {
    throw new AdDocSlotMediaError("Use an image under 8 MB before saving.");
  }
  const detected = detectedImageMimeType(bytes);
  if (!detected || (expectedMimeType && detected !== expectedMimeType)) {
    throw new AdDocSlotMediaError("Use a JPG, PNG, or WebP image before saving.");
  }
  return detected;
}

/** Reject compressed image bombs before native canvas allocates decoded pixels. */
export async function validateAdDocSlotImageDimensions(
  bytes: Buffer,
): Promise<{ width: number; height: number }> {
  try {
    const metadata = await sharp(bytes, { limitInputPixels: AD_IMAGE_MAX_PIXELS }).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (
      width < 1
      || height < 1
      || width > AD_IMAGE_MAX_EDGE_PX
      || height > AD_IMAGE_MAX_EDGE_PX
      || width * height > AD_IMAGE_MAX_PIXELS
    ) {
      throw new Error("dimensions outside the supported range");
    }
    return { width, height };
  } catch {
    throw new AdDocSlotMediaError(
      `Use an image no larger than ${AD_IMAGE_MAX_EDGE_PX.toLocaleString("en-US")} px per side or 32 megapixels.`,
    );
  }
}

/** Image input keys actually rendered by this template, across both formats. */
export function declaredAdDocSlotKeys(template: AdTemplateDocV2): Set<string> {
  const declared = new Set(template.inputs.images.map((input) => input.key));
  const slots = new Set<string>();
  for (const layout of [template.formats.feed, template.formats.story]) {
    if (!layout) continue;
    for (const layer of layout.layers) {
      if (layer.type === "image_slot" && declared.has(layer.inputKey)) slots.add(layer.inputKey);
    }
  }
  return slots;
}

/**
 * Decode an inline slot image only after bounding its encoded representation.
 * Callers still validate decoded dimensions before handing bytes to Sharp.
 */
export function decodeInlineAdDocImageBytes(src: string): Buffer | null {
  if (!src.startsWith("data:")) return null;
  if (src.length > MAX_INLINE_IMAGE_DATA_URL_LENGTH) {
    throw new AdDocSlotMediaError("Use an image under 8 MB before saving.");
  }
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/]+={0,2})$/i.exec(src);
  if (!match || match[2].length % 4 !== 0) {
    throw new AdDocSlotMediaError("Use a JPG, PNG, or WebP image before saving.");
  }
  const bytes = Buffer.from(match[2], "base64");
  validateAdDocSlotImageBytes(bytes, match[1].toLowerCase() as SupportedImageMimeType);
  return bytes;
}

function workspaceStoragePath(src: string, workspaceId: string): string | null {
  const path = storagePathFromMediaSrc(src) ?? (src.startsWith("/") ? null : src.trim());
  if (!path || path.includes("..") || !path.startsWith(`${workspaceId}/`)) return null;
  return path;
}

/**
 * Load only declared customer slot media for a v2 instance. The renderer gets
 * bytes, never a customer-controlled URL, and every bucket path is
 * workspace-bound.
 */
export async function resolveAdDocSlotBytes(input: {
  supabase: WorkspaceArtifactDownloadStorage;
  workspaceId: string;
  template: AdTemplateDocV2;
  instance: AdDocInstance;
}): Promise<Map<string, Buffer>> {
  const slotBytes = new Map<string, Buffer>();
  const slots = declaredAdDocSlotKeys(input.template);
  for (const imageInput of input.template.inputs.images) {
    const key = imageInput.key;
    const src = input.instance.values.images[key]?.src;
    if (!src) {
      if (imageInput.required) {
        throw new AdDocSlotMediaError(`Add the required photo for "${imageInput.label}" before saving.`);
      }
      continue;
    }
    // The schema/gate require every declared input to be rendered. Avoid
    // resolving an optional value that no layout can ever use, while retaining
    // the strict required-input check above if a corrupt template slips in.
    if (!slots.has(key)) continue;

    const inline = decodeInlineAdDocImageBytes(src);
    if (inline) {
      await validateAdDocSlotImageDimensions(inline);
      slotBytes.set(key, inline);
      continue;
    }

    const path = workspaceStoragePath(src, input.workspaceId);
    if (!path) {
      throw new AdDocSlotMediaError(`The photo for "${key}" is unavailable. Upload it again before saving.`);
    }
    const { data, error } = await input.supabase.storage.from("workspace-artifacts").download(path);
    if (error || !data) {
      throw new AdDocSlotMediaError(`The photo for "${key}" could not be loaded. Upload it again before saving.`);
    }
    if (data.size > AD_IMAGE_MAX_BYTES) {
      throw new AdDocSlotMediaError("Use an image under 8 MB before saving.");
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    validateAdDocSlotImageBytes(bytes);
    await validateAdDocSlotImageDimensions(bytes);
    slotBytes.set(key, bytes);
  }
  return slotBytes;
}

export async function persistAdDocRender(input: {
  supabase: WorkspaceArtifactUploadStorage;
  workspaceId: string;
  bytes: Uint8Array;
  /** e.g. `${creativeId}-feed` — the stored URL is content-addressed. */
  name: string;
}): Promise<string> {
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(input.name)) {
    throw new Error("Ad render name is invalid.");
  }
  const contentHash = createHash("sha256").update(input.bytes).digest("hex");
  const storagePath = `${input.workspaceId}/adstudio/renders/${input.name}-${contentHash}.png`;
  const { error } = await input.supabase.storage.from("workspace-artifacts").upload(storagePath, input.bytes, {
    contentType: "image/png",
    // A retry may upload the same content-addressed bytes. It can never change
    // the resource at this URL because a byte change also changes the hash.
    upsert: true,
  });
  if (error) {
    throw new Error(`Ad render could not be stored: ${error.message}`);
  }
  return storagePath;
}
