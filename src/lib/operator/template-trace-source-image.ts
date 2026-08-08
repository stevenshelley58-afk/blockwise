// Private source-ad reads belong only to the authenticated source-image route.
// Keeping this out of the shared trace metadata module prevents every trace
// consumer from receiving the entire private source corpus in its function.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolveAdStudioTemplate } from "../adstudio/templates.ts";
import { resolveSourceAdPath, sourceAdContentType } from "../adstudio/source-ad-path.ts";

const SOURCE_DIR = resolve(process.cwd(), "meta_ad_candidates");

export function readSourceImageBytes(templateId: string): { bytes: Buffer; contentType: string } | null {
  const template = resolveAdStudioTemplate(templateId);
  const sourceRelativePath = template?.sourceAd.file;
  if (!sourceRelativePath) return null;

  const sourcePath = resolveSourceAdPath(SOURCE_DIR, sourceRelativePath);
  const contentType = sourceAdContentType(sourceRelativePath);
  if (!sourcePath || !contentType || !existsSync(sourcePath)) return null;

  const bytes = readFileSync(sourcePath);
  return { bytes, contentType };
}
