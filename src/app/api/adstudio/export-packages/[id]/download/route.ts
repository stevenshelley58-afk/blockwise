import type { NextRequest } from "next/server";

import { buildAdStudioExportPackage } from "@/lib/adstudio";
import {
  renderStoredFlatCloneExports,
} from "@/lib/adstudio/export-render-storage";
import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { loadAdStudioCampaignPack } from "@/lib/adstudio/persistence";
import {
  handleAdStudioExportDownload,
  type ExportDownloadDependencies,
} from "../download-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type AuthorizedRequest = Extract<
  Awaited<ReturnType<typeof requireAdStudioRequest>>,
  { ok: true }
>;
type AdStudioRequestStore = AuthorizedRequest["supabase"];

const dependencies: ExportDownloadDependencies<AdStudioRequestStore> = {
  authorize: async (request) => {
    const access = await requireAdStudioRequest(request as NextRequest);
    if (!access.ok) return { ok: false, response: access.response };
    return {
      ok: true,
      store: access.supabase,
      workspaceId: access.access.workspaceId,
    };
  },
  loadCampaign: loadAdStudioCampaignPack,
  renderFlatClones: renderStoredFlatCloneExports,
  buildPackage: buildAdStudioExportPackage,
};

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { id } = await Promise.resolve(context.params);
  return handleAdStudioExportDownload({
    request,
    campaignId: id,
    dependencies,
  });
}
