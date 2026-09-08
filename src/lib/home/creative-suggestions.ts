import type { TemplateSummary } from "@/lib/adstudio/pack-gallery";

export type HomeCreativeSuggestions = {
  audience: "first_ad" | "returning" | "unknown";
  status: "ready" | "empty" | "exhausted" | "unavailable";
  items: Array<{ templateId: string; name: string; previewUrl: string; href: string }>;
};

export function buildHomeCreativeSuggestions(input: { templates: readonly TemplateSummary[]; usedTemplateIds: ReadonlySet<string>; hasCreatedAds: boolean; usageReadSucceeded: boolean }): HomeCreativeSuggestions {
  if (!input.usageReadSucceeded) return { audience: "unknown", status: "unavailable", items: [] };
  const firstAd = !input.hasCreatedAds;
  const available = input.templates.filter((template) => firstAd || !input.usedTemplateIds.has(template.templateId)).sort((a, b) => firstAd ? starterScore(a) - starterScore(b) || newestFirst(a, b) : newestFirst(a, b));
  if (input.templates.length === 0) return { audience: firstAd ? "first_ad" : "returning", status: "empty", items: [] };
  if (available.length === 0) return { audience: "returning", status: "exhausted", items: [] };
  return { audience: firstAd ? "first_ad" : "returning", status: "ready", items: available.slice(0, 3).map((template) => ({ templateId: template.templateId, name: template.name, previewUrl: template.gallerySampleUrl, href: `/ad-studio/templates/${encodeURIComponent(template.templateId)}` })) };
}
function starterScore(template: TemplateSummary): number { return template.imageInputs + template.textInputs; }
function newestFirst(a: TemplateSummary, b: TemplateSummary): number { const order = Date.parse(b.importedAt) - Date.parse(a.importedAt); return (Number.isFinite(order) ? order : 0) || a.templateId.localeCompare(b.templateId); }
