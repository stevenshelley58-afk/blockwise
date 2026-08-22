import { NextResponse, type NextRequest } from "next/server";

import { generateAdStudioTemplateCopy } from "@/lib/adstudio/copy-generation";
import { buildDeterministicCopyProposal } from "@/lib/adstudio/copy-proposal";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { templatePackSchema } from "../../../../../../../packages/ad-template-pack-contract/src/schema.ts";

export const runtime = "nodejs";

function overlayFields(pack: Record<string, unknown>, base: Array<{ key: string; label: string; maxLength: number }>) {
  const defaults = pack.editorDefaults && typeof pack.editorDefaults === "object" ? pack.editorDefaults as Record<string, unknown> : null;
  const values = Array.isArray(defaults?.overlayTextInputs) ? defaults.overlayTextInputs : [];
  const existing = new Set(base.map(field => field.key));
  for (const value of values) {
    if (!value || typeof value !== "object" || typeof (value as Record<string, unknown>).key !== "string") continue;
    const item = value as Record<string, unknown>;
    if (existing.has(item.key as string)) continue;
    base.push({ key: item.key as string, label: typeof item.label === "string" ? item.label : item.key as string, maxLength: typeof item.maxLength === "number" ? item.maxLength : 120 });
  }
  return base;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const body = await readJsonBody<{ brief?: unknown; copy?: unknown }>(request);
  const brief = typeof body.brief === "string" ? body.brief : "";
  const { data: ad } = await access.supabase
    .from("ad_customer_ads")
    .select("template_pack_id")
    .eq("id", id)
    .eq("workspace_id", access.access.workspaceId)
    .maybeSingle();
  if (!ad) return NextResponse.json({ error: "Ad not found" }, { status: 404 });
  const { data: packRow } = await access.supabase
    .from("ad_template_packs")
    .select("pack_json")
    .eq("pack_id", ad.template_pack_id)
    .maybeSingle();
  const parsed = templatePackSchema.safeParse(packRow?.pack_json);
  if (!parsed.success) return NextResponse.json({ error: "Template pack not found" }, { status: 404 });
  const pack = parsed.data as unknown as import("../../../../../../../packages/ad-template-pack-contract/src/types.ts").TemplatePack;
  const fields = overlayFields(packRow?.pack_json && typeof packRow.pack_json === "object" ? packRow.pack_json as Record<string, unknown> : {}, pack.textInputs.map(field => ({ key: field.key, label: field.label, maxLength: field.maxLength })));
  const copy = body.copy && typeof body.copy === "object" ? body.copy as Record<string, string> : {};
  const providerEnabled = Boolean(process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY);
  if (!providerEnabled) {
    return NextResponse.json(buildDeterministicCopyProposal(fields, brief, copy));
  }
  try {
    const result = await generateAdStudioTemplateCopy({
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
      description: brief,
      fields,
      context: { templateName: pack.classification.label },
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, 502);
  }
}
