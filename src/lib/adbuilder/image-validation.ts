import sharp from "sharp";

// The image travels directly from the browser to private Supabase Storage;
// only metadata crosses the Vercel route, so retain the established 10 MB
// customer-image limit.
export const CUSTOMER_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;

export type CustomerImageValidationReason =
  | "data_url_format"
  | "base64"
  | "size"
  | "magic_bytes"
  | "dimensions"
  | "sharp";

export class CustomerImageValidationError extends Error {
  readonly reason: CustomerImageValidationReason;
  constructor(reason: CustomerImageValidationReason, message: string) {
    super(message);
    this.reason = reason;
    this.name = "CustomerImageValidationError";
  }
}

export async function validateCustomerImageDataUrl(value: string): Promise<Buffer> {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) throw new CustomerImageValidationError("data_url_format", "Unsupported image data URL.");
  const declaredMime = match[1].toLowerCase();
  const encoded = match[2];
  if (encoded.length % 4 === 1) throw new CustomerImageValidationError("base64", "Invalid base64 image payload.");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.length > CUSTOMER_IMAGE_MAX_BYTES) {
    throw new CustomerImageValidationError("size", "Image exceeds the size limit.");
  }
  if (sniffImageMime(bytes) !== declaredMime) {
    throw new CustomerImageValidationError("magic_bytes", "Image bytes do not match the declared type.");
  }
  try {
    await validateCustomerImageBytes(bytes, declaredMime);
  } catch (error) {
    if (error instanceof CustomerImageValidationError) throw error;
    throw new CustomerImageValidationError("sharp", "Sharp could not decode the image.");
  }
  return bytes;
}

export async function validateCustomerImageBytes(bytes: Buffer, declaredMime: string): Promise<void> {
  if (bytes.length === 0 || bytes.length > CUSTOMER_IMAGE_MAX_BYTES) throw new CustomerImageValidationError("size", "Image exceeds the size limit.");
  if (sniffImageMime(bytes) !== declaredMime) throw new CustomerImageValidationError("magic_bytes", "Image bytes do not match the declared type.");
  try {
    const metadata = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) throw new CustomerImageValidationError("dimensions", "Image dimensions are invalid.");
  } catch (error) {
    if (error instanceof CustomerImageValidationError) throw error;
    throw new CustomerImageValidationError("sharp", "Sharp could not decode the image.");
  }
}

export function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}
