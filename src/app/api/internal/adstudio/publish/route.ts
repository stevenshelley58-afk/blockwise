import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPublishState, validatePublishState, freezePublicationSnapshot } from "@/lib/adstudio/publish-adapter";

/**
 * GET /api/internal/adstudio/publish/state?adId=...&workspaceId=...
 *
 * Loads the authoritative publish state: ad metadata, active revision
 * PNG hashes, template pack, and latest Instant Form.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const adId = searchParams.get("adId");
  const workspaceId = searchParams.get("workspaceId");

  if (!adId || !workspaceId) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "server_configuration" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const state = await loadPublishState(supabase, adId, workspaceId);
    const issues = validatePublishState(state);
    return NextResponse.json({ state, issues, ready: issues.length === 0 }, { status: 200 });
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    return NextResponse.json({ error: err.code ?? "load_failed", message: err.message }, { status: 500 });
  }
}

/**
 * POST /api/internal/adstudio/publish/freeze
 *
 * Freezes a publication snapshot for the given ad + revision.
 * Body: { adId, workspaceId, connectionId, setup, controls }
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !body.adId || !body.workspaceId) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "server_configuration" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const state = await loadPublishState(supabase, body.adId, body.workspaceId);
    const issues = validatePublishState(state, { controls: body.controls ?? {}, setup: body.setup ?? {} });
    if (issues.length > 0) {
      return NextResponse.json({ error: "not_ready", issues }, { status: 400 });
    }

    const { snapshotId } = await freezePublicationSnapshot(supabase, {
      adId: body.adId,
      workspaceId: body.workspaceId,
      connectionId: body.connectionId ?? "",
      setup: body.setup ?? {},
      controls: body.controls ?? {},
    }, state);

    return NextResponse.json({ snapshotId, state }, { status: 201 });
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    const status = err.code === "not_saved" ? 400
      : err.code === "ad_not_found" ? 404
      : 500;
    return NextResponse.json({ error: err.code ?? "freeze_failed", message: err.message }, { status });
  }
}
