export type GeneratedUploadBytes = {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
};

export function dataUrlToUploadBytes(dataUrl: string): GeneratedUploadBytes {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error("Generated image was not a supported data URL.");
  }

  const contentType = match[1];
  const bytes = Buffer.from(match[2], "base64");
  return {
    bytes: new Uint8Array(bytes),
    contentType,
    extension: extensionForContentType(contentType),
  };
}

function extensionForContentType(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/svg+xml") return "svg";
  return "png";
}
