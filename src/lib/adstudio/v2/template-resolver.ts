// Validated, repo-versioned AdStudio v2 template resolution.
//
// Production reads are rooted at one literal repository directory so Next's
// file tracer can package only the gallery. Tests inject document values
// instead of overriding a filesystem root; an arbitrary runtime path must
// never make Vercel trace the whole repository.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";

import {
  isAdDocInstanceShape,
  templateDocV2Schema,
  type AdDocInstance,
  type AdTemplateDocV2,
} from "./template-doc.ts";
import { hashTemplateDoc } from "./template-hash.ts";

const REPOSITORY_GALLERY_DIR = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "src",
  "lib",
  "adstudio",
  "template-gallery-v2",
);

export function templateGalleryV2Dir(): string {
  return REPOSITORY_GALLERY_DIR;
}

export type TemplateV2Candidate = { value: unknown; strict: boolean };
export type TemplateV2Source = {
  current(templateId: string): unknown | null;
  history(templateId: string, templateHash: string): TemplateV2Candidate[];
};

const repositoryTemplateSource: TemplateV2Source = {
  current(templateId) {
    const documentPath = path.join(
      /*turbopackIgnore: true*/ process.cwd(),
      "src",
      "lib",
      "adstudio",
      "template-gallery-v2",
      templateId,
      "template.json",
    );
    return existsSync(/* turbopackIgnore: true */ documentPath)
      ? JSON.parse(readFileSync(/* turbopackIgnore: true */ documentPath, "utf8"))
      : null;
  },
  history(templateId, templateHash) {
    const templateDir = path.join(
      /*turbopackIgnore: true*/ process.cwd(),
      "src",
      "lib",
      "adstudio",
      "template-gallery-v2",
      templateId,
    );
    const historyDir = path.join(templateDir, "history");
    if (!existsSync(/* turbopackIgnore: true */ historyDir)) return [];

    const candidates: TemplateV2Candidate[] = [];
    const exactPaths = [
      path.join(historyDir, `${templateHash}.json`),
      path.join(historyDir, templateHash, "template.json"),
    ];
    const exact = new Set(exactPaths);
    for (const exactPath of exactPaths) {
      if (existsSync(/* turbopackIgnore: true */ exactPath)) {
        candidates.push({
          value: JSON.parse(readFileSync(/* turbopackIgnore: true */ exactPath, "utf8")),
          strict: true,
        });
      }
    }

    for (const entry of readdirSync(/* turbopackIgnore: true */ historyDir, { withFileTypes: true })) {
      const candidatePath = entry.isFile() && entry.name.endsWith(".json")
        ? path.join(historyDir, entry.name)
        : entry.isDirectory()
          ? path.join(historyDir, entry.name, "template.json")
          : null;
      if (!candidatePath
        || exact.has(candidatePath)
        || !existsSync(/* turbopackIgnore: true */ candidatePath)) continue;
      try {
        candidates.push({
          value: JSON.parse(readFileSync(/* turbopackIgnore: true */ candidatePath, "utf8")),
          strict: false,
        });
      } catch {
        // History may contain non-template metadata; only valid snapshots are candidates.
      }
    }
    return candidates;
  },
};

function validateTemplateValue(templateId: string, value: unknown): AdTemplateDocV2 {
  const parsed = templateDocV2Schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`template ${templateId} failed schema: ${parsed.error.issues[0]?.message}`);
  }
  if (parsed.data.id !== templateId) {
    throw new Error(`template ${templateId}: doc id mismatch (${parsed.data.id})`);
  }
  return parsed.data;
}

/** Missing templates return null; corrupt repository documents fail loudly. */
export function loadTemplateV2(
  templateId: string,
  source: TemplateV2Source = repositoryTemplateSource,
): AdTemplateDocV2 | null {
  if (!/^[a-z0-9-]+$/.test(templateId)) return null;
  const value = source.current(templateId);
  return value === null ? null : validateTemplateValue(templateId, value);
}

/** Resolve the immutable template document pinned to an existing creative. */
export function loadTemplateV2ByHash(
  templateId: string,
  templateHash: string,
  source: TemplateV2Source = repositoryTemplateSource,
): AdTemplateDocV2 | null {
  if (!/^[a-z0-9-]+$/.test(templateId) || !/^[0-9a-f]{64}$/.test(templateHash)) return null;

  const currentValue = source.current(templateId);
  if (currentValue !== null) {
    const current = validateTemplateValue(templateId, currentValue);
    if (hashTemplateDoc(current) === templateHash) return current;
  }

  for (const candidate of source.history(templateId, templateHash)) {
    try {
      const template = validateTemplateValue(templateId, candidate.value);
      if (hashTemplateDoc(template) === templateHash) return template;
    } catch (error) {
      if (candidate.strict) throw error;
    }
  }
  return null;
}

/** A creative can edit values only against its immutable template identity. */
export function matchesAdDocTemplatePin(
  canvas: unknown,
  submitted: Pick<AdDocInstance, "templateId" | "templateHash">,
): boolean {
  return isAdDocInstanceShape(canvas)
    && canvas.templateId === submitted.templateId
    && canvas.templateHash === submitted.templateHash;
}

/** Customer-facing resolver: only human-approved templates are visible. */
export function resolveReadyTemplateV2(
  templateId: string,
  source: TemplateV2Source = repositoryTemplateSource,
): AdTemplateDocV2 | null {
  const template = loadTemplateV2(templateId, source);
  return template && template.exactness.status === "ready" ? template : null;
}

/**
 * Customer editor projection. Geometry and edit rules remain intact, but raw
 * asset references, source identifiers and operator evidence never cross the
 * server boundary. The browser paints only workspace-scoped finished renders.
 */
export function redactTemplateV2ForCustomer(template: AdTemplateDocV2): AdTemplateDocV2 {
  const customer = structuredClone(template);
  const safeSrc = customer.provenance.sample.imageSrc;
  const safeHash = customer.provenance.sample.contentHash;

  customer.provenance.sourceAd = { contentHash: safeHash };
  for (const layout of [customer.formats.feed, customer.formats.story]) {
    if (!layout) continue;
    layout.plate = { src: safeSrc, sha256: safeHash };
    for (const layer of layout.layers) {
      if (layer.type === "overlay_patch") {
        layer.src = safeSrc;
        layer.sha256 = safeHash;
      }
    }
  }
  delete customer.exactness.residualEvidence;
  delete customer.exactness.stressEvidence;
  delete customer.exactness.reviewEvidence;
  return customer;
}
