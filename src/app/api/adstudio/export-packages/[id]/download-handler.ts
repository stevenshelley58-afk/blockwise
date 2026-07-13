import type { CreativeExportRender } from "../../../../../lib/adstudio/creative-export.ts";
import type { AdStudioCampaignPack } from "../../../../../lib/adstudio/types.ts";

type MaybePromise<Value> = Value | Promise<Value>;

type ExportAuthorization<Store> =
  | { ok: true; store: Store; workspaceId: string }
  | { ok: false; response: Response };

export type ExportDownloadDependencies<Store> = {
  authorize(request: Pick<Request, "json">): Promise<ExportAuthorization<Store>>;
  loadCampaign(
    store: Store,
    workspaceId: string,
    campaignId: string,
  ): Promise<AdStudioCampaignPack | null>;
  hydrateRenders(
    store: Store,
    workspaceId: string,
    renders: CreativeExportRender[],
  ): Promise<CreativeExportRender[]>;
  buildPackage(
    campaign: AdStudioCampaignPack,
    options: { creativeRenders: CreativeExportRender[] },
  ): MaybePromise<{ zipBytes: Uint8Array }>;
};

export async function handleAdStudioExportDownload<Store>(input: {
  request: Pick<Request, "json">;
  campaignId: string;
  dependencies: ExportDownloadDependencies<Store>;
}): Promise<Response> {
  const access = await input.dependencies.authorize(input.request);
  if (!access.ok) return access.response;

  const authoritativePack = await input.dependencies.loadCampaign(
    access.store,
    access.workspaceId,
    input.campaignId,
  );
  if (!authoritativePack) {
    return jsonResponse(
      { code: "campaign_not_found", error: "Campaign not found." },
      404,
    );
  }

  const containsFlatClone = authoritativePack.creatives.some(
    (creative) =>
      creative.canvas.objects.length === 1 &&
      creative.canvas.objects[0]?.objectId === "template_clone_image",
  );
  if (containsFlatClone) {
    return jsonResponse(
      {
        code: "flat_clone_export_not_ready",
        error: "This AI-designed ad cannot be exported until its approved revision files are ready.",
      },
      409,
    );
  }

  const body = await input.request.json().catch(() => null) as {
    creativeRenders?: CreativeExportRender[];
  } | null;
  if (!Array.isArray(body?.creativeRenders)) {
    return jsonResponse(
      { code: "invalid_export_payload", error: "Creative renders are required." },
      400,
    );
  }

  const creativeRenders = await input.dependencies.hydrateRenders(
    access.store,
    access.workspaceId,
    body.creativeRenders,
  );
  const exportPackage = await input.dependencies.buildPackage(
    authoritativePack,
    { creativeRenders },
  );
  const zipBlob = new Blob(
    [new Uint8Array(exportPackage.zipBytes).buffer as ArrayBuffer],
    { type: "application/zip" },
  );
  const filename = `${slugFileName(authoritativePack.campaign.name || "adstudio-campaign")}-creatives.zip`;

  return new Response(zipBlob, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

function jsonResponse(body: Record<string, string>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function slugFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "adstudio-campaign";
}
