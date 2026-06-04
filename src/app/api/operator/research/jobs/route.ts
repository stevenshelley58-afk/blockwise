import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOperator } from "@/lib/operator/auth";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ResearchSupabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type WorkQueueInsert = {
  queue_name: string;
  job_type: string;
  dedupe_key: string;
  advertiser_page_id: string | null;
  priority: number;
  payload: Record<string, unknown>;
  status: "pending";
  max_attempts: number;
};

const triggerSchema = z.object({
  jobType: z.enum(["collect_ads_for_page", "classify_ads", "capture_media"]),
  advertiserPageId: z.string().uuid().optional(),
  adCreativeId: z.string().uuid().optional(),
  observedAdId: z.string().uuid().optional(),
});

export async function GET(req: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const jobType = url.searchParams.get("jobType");
  const limit = Math.min(Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);

  let query = guard.supabase
    .schema("research")
    .from("v_operator_work_queue_diagnostics")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (jobType) query = query.eq("job_type", jobType);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobs: data ?? [] });
}

export async function POST(req: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const parsed = triggerSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  let job;
  try {
    job = await buildQueueJob(guard.supabase, parsed.data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create research job." },
      { status: 400 },
    );
  }
  const { data, error } = await guard.supabase
    .schema("research")
    .from("work_queue")
    .insert(job)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ job: data }, { status: 201 });
}

async function buildQueueJob(
  supabase: ResearchSupabase,
  input: z.infer<typeof triggerSchema>,
): Promise<WorkQueueInsert> {
  if (input.jobType === "collect_ads_for_page") {
    if (!input.advertiserPageId) throw new Error("advertiserPageId is required.");
    const { data: page, error } = await supabase
      .schema("research")
      .from("advertiser_pages")
      .select("id,page_id,resolution_decision_id,status")
      .eq("id", input.advertiserPageId)
      .maybeSingle();
    if (error) throw error;
    if (!page?.page_id) throw new Error("Advertiser page was not found.");

    return {
      queue_name: "research",
      job_type: "blockwise-ad-collector",
      dedupe_key: `manual:ad-collector:${page.id}:${Date.now()}`,
      advertiser_page_id: page.id,
      priority: 1,
      payload: {
        advertiserPageId: page.id,
        metaPageId: page.page_id,
        resolverDecisionId: page.resolution_decision_id,
        realEstateGate: {
          verified: true,
          verifiedBySkill: "blockwise-agent-census",
          decisionId: page.resolution_decision_id,
          sourceDocumentIds: [],
          verifiedAt: new Date().toISOString(),
        },
        country: "AU",
        activeStatus: "all",
      },
      status: "pending",
      max_attempts: 3,
    };
  }

  if (input.jobType === "classify_ads") {
    if (!input.adCreativeId || !input.observedAdId) throw new Error("adCreativeId and observedAdId are required.");
    return {
      queue_name: "research",
      job_type: "blockwise-ad-classifier",
      dedupe_key: `manual:classifier:${input.adCreativeId}:${Date.now()}`,
      advertiser_page_id: null,
      priority: 2,
      payload: { adCreativeId: input.adCreativeId, observedAdId: input.observedAdId },
      status: "pending",
      max_attempts: 3,
    };
  }

  if (!input.adCreativeId || !input.observedAdId) throw new Error("adCreativeId and observedAdId are required.");
  return {
    queue_name: "research",
    job_type: "blockwise-media-collector",
    dedupe_key: `manual:media:${input.adCreativeId}:${Date.now()}`,
    advertiser_page_id: null,
    priority: 2,
    payload: { adCreativeId: input.adCreativeId, observedAdId: input.observedAdId },
    status: "pending",
    max_attempts: 3,
  };
}
