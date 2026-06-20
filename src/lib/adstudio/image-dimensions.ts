// Pure, dependency-free image dimension parsing from the file header bytes.
// We only need pixel width/height (not a full decode) to choose a photo-prep
// method, so we read the PNG IHDR / JPEG SOF / GIF screen descriptor directly.
// No DOM, no codec dependency — unit-testable and safe on the server.

import { dataUrlToUploadBytes } from "./generated-media.ts";

export type ImageDimensions = { width: number; height: number };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function imageDimensionsFromBytes(bytes: Uint8Array): ImageDimensions | null {
  if (isPng(bytes)) {
    // IHDR is the first chunk; width/height are big-endian uint32 at offsets 16/20.
    const width = readUint32BE(bytes, 16);
    const height = readUint32BE(bytes, 20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return jpegDimensions(bytes);
  }
  if (isGif(bytes)) {
    const width = readUint16LE(bytes, 6);
    const height = readUint16LE(bytes, 8);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

/** Parse dimensions from a `data:image/...;base64,` URL; null for non-data refs. */
export function imageDimensionsFromDataUrl(ref: string): ImageDimensions | null {
  if (!ref.startsWith("data:image/")) return null;
  try {
    return imageDimensionsFromBytes(dataUrlToUploadBytes(ref).bytes);
  } catch {
    return null;
  }
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 24) return false;
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function isGif(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 10 &&
    bytes[0] === 0x47 && // G
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x38 // 8
  );
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2; // skip the SOI marker (FFD8)
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    // SOF0..SOF15 carry frame dimensions, except DHT(C4)/JPG(C8)/DAC(CC) and RSTn.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = readUint16BE(bytes, offset + 5);
      const width = readUint16BE(bytes, offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    // Standalone markers (no length payload): RSTn (D0..D7), SOI, EOI, TEM.
    if (marker >= 0xd0 && marker <= 0xd9) {
      offset += 2;
      continue;
    }
    const segmentLength = readUint16BE(bytes, offset + 2);
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}
