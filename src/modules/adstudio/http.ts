import { NextResponse, type NextRequest } from "next/server";

import { hasCapability, type Capability } from "@/modules/auth/capabilities";
import { requireWorkspaceAccess } from "@/modules/auth/workspace-access";
import { createSupabaseServerClient } from "@/modules/supabase/server";

/**
 * Gate an AdStudio API request. Every AdStudio route requires at least the
 * `adstudio` surface (capability `create_ads`). Pass `capability` to require a
 * stronger capability for sensitive mutations — e.g. `approve_ads` for approval
 * routes, `publish_ads` for publishing — so an authoring-only member cannot
 * approve or publish.
 */
export async function requireAdStudioRequest(request: NextRequest, capability?: Capability) {
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "adstudio",
    requestedWorkspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });

  if (!access.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: access.error }, { status: access.status }),
    };
  }

  if (capability) {
    const ctx = {
      role: access.access.role,
      workspaceMode: access.access.workspaceMode,
      isOperator: access.access.isOperator,
    };
    if (!hasCapability(ctx, capability)) {
      return {
        ok: false as const,
        response: NextResponse.json(
          { error: `The "${capability}" capability is required for this action.` },
          { status: 403 },
        ),
      };
    }
  }

  return {
    ok: true as const,
    supabase,
    access: access.access,
  };
}

export async function readJsonBody<T>(request: NextRequest): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

export function errorResponse(error: unknown, status = 500) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "AdStudio request failed." },
    { status },
  );
}
