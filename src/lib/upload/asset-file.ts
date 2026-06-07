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
