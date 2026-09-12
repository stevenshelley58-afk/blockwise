import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Workspace publishing defaults: the privacy policy and lead destination an
 * owner sets once for Meta lead publishing.
 *
 * The Workspace card saves each field as it changes, so there is no Save button
 * competing with the Connect button on the ad-accounts card. Currency and
 * timezone are deliberately NOT writable here: they mirror the connected Meta
 * ad account, which Meta re-checks live at publish time.
 */
type PublishDefaultsBody = {
  privacyPolicyUrl?: string | null;
  leadDestination?: {
    type?: string | null;
    label?: string | null;
    endpoint?: string | null;
  };
};

const LEAD_DESTINATION_TYPES = ["manual", "webhook", "crm"] as const;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as PublishDefaultsBody & { workspaceId?: string };
  const guard = await requireApiWorkspace(request, "self_serve", body.workspaceId ?? null);

  if (!guard.ok) return guard.response;
  if (!guard.access.isOperator && !["owner", "admin", "operator"].includes(guard.access.role)) {
    return NextResponse.json({ error: "Only an owner or admin can change publishing details." }, { status: 403 });
  }

  const patch: Record<string, string | null> = {};

  if (body.privacyPolicyUrl !== undefined) {
    const privacyPolicyUrl = (body.privacyPolicyUrl ?? "").trim();
    if (privacyPolicyUrl && !isHttpUrl(privacyPolicyUrl)) {
      return NextResponse.json({ error: "Enter a full privacy policy URL, starting with https://." }, { status: 400 });
    }
    patch.privacy_policy_url = privacyPolicyUrl || null;
  }

  if (body.leadDestination !== undefined) {
    const type = (body.leadDestination.type ?? "").trim();
    if (type && !LEAD_DESTINATION_TYPES.includes(type as (typeof LEAD_DESTINATION_TYPES)[number])) {
      return NextResponse.json({ error: "Choose a lead destination type." }, { status: 400 });
    }

    const label = (body.leadDestination.label ?? "").trim();
    const endpoint = (body.leadDestination.endpoint ?? "").trim();
    if (type === "webhook" || type === "crm") {
      if (!endpoint) {
        return NextResponse.json({ error: "That destination needs an endpoint." }, { status: 400 });
      }
      if (!isHttpUrl(endpoint)) {
        return NextResponse.json({ error: "Enter a full endpoint URL, starting with https://." }, { status: 400 });
      }
    }

    patch.lead_destination_type = type || null;
    patch.lead_destination_label = label || null;
    patch.lead_destination_endpoint = type === "manual" || !type ? null : endpoint;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("workspaces")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", guard.access.workspaceId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ saved: true });
}
