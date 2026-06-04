import { NextResponse, type NextRequest } from "next/server";

import { createOpenAiImageProvider } from "@/lib/adstudio";
import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { getInvalidEnvKeys } from "@/lib/config/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  if (getInvalidEnvKeys().includes("OPENAI_API_KEY")) {
    return NextResponse.json({ error: "OPENAI_API_KEY is required for live image generation." }, { status: 503 });
  }

  const provider = createOpenAiImageProvider();
  const serviceSupabase = createSupabaseServiceClient();
  const output = await provider.generate({
    prompt: "premium editorial real estate background",
    referenceAssets: [],
    aspectRatio: "4:5",
    stylePreset: "premium_editorial_real_estate",
    seed: 27,
  });

  await serviceSupabase.from("adstudio_provider_runs").insert({
    workspace_id: access.access.workspaceId,
    provider_name: provider.providerName,
    provider_type: provider.providerType,
    model_name: output.model,
    input_json: { creativeId: id, prompt: "premium editorial real estate background" },
    output_json: output,
    usage_json: output.providerMetadata,
    status: "completed",
  });

  return NextResponse.json({ creativeId: id, background: output });
}
