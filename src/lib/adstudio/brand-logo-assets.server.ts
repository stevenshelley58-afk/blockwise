import { createHash } from "node:crypto";

import sharp from "sharp";

import { mediaUrlForStoragePath } from "./assets.ts";
import type { AdStudioBrandKit } from "./types.ts";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 25_000_000;
const MAX_OUTPUT_EDGE = 1_600;

type LogoField = keyof AdStudioBrandKit["logos"];

const LOGO_FIELDS: Array<{ field: LogoField; role: string }> = [
  { field: "primaryLogoUrl", role: "primary" },
  { field: "darkLogoUrl", role: "dark" },
  { field: "lightLogoUrl", role: "light" },
  { field: "faviconUrl", role: "mark" },
];

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: Buffer,
        options: { contentType: string; upsert: boolean },
      ) => Promise<{ error: { message: string } | null }>;
      download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }>;
    };
  };
};

export async function storeBrandKitLogoAssets(input: {
  brandKit: AdStudioBrandKit;
  supabase: StorageClient;
  fetcher?: typeof fetch;
}): Promise<{ brandKit: AdStudioBrandKit; warnings: string[] }> {
  const websiteOrigin = new URL(input.brandKit.source.url).origin;
  const fetcher = input.fetcher ?? fetch;
  const logos = { ...input.brandKit.logos };
  const warnings: string[] = [];

  await Promise.all(
    LOGO_FIELDS.map(async ({ field, role }) => {
      const sourceUrl = logos[field];
      if (!sourceUrl) return;

      let parsed: URL;
      try {
        parsed = new URL(sourceUrl);
      } catch {
        warnings.push(`${role}: invalid source URL`);
        return;
      }

      // Website HTML is untrusted input. Keeping automatic downloads on the
      // already-validated website origin prevents a page from turning this
      // route into a fetch proxy for arbitrary hosts.
      if (parsed.protocol !== "https:" || parsed.origin !== websiteOrigin) {
        warnings.push(`${role}: source is not on the website origin`);
        return;
      }

      try {
        const response = await fetcher(parsed, {
          cache: "no-store",
          headers: {
            Accept: "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8",
            Referer: input.brandKit.source.url,
            "User-Agent": "Mozilla/5.0 (compatible; Blockwise Brand Pack/1.0)",
          },
          redirect: "error",
          signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok || new URL(response.url).origin !== websiteOrigin) {
          throw new Error(`download failed (${response.status})`);
        }

        const declaredLength = Number(response.headers.get("content-length") ?? 0);
        if (declaredLength > MAX_SOURCE_BYTES) throw new Error("source exceeds 5 MB");
        const sourceBytes = await readCappedBytes(response, MAX_SOURCE_BYTES);
        const png = await sharp(sourceBytes, { failOn: "error", limitInputPixels: MAX_SOURCE_PIXELS })
          .rotate()
          .resize({
            width: MAX_OUTPUT_EDGE,
            height: MAX_OUTPUT_EDGE,
            fit: "inside",
            withoutEnlargement: true,
          })
          .png({ compressionLevel: 9 })
          .toBuffer();
        const sha256 = createHash("sha256").update(png).digest("hex");
        const storagePath = `${input.brandKit.workspaceId}/brand/${input.brandKit.brandKitId}/extracted-${role}-${sha256}.png`;
        const bucket = input.supabase.storage.from("workspace-artifacts");
        const upload = await bucket.upload(storagePath, png, { contentType: "image/png", upsert: false });

        if (upload.error) {
          const existing = await bucket.download(storagePath);
          if (existing.error || !existing.data) throw new Error(upload.error.message);
          const existingBytes = Buffer.from(await existing.data.arrayBuffer());
          const existingHash = createHash("sha256").update(existingBytes).digest("hex");
          if (existingHash !== sha256) throw new Error("stored asset checksum mismatch");
        }

        const mediaUrl = mediaUrlForStoragePath(input.brandKit.workspaceId, storagePath);
        if (!mediaUrl) throw new Error("could not create media URL");
        logos[field] = mediaUrl;
      } catch (error) {
        warnings.push(`${role}: ${error instanceof Error ? error.message : "could not store logo"}`);
      }
    }),
  );

  return { brandKit: { ...input.brandKit, logos }, warnings };
}

async function readCappedBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("source exceeds 5 MB");
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("source exceeds 5 MB");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}
