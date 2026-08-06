// Template resolution (Track A; gallery serving lands with Track E).
//
// Template docs are repo-versioned (plan §5.2), so resolution is a validated
// file read. Env-overridable for tests; missing template is an honest 404 at
// the route, never a crash. Production gallery serving (bundled/static) is
// Track E's job and will reuse this validation.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { templateDocV2Schema, type AdTemplateDocV2 } from "./template-doc.ts";

export function templateGalleryV2Dir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.ADSTUDIO_GALLERY_V2_DIR ?? join(process.cwd(), "src", "lib", "adstudio", "template-gallery-v2"));
}

/**
 * Load + validate a template by id. Returns null (not throw) when absent so
 * routes can 404 cleanly; throws on corrupt docs — a broken gallery file is
 * a deploy bug, same fail-at-load philosophy as the v1 gate.
 */
export function loadTemplateV2(
  templateId: string,
  env: NodeJS.ProcessEnv = process.env,
): AdTemplateDocV2 | null {
  if (!/^[a-z0-9-]+$/.test(templateId)) return null;
  const path = join(templateGalleryV2Dir(env), templateId, "template.json");
  if (!existsSync(path)) return null;
  const parsed = templateDocV2Schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`template ${templateId} failed schema: ${parsed.error.issues[0]?.message}`);
  }
  if (parsed.data.id !== templateId) {
    throw new Error(`template ${templateId}: doc id mismatch (${parsed.data.id})`);
  }
  return parsed.data;
}

/** Customer-facing resolver: only `ready` templates are visible (plan §6). */
export function resolveReadyTemplateV2(
  templateId: string,
  env: NodeJS.ProcessEnv = process.env,
): AdTemplateDocV2 | null {
  const template = loadTemplateV2(templateId, env);
  return template && template.exactness.status === "ready" ? template : null;
}
