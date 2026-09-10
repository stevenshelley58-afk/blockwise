const SAFE_FILENAME = /[^a-zA-Z0-9._-]/g;

export function sanitizeDownloadFilename(value: string, fallback = "blockwise-ad.png"): string {
  const filename = value.trim().replace(SAFE_FILENAME, "_");
  return filename || fallback;
}

export function mediaDownloadHeaders(download: boolean, filename: string): Record<string, string> {
  return download
    ? { "content-disposition": `attachment; filename="${sanitizeDownloadFilename(filename)}"` }
    : {};
}
