import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import {
  checkMetaConnectionHealth,
  fetchMetaAssetCatalog,
  pickDefaultMetaSetupFromAssets,
  type MetaAssetCatalog,
} from "@/lib/providers/meta-assets";
import {
  resolveMetaConnectionSetup,
  validateMetaConnectionSetup,
  type MetaConnectionSetup,
} from "@/lib/providers/meta-execution";
import { loadStoredProviderTokens } from "@/lib/providers/provider-connections";
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
  const guard = await requireApiWorkspace(request, "monitor");

  if (!guard.ok) return guard.response;
  const { access } = guard;
  if (!canManageProviderConnections(access)) {
    return NextResponse.json({ error: "Provider connection management is not allowed." }, { status: 403 });
  }

  const serviceSupabase = createSupabaseServiceClient();
  const connection = await loadMetaConnection(serviceSupabase, access.workspaceId);

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
  let assets: MetaAssetCatalog | null = null;
  let assetsError: string | null = null;
  if (tokens.accessToken) {
    // The settings form degrades to manual ID entry when the catalog is
    // unavailable, so the reason must reach the UI instead of being
    // swallowed; silent nulls previously hid token and permission failures.
    try {
      assets = await fetchMetaAssetCatalog({
        accessToken: tokens.accessToken,
        selectedAdAccountId: storedSetup.metaAdAccountId,
        selectedPageId: storedSetup.pageId,
      });
      if (isPartnerConnection(connection)) {
        const assignment = await loadPartnerAssignment(serviceSupabase, access.workspaceId);
        assets = assignment ? {
          ...assets,
          adAccounts: assets.adAccounts.filter((account) => account.id === assignment.ad_account_id),
          pages: assets.pages.filter((page) => page.id === assignment.page_id),
          instagramActors: assets.instagramActors.filter((actor) => actor.pageId === assignment.page_id),
          leadForms: assets.leadForms.filter((form) => form.pageId === assignment.page_id),
        } : { ...assets, adAccounts: [], pages: [], instagramActors: [], pixels: [], leadForms: [] };
      }
    } catch (error) {
      assetsError = error instanceof Error ? error.message : "Meta asset request failed.";
    }
  }
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
    .eq("workspace_id", access.workspaceId)
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
    assetsError,
  });
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const guard = await requireApiWorkspace(request, "monitor", body.workspaceId ?? request.nextUrl.searchParams.get("workspaceId"));

  if (!guard.ok) return guard.response;
  const { access } = guard;

  if (!canManageProviderConnections(access)) {
    return NextResponse.json({ error: "Provider connection management is not allowed." }, { status: 403 });
  }

  const serviceSupabase = createSupabaseServiceClient();
  const connection = await loadMetaConnection(serviceSupabase, access.workspaceId);

  if (!connection) {
    return NextResponse.json({ error: "Meta account is not connected." }, { status: 404 });
  }

  const currentSetup = resolveMetaConnectionSetup(connection.metadata_json ?? {}, connection.external_account_id);
  const nextSetup = mergeSetup(currentSetup, body.setup ?? {});
  const blockers = validateMetaConnectionSetup(nextSetup);
  const accountChanged = Boolean(nextSetup.metaAdAccountId) && nextSetup.metaAdAccountId !== connection.external_account_id;

  const tokens = await loadStoredProviderTokens(serviceSupabase, connection.id);
  if (!tokens.accessToken) {
    return NextResponse.json({ error: "Meta access has expired. Reconnect Meta first." }, { status: 409 });
  }
  const assets = await fetchMetaAssetCatalog({
    accessToken: tokens.accessToken,
    selectedAdAccountId: nextSetup.metaAdAccountId,
    selectedPageId: nextSetup.pageId,
  }).catch(() => null);
  if (!assets?.adAccounts.some((account) => account.id === nextSetup.metaAdAccountId)) {
    return NextResponse.json({ error: "The connected Meta token cannot access that ad account." }, { status: 409 });
  }
  if (!assets.pages.some((page) => page.id === nextSetup.pageId)) {
    return NextResponse.json({ error: "The connected Meta token cannot access that Page." }, { status: 409 });
  }
  if (isPartnerConnection(connection)) {
    const assignment = await loadPartnerAssignment(serviceSupabase, access.workspaceId);
    if (
      !assignment ||
      assignment.ad_account_id !== nextSetup.metaAdAccountId ||
      assignment.page_id !== nextSetup.pageId
    ) {
      return NextResponse.json(
        { error: "That Meta account and Page are not assigned to this workspace." },
        { status: 403 },
      );
    }
  }

  // Switching the ad account can collide with a historical row that already
  // holds the target account id (unique workspace+provider+account). Those
  // rows are FK-referenced by publish plans, so archive them (rename +
  // demote) instead of deleting to free the slot for the active connection.
  if (accountChanged) {
    const { data: conflictRows } = await serviceSupabase
      .from("provider_connections")
      .select("id, external_account_id")
      .eq("workspace_id", access.workspaceId)
      .eq("provider", "meta")
      .eq("external_account_id", nextSetup.metaAdAccountId)
      .neq("id", connection.id);

    for (const conflict of (conflictRows ?? []) as Array<{ id: string; external_account_id: string | null }>) {
      const { error: archiveError } = await serviceSupabase
        .from("provider_connections")
        .update({
          external_account_id: `${conflict.external_account_id}#archived-${conflict.id.slice(0, 8)}`,
          status: "not_connected",
        })
        .eq("id", conflict.id);

      if (archiveError) {
        return NextResponse.json({ error: archiveError.message }, { status: 500 });
      }
    }
  }

  // Keep the connection card label in sync when the account changes; the
  // asset catalog gives the human name, falling back to the account id.
  let nextAccountName: string | null = null;
  if (accountChanged) {
    nextAccountName = assets.adAccounts.find((account) => account.id === nextSetup.metaAdAccountId)?.name ?? null;
    nextAccountName = nextAccountName ?? nextSetup.metaAdAccountId;
  }

  // Merge into the existing meta object instead of replacing it: OAuth writes
  // identity fields there (metaBusinessId, metaBusinessName, tokenExpiresAt)
  // that the setup shape does not carry. Replacing the object wiped the
  // Business Portfolio id, which broke the free live campaign setup claim.
  const previousMeta =
    connection.metadata_json?.meta &&
    typeof connection.metadata_json.meta === "object" &&
    !Array.isArray(connection.metadata_json.meta)
      ? (connection.metadata_json.meta as Record<string, unknown>)
      : {};
  const nextMetadata = {
    ...(connection.metadata_json ?? {}),
    meta: { ...previousMeta, ...nextSetup },
  };
  const { error } = await serviceSupabase
    .from("provider_connections")
    .update({
      external_account_id: nextSetup.metaAdAccountId,
      ...(nextAccountName ? { external_account_name: nextAccountName } : {}),
      metadata_json: nextMetadata,
      status: blockers.length === 0 ? "connected" : "needs_attention",
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id)
    .eq("workspace_id", access.workspaceId)
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

function isPartnerConnection(connection: MetaConnectionRow): boolean {
  return connection.metadata_json?.connectionMethod === "partner_access";
}

async function loadPartnerAssignment(
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>,
  workspaceId: string,
): Promise<{ ad_account_id: string; page_id: string } | null> {
  const { data, error } = await serviceSupabase
    .from("meta_partner_account_assignments")
    .select("ad_account_id,page_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { ad_account_id: string; page_id: string } | null;
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

  // Empty stored values must not clobber asset-derived defaults, otherwise a
  // connection saved before setup always shows blank Page/privacy fields even
  // when the granted assets leave only one sensible choice.
  const patch = Object.fromEntries(
    Object.entries(setup).filter(([, value]) => value !== "" && value != null),
  ) as Partial<MetaConnectionSetup>;

  return mergeSetup(defaults, patch);
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
