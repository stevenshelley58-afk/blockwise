import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProviderRunRow = {
  id: string;
  workspace_id: string;
  job_id: string | null;
  provider_name: string | null;
  provider_type: string | null;
  model_name: string | null;
  prompt_version_id: string | null;
  usage_json: unknown;
  cost_estimate: number | null;
  status: string | null;
  error_json: { message?: string; code?: string } | null;
  created_at: string;
};

export async function GET(request: NextRequest) {
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const { data, error } = await access.supabase
    .from("adstudio_provider_runs")
    .select("id, workspace_id, job_id, provider_name, provider_type, model_name, prompt_version_id, usage_json, cost_estimate, status, error_json, created_at")
    .eq("workspace_id", access.access.workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ providerRuns: [] });
  }

  const providerRuns = (data ?? []).map((run: ProviderRunRow) => ({
    id: run.id,
    workspaceId: run.workspace_id,
    jobId: run.job_id,
    providerName: run.provider_name,
    providerType: run.provider_type,
    modelName: run.model_name,
    promptVersionId: run.prompt_version_id,
    usageJson: run.usage_json,
    costEstimate: run.cost_estimate,
    status: run.status,
    errorSummary: run.error_json
      ? (run.error_json.message?.slice(0, 200) ?? run.error_json.code ?? "An error occurred")
      : null,
    createdAt: run.created_at,
  }));

  return NextResponse.json({ providerRuns });
}
