import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  activatePausedMetaPublish,
  PublishError,
} from "@/lib/adstudio/publish-adapter";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type ActivateBody = {
  /** Optional explicit plan from the PAUSED publish receipt; defaults to the latest plan for the ad. */
  planId?: string;
};

function providerWritesEnabled() {
  return process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";
}

/**
 * POST /api/adstudio/ads/[id]/activate?workspaceId=...
 *
 * BW-Q — the SEPARATE Activate action for a PAUSED Meta publish. Publish
 * creates campaign / ad set / creative / ad objects PAUSED; this route flips
 * them to ACTIVE only on an explicit customer click. It NEVER auto-lives and
 * NEVER reports the ad was already live.
 *
 * When BLOCKWISE_ENABLE_PROVIDER_WRITES is not "true" the route returns a
 * clear dry-run receipt: the campaign stays PAUSED on Meta and nothing is
 * written.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<ActivateBody>(request);
  const planId = typeof body.planId === "string" && body.planId.trim() ? body.planId.trim() : undefined;

  try {
    const outcome = await activatePausedMetaPublish(createSupabaseServiceClient(), {
      adId: id,
      workspaceId: access.access.workspaceId,
      planId,
      requestedBy: access.access.userId,
      providerWritesEnabled: providerWritesEnabled(),
    });

    if (outcome.mode === "dry_run") {
      return NextResponse.json({
        ok: true,
        mode: "dry_run",
        // The campaign is still PAUSED on Meta — never "live".
        status: outcome.status,
        planId: outcome.planId,
        targets: outcome.targets,
        message: outcome.message,
      });
    }

    return NextResponse.json({
      ok: true,
      mode: "activate",
      status: outcome.status,
      planId: outcome.planId,
      mutationId: outcome.mutationId,
      targets: outcome.targets,
      message: outcome.message,
    });
  } catch (err) {
    if (err instanceof PublishError) {
      const status =
        err.code === "no_paused_plan"
          ? 404
          : err.code === "activation_failed"
            ? 502
            : 400;
      return NextResponse.json({ error: err.code, message: err.message }, { status });
    }
    return errorResponse(err, 500);
  }
}
