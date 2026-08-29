// Safe public-sample inputs. This module deliberately does one small job:
// prove exactly which generic image bytes will be drawn into each declared
// slot, then construct the matching instance refs. It does not choose copy,
// recolour a plate, or mutate a template.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

import { hashTemplateDoc } from "./template-hash.ts";
import type { AdDocInstance, AdTemplateDocV2 } from "./template-doc.ts";

export class RestyleSampleAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestyleSampleAssetError";
  }
}

export type RestyleSampleRenderInput = {
  instance: AdDocInstance;
  slotBytes: Map<string, Buffer>;
};

/** Optional brand-kit inputs intentionally render empty in the neutral sample. */
export function requiredImageInputs(doc: Pick<AdTemplateDocV2, "inputs">) {
  return doc.inputs.images.filter((input) => input.required !== false);
}

function publicAssetPath(repoRoot: string, src: string): string {
  if (!src.startsWith("/") || src.includes("\\") || src.split("/").includes("..")) {
    throw new RestyleSampleAssetError(`safe replacement asset must be a public root-relative path: ${src}`);
  }
  const publicRoot = resolve(repoRoot, "public");
  const path = resolve(publicRoot, `.${src}`);
  if (!path.startsWith(`${publicRoot}${sep}`)) {
    throw new RestyleSampleAssetError(`safe replacement asset escapes public/: ${src}`);
  }
  return path;
}

/**
 * Load every declared generic image replacement and bind its verified bytes to
 * the declared input key. Asset declarations must be a one-to-one match: a
 * sample may never leave a customer-visible source photo showing through.
 */
export function loadSafeReplacementAssets(
  doc: Pick<AdTemplateDocV2, "id" | "inputs" | "restyle">,
  repoRoot = process.cwd(),
): { slotBytes: Map<string, Buffer>; imageRefs: AdDocInstance["values"]["images"] } {
  const declared = new Set(doc.inputs.images.map((input) => input.key));
  const assets = doc.restyle.safeReplacementAssets ?? [];
  const byKey = new Map<string, { src: string; sha256: string }>();

  for (const asset of assets) {
    if (!declared.has(asset.inputKey)) {
      throw new RestyleSampleAssetError(`${doc.id}: replacement asset declares unknown input "${asset.inputKey}"`);
    }
    if (byKey.has(asset.inputKey)) {
      throw new RestyleSampleAssetError(`${doc.id}: replacement asset is duplicated for "${asset.inputKey}"`);
    }
    byKey.set(asset.inputKey, asset);
  }

  const slotBytes = new Map<string, Buffer>();
  const imageRefs: AdDocInstance["values"]["images"] = {};
  for (const input of doc.inputs.images) {
    const asset = byKey.get(input.key);
    if (!asset && input.required !== false) {
      throw new RestyleSampleAssetError(`${doc.id}: public sample needs a safe replacement asset for "${input.key}"`);
    }
    if (!asset) continue;
    const path = publicAssetPath(repoRoot, asset.src);
    if (!existsSync(/* turbopackIgnore: true */ path)) {
      throw new RestyleSampleAssetError(`${doc.id}: safe replacement asset is missing: ${asset.src}`);
    }
    const bytes = readFileSync(/* turbopackIgnore: true */ path);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== asset.sha256) {
      throw new RestyleSampleAssetError(`${doc.id}: safe replacement asset hash mismatch: ${asset.src}`);
    }
    slotBytes.set(input.key, bytes);
    imageRefs[input.key] = { src: asset.src, focal: { x: 0.5, y: 0.5 }, zoom: 1 };
  }
  return { slotBytes, imageRefs };
}

/**
 * Build a public-sample instance from operator-supplied copy. There is no
 * fallback to source or template copy: the caller must consciously provide
 * every text value that will appear in the gallery.
 */
export function buildRestyleSampleRenderInput(input: {
  doc: AdTemplateDocV2;
  format: "4:5" | "9:16";
  text: Record<string, string>;
  repoRoot?: string;
}): RestyleSampleRenderInput {
  for (const field of input.doc.inputs.text) {
    if (typeof input.text[field.key] !== "string") {
      throw new RestyleSampleAssetError(`${input.doc.id}: caller must provide safe sample copy for "${field.key}"`);
    }
  }
  const { slotBytes, imageRefs } = loadSafeReplacementAssets(input.doc, input.repoRoot);
  return {
    instance: {
      schema: "adstudio.instance.v2",
      templateId: input.doc.id,
      templateHash: hashTemplateDoc(input.doc),
      format: input.format,
      values: { images: imageRefs, text: { ...input.text } },
      overrides: [],
    },
    slotBytes,
  };
}
