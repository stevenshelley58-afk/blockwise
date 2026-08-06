"use client";

// Resolves a repo-public asset src ("/adstudio-templates/…", "/fonts/…") to a
// fetchable URL. Kept tiny on purpose.

export function useAssetUrl(src: string): string | null {
  if (!src) return null;
  if (src.startsWith("data:") || src.startsWith("http")) return src;
  return src.startsWith("/") ? src : `/${src}`;
}
