import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import {
  createPromptServiceClient,
  listPromptKeySummaries,
  listPromptKeys,
} from "@/lib/operator/prompts/prompt-registry";
import { listPromptTestFixtures } from "@/lib/operator/prompts/prompt-test-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireOperator();

  if (!guard.ok) {
    return guard.response;
  }

  try {
    const client = createPromptServiceClient();
    const [prompts, recentRunsResult] = await Promise.all([
      listPromptKeySummaries(client),
      client
        .from("adstudio_provider_runs")
        .select("id, provider_name, provider_type, model_name, input_json, usage_json, status, error_json, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    return NextResponse.json({
      prompts,
      groups: listPromptKeys(),
      fixtures: listPromptTestFixtures(),
      recentRuns: recentRunsResult.data ?? [],
      recentRunsWarning: recentRunsResult.error?.message,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load prompt controls." },
      { status: 503 },
    );
  }
}
