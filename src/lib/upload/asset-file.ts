export const AD_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;

export const AD_IMAGE_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const LOGO_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;

export const AD_IMAGE_UPLOAD_ACCEPT = AD_IMAGE_UPLOAD_TYPES.join(",");
export const LOGO_UPLOAD_ACCEPT = LOGO_UPLOAD_TYPES.join(",");

export type AssetUploadConstraints = {
  acceptedTypes: readonly string[];
  maxBytes: number;
  typeError: string;
  sizeError: string;
};

const EXTENSION_TYPES: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

export function inferAssetMimeType(file: Pick<File, "name" | "type">): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? "";
}

export function validateAssetUploadFile(
  file: Pick<File, "name" | "size" | "type"> | null | undefined,
  constraints: AssetUploadConstraints,
): string | null {
  if (!file) return null;
  if (!constraints.acceptedTypes.includes(inferAssetMimeType(file))) return constraints.typeError;
  if (file.size > constraints.maxBytes) return constraints.sizeError;
  return null;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === "string" && result) {
        resolve(result);
      } else {
        reject(new Error("Could not read that file."));
      }
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

export function sanitizeUploadFileName(fileName: string): string {
  return fileName.replace(/[^a-z0-9._-]/gi, "-").toLowerCase();
}

export function formatUploadFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const DOWNSCALE_MAX_EDGE = 1600;
const DOWNSCALE_QUALITY = 0.82;
// Photos at or under this size are already small enough to upload as-is.
const DOWNSCALE_SKIP_BYTES = 1_200_000;

// Shrinks large camera/phone photos in the browser before upload so they travel
// fast and stay small enough for the vision model to actually read. Uses only
// native canvas APIs (no dependency). Every failure path returns the original
// file unchanged, so a decode or encode hiccup never blocks an upload.
export async function downscaleImageForUpload(file: File): Promise<File> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  if (file.size <= DOWNSCALE_SKIP_BYTES) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  const longestEdge = Math.max(bitmap.width, bitmap.height);
  const scale = longestEdge > DOWNSCALE_MAX_EDGE ? DOWNSCALE_MAX_EDGE / longestEdge : 1;
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close?.();
    return file;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/jpeg", DOWNSCALE_QUALITY);
  });
  if (!blob || blob.size >= file.size) return file;

  const baseName = file.name.replace(/\.[^./\\]+$/, "");
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}
