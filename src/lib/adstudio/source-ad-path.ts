import { isAbsolute, relative, resolve, sep } from "node:path";

const SOURCE_FILE_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp)$/i;

export function isSafeSourceAdFile(value: string): boolean {
  return SOURCE_FILE_PATTERN.test(value) && !value.split("/").includes("..");
}

/** Resolve a committed provenance file without allowing archive traversal. */
export function resolveSourceAdPath(sourceRoot: string, sourceFile: string): string | null {
  if (!isSafeSourceAdFile(sourceFile) || sourceFile.includes("\\") || sourceFile.includes("\0")) {
    return null;
  }
  const root = resolve(sourceRoot);
  const absolute = resolve(root, ...sourceFile.split("/"));
  const fromRoot = relative(root, absolute);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return null;
  return absolute;
}

export function sourceAdContentType(sourceFile: string): "image/jpeg" | "image/png" | "image/webp" | null {
  if (!isSafeSourceAdFile(sourceFile)) return null;
  const extension = sourceFile.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return extension === "png" ? "image/png" : null;
}
