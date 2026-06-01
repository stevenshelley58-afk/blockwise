import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections, requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import {
  checkMetaConnectionHealth,
  fetchMetaAssetCatalog,
  pickDefaultMetaSetupFromAssets,
} from "@/lib/providers/meta-assets";
import {
  resolveMetaConnectionSetup,
  validateMetaConnectionSetup,
  type MetaConnectionSetup,
} from "@/lib/providers/meta-execution";
import { loadStoredProviderTokens } from "@/lib/api-control/provider-connections";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MetaConnectionRow = {
  id: string;
  external_account_id: string | null;
  external_account_name: string | null;
  metadata_json: Record<string, unknown> | null;
  token_expires_at: string | null;
};

type PatchBody = {
  workspaceId?: string;
  setup?: Partial<MetaConnectionSetup>;
};

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const serviceSupabase = createSupabaseServiceClient();
  const connection = await loadMetaConnection(serviceSupabase, access.access.workspaceId);

  if (!connection) {
    return NextResponse.json({
      connected: false,
      setup: null,
      blockers: ["Meta account is not connected."],
      health: null,
      assets: null,
    });
  }

  const tokens = await loadStoredProviderTokens(serviceSupabase, connection.id);
  const storedSetup = resolveMetaConnectionSetup(connection.metadata_json ?? {}, connection.external_account_id);
  const health = await checkMetaConnectionHealth({
    accessToken: tokens.accessToken ?? "",
    tokenExpiresAt: connection.token_expires_at,
  });
  const assets = tokens.accessToken
    ? await fetchMetaAssetCatalog({
        accessToken: tokens.accessToken,
        selectedAdAccountId: storedSetup.metaAdAccountId,
        selectedPageId: storedSetup.pageId,
      }).catch(() => null)
    : null;
  const setup = mergeSetupWithAssetDefaults(storedSetup, assets ? pickDefaultMetaSetupFromAssets(assets) : null);
  const blockers = validateMetaConnectionSetup(setup);

  await serviceSupabase
    .from("provider_connections")
    .update({
      status: health.status === "needs_reconnect" || health.status === "missing_token" ? "needs_attention" : "connected",
      health_status: health.status,
      health_checked_at: health.checkedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id)
    .eq("workspace_id", access.access.workspaceId)
    .eq("provider", "meta");

  return NextResponse.json({
    connected: true,
    connectionId: connection.id,
    accountName: connection.external_account_name,
    setup,
    blockers,
    ready: blockers.length === 0 && health.status !== "needs_reconnect" && health.status !== "missing_token",
    health,
    assets,
  });
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: body.workspaceId ?? request.nextUrl.searchParams.get("workspaceId"),
  });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (!canManageProviderConnections(access.access)) {
    return NextResponse.json({ error: "Provider connection management is not allowed." }, { status: 403 });
  }

  const serviceSupabase = createSupabaseServiceClient();
  const connection = await loadMetaConnection(serviceSupabase, access.access.workspaceId);

  if (!connection) {
    return NextResponse.json({ error: "Meta account is not connected." }, { status: 404 });
  }

  const currentSetup = resolveMetaConnectionSetup(connection.metadata_json ?? {}, connection.external_account_id);
  const nextSetup = mergeSetup(currentSetup, body.setup ?? {});
  const blockers = validateMetaConnectionSetup(nextSetup);
  const nextMetadata = {
    ...(connection.metadata_json ?? {}),
    meta: nextSetup,
  };
  const { error } = await serviceSupabase
    .from("provider_connections")
    .update({
      external_account_id: nextSetup.metaAdAccountId,
      metadata_json: nextMetadata,
      status: blockers.length === 0 ? "connected" : "needs_attention",
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id)
    .eq("workspace_id", access.access.workspaceId)
    .eq("provider", "meta");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    connectionId: connection.id,
    setup: nextSetup,
    blockers,
    ready: blockers.length === 0,
  });
}

async function loadMetaConnection(
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>,
  workspaceId: string,
): Promise<MetaConnectionRow | null> {
  const { data, error } = await serviceSupabase
    .from("provider_connections")
    .select("id,external_account_id,external_account_name,metadata_json,token_expires_at")
    .eq("workspace_id", workspaceId)
    .eq("provider", "meta")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as MetaConnectionRow | null) ?? null;
}

function mergeSetupWithAssetDefaults(setup: MetaConnectionSetup, defaults: MetaConnectionSetup | null): MetaConnectionSetup {
  if (!defaults) return setup;

  return mergeSetup(defaults, setup);
}

function mergeSetup(current: MetaConnectionSetup, patch: Partial<MetaConnectionSetup>): MetaConnectionSetup {
  return resolveMetaConnectionSetup(
    {
      meta: {
        ...current,
        ...patch,
        leadDestination: {
          ...current.leadDestination,
          ...(patch.leadDestination ?? {}),
          config: {
            ...(current.leadDestination.config ?? {}),
            ...(patch.leadDestination?.config ?? {}),
          },
        },
      },
    },
    patch.metaAdAccountId ?? current.metaAdAccountId,
  );
}
