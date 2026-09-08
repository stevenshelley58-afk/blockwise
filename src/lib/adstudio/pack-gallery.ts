import { adTemplateSchema } from "../../../packages/ad-template-contract/src/schema.ts";
import { MINIMUM_TEXT_SIZE_PX, type AdTemplate, type Layout } from "../../../packages/ad-template-contract/src/types.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface TemplateSummary {
  templateId: string; name: string; importedAt: string;
  imageInputs: number; textInputs: number; feedLayout: Layout; storyLayout: Layout;
  semanticColours: Record<string, string>; gallerySampleUrl: string; description: string;
  leadType: TemplateLeadType;
}
export type TemplateLeadType = "seller" | "buyer" | "appraisal" | "open_home" | "market_update" | "other";
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

export function gallerySampleProxyUrl(templateId: string, placement: GallerySamplePlacement = "feed", existingAdId?: string): string | null {
  if (!SAFE_ROUTE_PART.test(templateId)) return null;
  const path = `/api/adstudio/templates/${encodeURIComponent(templateId)}/sample?placement=${placement}`;
  if (!existingAdId) return path;
  return SAFE_ROUTE_PART.test(existingAdId) ? `${path}&adId=${encodeURIComponent(existingAdId)}` : null;
}

export function templateAssetProxyUrl(templateId: string, assetKey: string, existingAdId?: string): string | null {
  if (!SAFE_ROUTE_PART.test(templateId) || !SAFE_ROUTE_PART.test(assetKey)) return null;
  const path = `/api/adstudio/templates/${encodeURIComponent(templateId)}/assets/${encodeURIComponent(assetKey)}`;
  if (!existingAdId) return path;
  return SAFE_ROUTE_PART.test(existingAdId) ? `${path}?adId=${encodeURIComponent(existingAdId)}` : null;
}

/* Hermes final layered templates are the sole customer gallery source. */
export async function listTemplates(supabase: SupabaseClient): Promise<TemplateSummary[]> {
  const { data, error } = await supabase
    .from("ad_templates")
    .select("template_id, template_json, created_at")
    .eq("library_status", "active")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as TemplateRow[]).flatMap((row) => {
    const template = parseTemplateJson(row.template_json);
    return template ? [summaryFromTemplate(template, row)] : [];
  });
}
export async function getTemplate(supabase: SupabaseClient, templateId: string): Promise<AdTemplate | null> {
  const { data, error } = await supabase
    .from("ad_templates")
    .select("template_json")
    .eq("template_id", templateId)
    .eq("library_status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseTemplateJson(data ? (data as { template_json: unknown }).template_json : null);
}

/** Service-role inspection only. Customer discovery must use getTemplate. */
export async function getTemplateForInternalInspection(supabase: SupabaseClient, templateId: string): Promise<AdTemplate | null> {
  return parseTemplateJson(await readTemplateJson(supabase, templateId));
}

async function readTemplateJson(supabase: SupabaseClient, templateId: string): Promise<unknown> {
  const { data, error } = await supabase
    .from("ad_templates")
    .select("template_json")
    .eq("template_id", templateId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (data as { template_json: unknown }).template_json : null;
}

/**
 * Preserves a workspace's saved-ad history without reopening a quarantined
 * template to discovery. The customer client proves ownership before the
 * service-role client reads the immutable source template.
 */
export async function getTemplateForExistingCustomerAd(input: {
  customerSupabase: SupabaseClient;
  internalSupabase: SupabaseClient;
  workspaceId: string;
  adId: string;
  templateId: string;
}): Promise<AdTemplate | null> {
  const { data: ad, error } = await input.customerSupabase
    .from("ad_customer_ads")
    .select("id")
    .eq("id", input.adId)
    .eq("workspace_id", input.workspaceId)
    .eq("template_id", input.templateId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!ad) return null;
  return parseTemplateJsonForSavedAdHistory(await readTemplateJson(input.internalSupabase, input.templateId));
}
function summaryFromTemplate(template: AdTemplate, row: TemplateRow): TemplateSummary {
  const metadata = record(template.metadata);
  const templateId = String(row.template_id ?? template.templateId);
  const name = typeof metadata?.title === "string" ? metadata.title : template.templateId;
  const description = typeof metadata?.description === "string" ? metadata.description : "Editable Feed and Story ad";
  return {
    templateId,
    name,
    description,
    leadType: templateLeadType([name, description, template.metadata.publishRequirements.objective, template.metadata.aiWritingGuidance.summary].join(" ")),
    importedAt: typeof row.created_at === "string" ? row.created_at : template.createdAt,
    imageInputs: template.imageInputs.length, textInputs: template.textInputs.length,
    feedLayout: template.feedLayout as Layout, storyLayout: template.storyLayout as Layout,
    semanticColours: { ...template.semanticColours },
    gallerySampleUrl: gallerySampleProxyUrl(templateId)!,
  };
}

export function templateLeadType(value: string): TemplateLeadType {
  const text = value.toLocaleLowerCase();
  if (/appraisal|valuation|price estimate|property estimate/u.test(text)) return "appraisal";
  if (/open[ -]?home|inspection|auction/u.test(text)) return "open_home";
  if (/market update|market report|suburb report/u.test(text)) return "market_update";
  if (/seller|vendor|just sold|listing nurture|listing presentation/u.test(text)) return "seller";
  if (/buyer|just listed|new listing|property feature/u.test(text)) return "buyer";
  return "other";
}
export function parseTemplateJson(value: unknown): AdTemplate | null {
  const parsed = adTemplateSchema.safeParse(value);
  return parsed.success ? parsed.data as AdTemplate : null;
}

/**
 * Compatibility reader for an exact workspace-owned saved ad. Historical
 * templates predate the release-only 24px Feed / 32px Story readability floor,
 * but their authored sizes must remain unchanged when old work is reopened.
 * All other current structural, geometry, input, asset, font, and tracking
 * constraints still pass through adTemplateSchema. Discovery and new-ad flows
 * continue to use parseTemplateJson and therefore remain strict.
 */
export function parseTemplateJsonForSavedAdHistory(value: unknown): AdTemplate | null {
  const template = record(value);
  if (!template) return null;
  const originalFontSizes = new Map<string, number>();

  const validationLayout = (rawLayout: unknown, placement: "feed" | "story"): unknown => {
    const layout = record(rawLayout);
    if (!layout || !Array.isArray(layout.layers)) return rawLayout;
    return {
      ...layout,
      layers: layout.layers.map((rawLayer) => {
        const layer = record(rawLayer);
        if (
          layer?.type !== "text"
          || typeof layer.layerId !== "string"
          || typeof layer.fontSize !== "number"
          || !Number.isFinite(layer.fontSize)
          || layer.fontSize <= 0
        ) return rawLayer;
        originalFontSizes.set(`${placement}:${layer.layerId}`, layer.fontSize);
        return { ...layer, fontSize: Math.max(layer.fontSize, MINIMUM_TEXT_SIZE_PX[placement]) };
      }),
    };
  };

  const parsed = adTemplateSchema.safeParse({
    ...template,
    feedLayout: validationLayout(template.feedLayout, "feed"),
    storyLayout: validationLayout(template.storyLayout, "story"),
  });
  if (!parsed.success) return null;

  const restoreLayout = (layout: Layout, placement: "feed" | "story"): Layout => ({
    ...layout,
    layers: layout.layers.map((layer) => (
      layer.type === "text" && originalFontSizes.has(`${placement}:${layer.layerId}`)
        ? { ...layer, fontSize: originalFontSizes.get(`${placement}:${layer.layerId}`)! }
        : layer
    )),
  });
  return {
    ...parsed.data,
    feedLayout: restoreLayout(parsed.data.feedLayout, "feed"),
    storyLayout: restoreLayout(parsed.data.storyLayout, "story"),
  } as AdTemplate;
}
