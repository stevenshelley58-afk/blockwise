// Derive a reference-clone brief (input contract + brand accent) from a gallery
// template, at runtime. The gallery sample image carries the design, so a brief
// only declares which images + which copy fields the customer supplies. This is
// the same derivation as scripts/adstudio/build-template-briefs.mjs, as a typed
// library function, so all 26 templates get a brief and stay in lockstep with
// the gallery (no separate brief files to maintain).

import { RAW_ADSTUDIO_GALLERY_TEMPLATES } from "./template-gallery/index.ts";
import type { CloneCopyField, CloneImageSlot, TemplateCloneBrief } from "./reference-clone.ts";

type TemplateObject = {
  type?: string;
  role?: string;
  content?: string;
  width?: number;
  height?: number;
  fill?: string;
};
type GalleryTemplateLike = {
  id: string;
  name?: string;
  format?: string;
  gallery?: { sampleImageSrc?: string };
  canvas?: { objects?: TemplateObject[] };
};

const labelize = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const hexOk = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

function saturation(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

function pickBrandHex(objs: TemplateObject[]): string {
  const fills = objs.filter((o) => hexOk(o.fill)) as Array<TemplateObject & { fill: string }>;
  const pref = fills.find((o) => /cta_button|button|badge_bg|badge_background|brand|accent|kicker_pill|gold|price_badge/i.test(o.role ?? ""));
  if (pref && saturation(pref.fill) > 0.15) return pref.fill.toLowerCase();
  const cand = fills
    .filter((o) => (o.role ?? "") !== "background")
    .map((o) => ({ hex: o.fill.toLowerCase(), s: saturation(o.fill) }))
    .filter((c) => c.s > 0.2)
    .sort((a, b) => b.s - a.s);
  return cand[0]?.hex ?? "#1f9e8f";
}

export function deriveTemplateBrief(template: GalleryTemplateLike): TemplateCloneBrief {
  const objs = Array.isArray(template.canvas?.objects) ? template.canvas!.objects! : [];
  const imgs = objs.filter((o) => o.type === "image");
  const maxArea = Math.max(0, ...imgs.map((o) => (o.width ?? 0) * (o.height ?? 0)));

  const imageSlots: CloneImageSlot[] = imgs.map((o) => {
    const role = o.role ?? "image";
    const area = (o.width ?? 0) * (o.height ?? 0);
    const optional = /head|agent|logo|secondary|thumb|inset/i.test(role) && area < maxArea;
    const ratio = (o.width ?? 1) / (o.height ?? 1);
    return {
      role,
      required: !optional,
      aspect: ratio > 1.15 ? "landscape" : ratio < 0.87 ? "portrait" : "square",
      description: `the customer's ${labelize(role).toLowerCase()} (placed where it sits in the reference)`,
    };
  });
  if (imageSlots.length && !imageSlots.some((s) => s.required)) {
    let best = 0, bestArea = -1;
    imgs.forEach((o, i) => { const a = (o.width ?? 0) * (o.height ?? 0); if (a > bestArea) { bestArea = a; best = i; } });
    imageSlots[best].required = true;
  }

  const copyFields: CloneCopyField[] = objs
    .filter((o) => o.type === "text" && typeof o.content === "string" && o.content.trim().length > 0)
    .map((o) => {
      const v = (o.content as string).trim();
      return { key: o.role ?? "text", label: labelize(o.role ?? "text"), maxLength: Math.max(v.length + 8, 16), default: v };
    });

  return {
    templateId: template.id,
    name: template.name ?? template.id,
    aspectRatio: template.format ?? "4:5",
    referenceImage: template.gallery?.sampleImageSrc ?? "",
    imageSlots,
    copyFields,
    brandHex: pickBrandHex(objs),
  };
}

const BRIEFS = new Map<string, TemplateCloneBrief>(
  (RAW_ADSTUDIO_GALLERY_TEMPLATES as unknown as GalleryTemplateLike[]).map((t) => [t.id, deriveTemplateBrief(t)]),
);

export function getTemplateBrief(templateId: string): TemplateCloneBrief | undefined {
  return BRIEFS.get(templateId);
}

export function listTemplateBriefs(): TemplateCloneBrief[] {
  return [...BRIEFS.values()];
}
