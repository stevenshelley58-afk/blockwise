// Template resolution (Track A; gallery serving lands with Track E).
//
// Template docs are repo-versioned (plan §5.2), so resolution is a validated
// file read. Env-overridable for tests; missing template is an honest 404 at
// the route, never a crash. Production gallery serving (bundled/static) is
// Track E's job and will reuse this validation.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  isAdDocInstanceShape,
  templateDocV2Schema,
  type AdDocInstance,
  type AdTemplateDocV2,
} from "./template-doc.ts";
import { hashTemplateDoc } from "./template-hash.ts";

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

function loadTemplateAtPath(templateId: string, path: string): AdTemplateDocV2 | null {
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

/**
 * Resolve an instance's pinned template version. Current template comes first;
 * prior repository snapshots live at history/<hash>.json or
 * history/<hash>/template.json. A hash is always recomputed from the document
 * rather than trusted from the filename.
 */
export function loadTemplateV2ByHash(
  templateId: string,
  templateHash: string,
  env: NodeJS.ProcessEnv = process.env,
): AdTemplateDocV2 | null {
  if (!/^[a-z0-9-]+$/.test(templateId) || !/^[0-9a-f]{64}$/.test(templateHash)) return null;
  const templateDir = join(templateGalleryV2Dir(env), templateId);
  const candidates = [
    join(templateDir, "template.json"),
    join(templateDir, "history", `${templateHash}.json`),
    join(templateDir, "history", templateHash, "template.json"),
  ];

  for (const path of candidates) {
    const template = loadTemplateAtPath(templateId, path);
    if (template && hashTemplateDoc(template) === templateHash) return template;
  }

  // Writers that predate the hash-named convention can still leave a
  // template.json snapshot directly in history/. Scan those snapshots, but
  // only accept a document whose computed identity is the requested hash.
  // Ignore non-template history metadata such as evidence blobs; the explicit
  // hash paths above still fail loudly when a requested snapshot is corrupt.
  const historyDir = join(templateDir, "history");
  if (existsSync(historyDir)) {
    const snapshots = readdirSync(historyDir, { withFileTypes: true })
      .flatMap((entry) => {
        if (entry.isFile() && entry.name.endsWith(".json")) return [join(historyDir, entry.name)];
        if (entry.isDirectory()) return [join(historyDir, entry.name, "template.json")];
        return [];
      });
    for (const path of snapshots) {
      try {
        const template = loadTemplateAtPath(templateId, path);
        if (template && hashTemplateDoc(template) === templateHash) return template;
      } catch {
        // Not every historical JSON file is a template snapshot.
      }
    }
  }
  return null;
}

/**
 * A creative is permanently bound to the exact template document used for its
 * first render. The editor may alter values and permitted layer overrides; it
 * may never turn an existing creative into another template.
 */
export function matchesAdDocTemplatePin(
  canvas: unknown,
  submitted: Pick<AdDocInstance, "templateId" | "templateHash">,
): boolean {
  return isAdDocInstanceShape(canvas)
    && canvas.templateId === submitted.templateId
    && canvas.templateHash === submitted.templateHash;
}

/** Customer-facing resolver: only `ready` templates are visible (plan §6). */
export function resolveReadyTemplateV2(
  templateId: string,
  env: NodeJS.ProcessEnv = process.env,
): AdTemplateDocV2 | null {
  const template = loadTemplateV2(templateId, env);
  return template && template.exactness.status === "ready" ? template : null;
}
