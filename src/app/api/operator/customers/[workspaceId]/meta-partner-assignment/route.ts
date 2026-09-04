import { NextResponse } from "next/server";

import { resolveMetaPageAccessToken } from "@/lib/providers/meta-assets";
import {
  getMetaPartnerConfig,
  isMetaPartnerStartEnabled,
  listPartnerVisibleAdAccounts,
  verifyPartnerAccountAccess,
} from "@/lib/providers/meta-partner";
import { requireOperator } from "@/lib/operator/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const workspaceId = await validWorkspaceId(context);
  if (!workspaceId) return invalidWorkspaceResponse();

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("meta_partner_account_assignments")
    .select("workspace_id,ad_account_id,ad_account_name,page_id,page_name,currency,timezone,assigned_at,updated_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assignment: data ?? null });
}

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const workspaceId = await validWorkspaceId(context);
  if (!workspaceId) return invalidWorkspaceResponse();
  if (!isMetaPartnerStartEnabled()) {
    return NextResponse.json({ error: "Meta partner access is not currently enabled." }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as { adAccountId?: unknown; pageId?: unknown };
  const adAccountId = normalizeAdAccountId(body.adAccountId);
  const pageId = typeof body.pageId === "string" ? body.pageId.trim() : "";
  if (!/^act_[0-9]+$/.test(adAccountId) || !/^[0-9]+$/.test(pageId)) {
    return NextResponse.json({ error: "A valid Meta ad account ID and Page ID are required." }, { status: 400 });
  }

  const config = getMetaPartnerConfig();
  if (!config) return NextResponse.json({ error: "Meta partner access is not configured." }, { status: 503 });
  const accountAccessible = await verifyPartnerAccountAccess(config.systemToken, adAccountId).catch(() => false);
  if (!accountAccessible) {
    return NextResponse.json({ error: "The Blockwise system user cannot manage that ad account." }, { status: 409 });
  }

  try {
    await resolveMetaPageAccessToken({ accessToken: config.systemToken, pageId });
  } catch {
    return NextResponse.json(
      { error: "The Blockwise system user does not have a Page access token for that Page." },
      { status: 409 },
    );
  }

  const accounts = await listPartnerVisibleAdAccounts(config.systemToken);
  const account = accounts.find((candidate) => normalizeAdAccountId(candidate.id) === adAccountId);
  if (!account) return NextResponse.json({ error: "The shared ad account could not be loaded." }, { status: 409 });

  const service = createSupabaseServiceClient();
  const { data: workspace } = await service.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  if (!workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });

  const { data, error } = await service
    .from("meta_partner_account_assignments")
    .upsert({
      workspace_id: workspaceId,
      ad_account_id: adAccountId,
      ad_account_name: account.name || adAccountId,
      page_id: pageId,
      page_name: pageId,
      currency: account.currency || "AUD",
      timezone: account.timezone || "Australia/Sydney",
      assigned_by: auth.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id" })
    .select("workspace_id,ad_account_id,ad_account_name,page_id,page_name,currency,timezone,assigned_at,updated_at")
    .single();
  if (error) {
    const conflict = error.code === "23505";
    return NextResponse.json(
      { error: conflict ? "That Meta ad account is already assigned to another workspace." : error.message },
      { status: conflict ? 409 : 500 },
    );
  }
  return NextResponse.json({ assignment: data });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const workspaceId = await validWorkspaceId(context);
  if (!workspaceId) return invalidWorkspaceResponse();
  const service = createSupabaseServiceClient();
  const { error } = await service.from("meta_partner_account_assignments").delete().eq("workspace_id", workspaceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}

async function validWorkspaceId(context: RouteContext): Promise<string | null> {
  const { workspaceId } = await context.params;
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(workspaceId) ? workspaceId : null;
}

function invalidWorkspaceResponse() {
  return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
}

function normalizeAdAccountId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  return id.startsWith("act_") ? id : id ? `act_${id}` : "";
}
