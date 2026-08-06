// Track C decompose: text-region inpaint on the SOURCE ad (D5). Ported from
// the v1 truth-preserving repair flow (ai-providers.ts): OpenAI /images/edits
// with an alpha-hole mask, then composited back so pixels OUTSIDE the mask
// are byte-identical to the source. One masked call per template — never a
// full-image repaint.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

import { hashCanonicalJson } from "../../../../src/lib/adstudio/v2/template-hash.ts";

export const TEXT_MASK_PADDING = 0.035;

export function envFromDotfiles(root) {
  const env = { ...process.env };
  for (const file of [".env.local", ".env"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || env[match[1]] !== undefined) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[match[1]] = value;
    }
  }
  return env;
}

/** Same mask semantics as v1 createRegionEditMaskForDimensions: opaque white
 *  with transparent holes over the text boxes (OpenAI edits the holes). */
export async function buildInpaintMask(dimensions, boxes) {
  const usable = boxes.filter((box) => box.width > 0 && box.height > 0);
  if (usable.length === 0) return null;
  const holes = usable.map((box) => {
    const x = Math.max(0, Math.floor((box.x - TEXT_MASK_PADDING) * dimensions.width));
    const y = Math.max(0, Math.floor((box.y - TEXT_MASK_PADDING) * dimensions.height));
    const right = Math.min(dimensions.width, Math.ceil((box.x + box.width + TEXT_MASK_PADDING) * dimensions.width));
    const bottom = Math.min(dimensions.height, Math.ceil((box.y + box.height + TEXT_MASK_PADDING) * dimensions.height));
    return `<rect x="${x}" y="${y}" width="${Math.max(1, right - x)}" height="${Math.max(1, bottom - y)}" fill="black"/>`;
  }).join("");
  const svg = Buffer.from(
    `<svg width="${dimensions.width}" height="${dimensions.height}" xmlns="http://www.w3.org/2000/svg">`
      + '<defs><mask id="edit-region"><rect width="100%" height="100%" fill="white"/>'
      + holes
      + '</mask></defs><rect width="100%" height="100%" fill="white" mask="url(#edit-region)"/></svg>',
  );
  return sharp(svg).ensureAlpha().png({ compressionLevel: 1 }).toBuffer();
}

/** Composite-side mask: opaque ONLY over the text boxes (the inverse of the
 *  OpenAI mask), so the inpaint result is kept exclusively inside the holes
 *  and every pixel outside them stays byte-identical to the source. */
export async function buildCompositeMask(dimensions, boxes) {
  const usable = boxes.filter((box) => box.width > 0 && box.height > 0);
  if (usable.length === 0) return null;
  const fills = usable.map((box) => {
    const x = Math.max(0, Math.floor((box.x - TEXT_MASK_PADDING) * dimensions.width));
    const y = Math.max(0, Math.floor((box.y - TEXT_MASK_PADDING) * dimensions.height));
    const right = Math.min(dimensions.width, Math.ceil((box.x + box.width + TEXT_MASK_PADDING) * dimensions.width));
    const bottom = Math.min(dimensions.height, Math.ceil((box.y + box.height + TEXT_MASK_PADDING) * dimensions.height));
    return `<rect x="${x}" y="${y}" width="${Math.max(1, right - x)}" height="${Math.max(1, bottom - y)}" fill="white"/>`;
  }).join("");
  const svg = Buffer.from(
    `<svg width="${dimensions.width}" height="${dimensions.height}" xmlns="http://www.w3.org/2000/svg">`
      + `${fills}</svg>`,
  );
  return sharp(svg).ensureAlpha().png({ compressionLevel: 1 }).toBuffer();
}

export async function inpaintTextRegions(env, sourceBytes, maskBytes) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const model = env.BLOCKWISE_OPENAI_IMAGE_MODEL ?? "gpt-image-2";
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", "Remove all text, lettering and logotype from the transparent masked regions, reconstructing the underlying background artwork seamlessly. Every pixel outside the masked regions must stay exactly as it is.");
  form.append("image", new Blob([new Uint8Array(sourceBytes)], { type: "image/png" }), "source.png");
  form.append("mask", new Blob([new Uint8Array(maskBytes)], { type: "image/png" }), "mask.png");
  const response = await fetch(env.CLOUDFLARE_AI_GATEWAY_URL?.includes("/images/generations")
    ? env.CLOUDFLARE_AI_GATEWAY_URL.replace("/images/generations", "/images/edits")
    : "https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const payload = (await response.json().catch(() => ({})));
  if (!response.ok) {
    throw new Error(`OpenAI image edit failed (${response.status}): ${payload.error?.message ?? "unknown"}`);
  }
  const first = payload.data?.[0];
  if (!first?.b64_json) throw new Error("OpenAI returned no inpainted image.");
  return Buffer.from(first.b64_json, "base64");
}

/** Truth-preserving composite: outside the text boxes stays source bytes.
 *  The model may return a fixed-size canvas (gpt-image-2 → 1024²); resample
 *  it to the source's exact dimensions first. */
export async function compositePlateFromSource(sourceBytes, inpaintedBytes, compositeMaskBytes) {
  const sourceMeta = await sharp(sourceBytes).metadata();
  const cut = await sharp(inpaintedBytes)
    .resize(sourceMeta.width, sourceMeta.height, { fit: "fill" })
    .composite([{ input: compositeMaskBytes, blend: "dest-in" }])
    .png()
    .toBuffer();
  return sharp(sourceBytes)
    .composite([{ input: cut, blend: "over" }])
    .png()
    .toBuffer();
}

export async function sha256Hex(bytes) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

export async function writeLosslessWebp(bytes, path) {
  mkdirSync(join(path, ".."), { recursive: true });
  const webp = await sharp(bytes).webp({ lossless: true }).toBuffer();
  writeFileSync(path, webp);
  return { webp, sha: await sha256Hex(webp) };
}

export { hashCanonicalJson };
