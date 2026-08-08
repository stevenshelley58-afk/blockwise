import {
  validateAdDocSlotImageBytes,
  validateAdDocSlotImageDimensions,
} from "../adstudio/v2/media.ts";

const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/]+={0,2})$/i;

/** Operator overrides are bytes, never fetch instructions. */
export async function validatedTraceImageDataUrl(value: string): Promise<string> {
  const trimmed = value.trim();
  const match = DATA_URL_PATTERN.exec(trimmed);
  if (!match || match[2]!.length % 4 !== 0) {
    throw new Error("Image overrides must be uploaded JPG, PNG, or WebP files.");
  }

  const contentType = match[1]!.toLowerCase() as "image/jpeg" | "image/png" | "image/webp";
  const bytes = Buffer.from(match[2]!, "base64");
  return validatedTraceImageBytesDataUrl(bytes, contentType);
}

export async function validatedTraceImageBytesDataUrl(
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  if (!/^image\/(?:jpeg|png|webp)$/i.test(contentType)) {
    throw new Error("Image must be a JPG, PNG, or WebP file.");
  }
  const normalizedContentType = contentType.toLowerCase() as "image/jpeg" | "image/png" | "image/webp";
  try {
    validateAdDocSlotImageBytes(bytes, normalizedContentType);
    await validateAdDocSlotImageDimensions(bytes);
  } catch {
    throw new Error("Image must be a valid JPG, PNG, or WebP file within the upload limits.");
  }
  return `data:${normalizedContentType};base64,${bytes.toString("base64")}`;
}

export function isApprovedTraceSamplePath(value: string): boolean {
  return (
    value.startsWith("/adstudio-samples/")
    && !value.includes("..")
    && !value.includes("\\")
    && !value.includes("\0")
    && /\.(?:jpe?g|png|webp)$/i.test(value)
  );
}
