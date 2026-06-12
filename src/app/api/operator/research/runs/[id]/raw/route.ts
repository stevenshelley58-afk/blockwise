import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const research = createSupabaseServiceClient().schema("research");
  const { data: run, error: runError } = await research
    .from("ad_fetch_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (runError) return NextResponse.json({ error: runError.message }, { status: 500 });
  if (!run) return NextResponse.json({ error: "Fetch run not found." }, { status: 404 });

  const [sourceDocumentResult, snapshotsResult] = await Promise.all([
    run.source_document_id
      ? research
          .from("source_documents")
          .select("id,source,source_url,source_external_id,fetched_at,storage_bucket,storage_path,content_hash,mime_type,byte_size,metadata,created_at")
          .eq("id", run.source_document_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    research
      .from("ad_snapshots")
      .select("id,observed_ad_id,source_provider,payload,payload_hash,changes_from_prior,snapshot_at,created_at")
      .eq("ad_fetch_run_id", id)
      .order("snapshot_at", { ascending: false })
      .limit(100),
  ]);

  if (sourceDocumentResult.error) {
    return NextResponse.json({ error: sourceDocumentResult.error.message }, { status: 500 });
  }
  if (snapshotsResult.error) return NextResponse.json({ error: snapshotsResult.error.message }, { status: 500 });

  return NextResponse.json({
    run,
    sourceDocument: sourceDocumentResult.data,
    snapshots: snapshotsResult.data ?? [],
  });
}
