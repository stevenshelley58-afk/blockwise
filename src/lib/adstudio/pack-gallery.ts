import { adTemplateSchema } from "../../../packages/ad-template-contract/src/schema";
import type { AdTemplate, Layout } from "../../../packages/ad-template-contract/src/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface TemplateSummary {
  templateId: string; name: string; importedAt: string;
  imageInputs: number; textInputs: number; feedLayout: Layout; storyLayout: Layout;
  semanticColours: Record<string, string>; gallerySampleUrl: string; description: string;
}
export type GallerySamplePlacement = "feed" | "story";
type TemplateRow = { template_id: unknown; template_json: unknown; created_at: unknown };
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const SAFE_ROUTE_PART = /^[A-Za-z0-9._:-]+$/;

export function templateAssetStoragePath(templateId: string, assetKey: string, fileName: string): string {
  return ["templates", templateId, `${assetKey}-${fileName}`]
    .map(component => encodeURIComponent(component))
    .join("/");
}

export function gallerySampleProxyUrl(templateId: string, placement: GallerySamplePlacement = "feed"): string | null {
  if (!SAFE_ROUTE_PART.test(templateId)) return null;
  return `/api/adstudio/templates/${encodeURIComponent(templateId)}/sample?placement=${placement}`;
}

export function templateAssetProxyUrl(templateId: string, assetKey: string): string | null {
  if (!SAFE_ROUTE_PART.test(templateId) || !SAFE_ROUTE_PART.test(assetKey)) return null;
  return `/api/adstudio/templates/${encodeURIComponent(templateId)}/assets/${encodeURIComponent(assetKey)}`;
}

/* Hermes final layered templates are the sole customer gallery source. */
export async function listTemplates(supabase: SupabaseClient): Promise<TemplateSummary[]> {
  const { data, error } = await supabase.from("ad_templates").select("template_id, template_json, created_at").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as TemplateRow[]).flatMap((row) => {
    const template = parseTemplateJson(row.template_json);
    return template ? [summaryFromTemplate(template, row)] : [];
  });
}
export async function getTemplate(supabase: SupabaseClient, templateId: string): Promise<AdTemplate | null> {
  const { data, error } = await supabase.from("ad_templates").select("template_json").eq("template_id", templateId).maybeSingle();
  if (error) throw new Error(error.message);
  return parseTemplateJson(data ? (data as { template_json: unknown }).template_json : null);
}
function summaryFromTemplate(template: AdTemplate, row: TemplateRow): TemplateSummary {
  const metadata = record(template.metadata);
  const templateId = String(row.template_id ?? template.templateId);
  return {
    templateId,
    name: typeof metadata?.title === "string" ? metadata.title : template.templateId,
    description: typeof metadata?.description === "string" ? metadata.description : "Editable Feed and Story ad",
    importedAt: typeof row.created_at === "string" ? row.created_at : template.createdAt,
    imageInputs: template.imageInputs.length, textInputs: template.textInputs.length,
    feedLayout: template.feedLayout as Layout, storyLayout: template.storyLayout as Layout,
    semanticColours: { ...template.semanticColours },
    gallerySampleUrl: gallerySampleProxyUrl(templateId)!,
  };
}
export function parseTemplateJson(value: unknown): AdTemplate | null {
  const parsed = adTemplateSchema.safeParse(value);
  return parsed.success ? parsed.data as AdTemplate : null;
}
