import { NextResponse } from "next/server";

import { requireAdRadarOperator as requireOperator } from "@/lib/operator/auth";
import { listHermesSkills } from "@/lib/operator/hermes-assets";
import { createResearchServiceClient } from "@/lib/research/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type FileSection = {
  kind: string;
  label: string;
  rows: unknown[];
  error?: string;
};

const SECTION_LIMIT = 100;

export async function GET(req: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const research = createResearchServiceClient().schema("research");

  const [sourceDocuments, mediaBlobs, buildRunReports, skills] = await Promise.all([
    loadSection(
      "source_documents",
      "Source documents",
      research
        .from("source_documents")
        .select("id,source,source_url,storage_bucket,storage_path,content_hash,mime_type,byte_size,fetched_at,created_at")
        .order("fetched_at", { ascending: false })
        .limit(SECTION_LIMIT),
    ),
    loadSection(
      "media_blobs",
      "Media blobs",
      research
        .from("media_blobs")
        .select("content_hash,storage_bucket,storage_path,content_type,byte_size,width,height,duration_ms,last_seen_at")
        .order("last_seen_at", { ascending: false })
        .limit(SECTION_LIMIT),
    ),
    loadSection(
      "build_run_reports",
      "Build run reports",
      research
        .from("build_run_reports")
        .select("id,report_type,severity,status,title,first_seen_at,last_seen_at,occurrences,source_document_id")
        .order("last_seen_at", { ascending: false })
        .limit(SECTION_LIMIT),
    ),
    listHermesSkills()
      .then((rows) => ({ kind: "hermes_skills", label: "Hermes skills", rows }))
      .catch((error: unknown) => ({
        kind: "hermes_skills",
        label: "Hermes skills",
        rows: [],
        error: error instanceof Error ? error.message : "Could not read Hermes skills.",
      })),
  ]);

  const sections = [sourceDocuments, mediaBlobs, buildRunReports, skills];
  if (kind) {
    return NextResponse.json({
      sections: sections.filter((section) => section.kind === kind),
    });
  }

  return NextResponse.json({ sections });
}

async function loadSection<T>(
  kind: string,
  label: string,
  query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<FileSection> {
  const { data, error } = await query;
  return {
    kind,
    label,
    rows: data ?? [],
    ...(error ? { error: error.message } : {}),
  };
}
