import assert from "node:assert/strict";
import test from "node:test";

import { isCloneCreative } from "../src/lib/adstudio/creative-preview.ts";

import {
  handleAdStudioExportDownload,
  type ExportDownloadDependencies,
} from "../src/app/api/adstudio/export-packages/[id]/download-handler.ts";
import type { CreativeExportRender } from "../src/lib/adstudio/creative-export.ts";
import type { AdStudioCampaignPack } from "../src/lib/adstudio/types.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const campaignId = "campaign-1";
const store = { source: "workspace-store" };

function campaignPack(objects: Array<{ objectId: string; content?: string }>): AdStudioCampaignPack {
  return {
    campaign: { campaignId, name: "Authoritative campaign" },
    creatives: [{ canvas: { objects } }],
  } as unknown as AdStudioCampaignPack;
}

function requestBody(body: unknown, onRead?: () => void): Pick<Request, "json"> {
  return {
    json: async () => {
      onRead?.();
      return body;
    },
  };
}

function dependencies(
  overrides: Partial<ExportDownloadDependencies<typeof store>> = {},
): ExportDownloadDependencies<typeof store> {
  return {
    authorize: async () => ({ ok: true, store, workspaceId }),
    loadCampaign: async () => campaignPack([{ objectId: "template_clone_image" }]),
    renderFlatClones: async () => [],
    buildPackage: async () => ({ zipBytes: new Uint8Array([80, 75]) }),
    ...overrides,
  };
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

test("download handler returns auth response without loading campaign or request data", async () => {
  let campaignLoads = 0;
  let bodyReads = 0;
  const unauthorized = new Response("unauthorized", { status: 401 });

  const response = await handleAdStudioExportDownload({
    request: requestBody({}, () => { bodyReads += 1; }),
    campaignId,
    dependencies: dependencies({
      authorize: async () => ({ ok: false, response: unauthorized }),
      loadCampaign: async () => {
        campaignLoads += 1;
        return null;
      },
    }),
  });

  assert.equal(response, unauthorized);
  assert.equal(campaignLoads, 0);
  assert.equal(bodyReads, 0);
});

test("download handler scopes authoritative campaign load to authorized workspace and returns stable 404", async () => {
  const loads: Array<{ receivedStore: typeof store; workspaceId: string; campaignId: string }> = [];
  const response = await handleAdStudioExportDownload({
    request: requestBody({ creativeRenders: [] }),
    campaignId,
    dependencies: dependencies({
      loadCampaign: async (receivedStore, receivedWorkspaceId, receivedCampaignId) => {
        loads.push({
          receivedStore,
          workspaceId: receivedWorkspaceId,
          campaignId: receivedCampaignId,
        });
        return null;
      },
    }),
  });

  assert.deepEqual(loads, [{ receivedStore: store, workspaceId, campaignId }]);
  assert.equal(response.status, 404);
  assert.deepEqual(await responseJson(response), {
    code: "campaign_not_found",
    error: "Campaign not found.",
  });
});

test("authoritative flat clone exports approved server-side renders without trusting the request body", async () => {
  let bodyReads = 0;
  let flatRenderCalls = 0;
  let packageCalls = 0;
  const approvedRenders = [{ creativeId: "approved-clone" }] as unknown as CreativeExportRender[];
  let packagedRenders: CreativeExportRender[] | null = null;
  const response = await handleAdStudioExportDownload({
    request: requestBody(
      { campaignPack: campaignPack([{ objectId: "legacy_image" }]), creativeRenders: [] },
      () => { bodyReads += 1; },
    ),
    campaignId,
    dependencies: dependencies({
      loadCampaign: async () => campaignPack([{ objectId: "template_clone_image", content: "/api/adstudio/media?path=workspace/clone.png" }]),
      renderFlatClones: async (_store, receivedWorkspaceId, receivedPack) => {
        flatRenderCalls += 1;
        assert.equal(receivedWorkspaceId, workspaceId);
        const creative = receivedPack.creatives[0];
        assert.ok(creative && isCloneCreative(creative));
        return approvedRenders;
      },
      buildPackage: async (_pack, options) => {
        packageCalls += 1;
        packagedRenders = options.creativeRenders;
        return { zipBytes: new Uint8Array([80, 75]) };
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(bodyReads, 0);
  assert.equal(flatRenderCalls, 1);
  assert.equal(packageCalls, 1);
  assert.equal(packagedRenders, approvedRenders);
});

test("non-clone campaigns cannot enter the export path", async () => {
  let bodyReads = 0;
  let packageCalls = 0;
  const response = await handleAdStudioExportDownload({
    request: requestBody({}, () => { bodyReads += 1; }),
    campaignId,
    dependencies: dependencies({
      loadCampaign: async () => campaignPack([{ objectId: "layered_image" }]),
      buildPackage: async () => {
        packageCalls += 1;
        return { zipBytes: new Uint8Array() };
      },
    }),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await responseJson(response), {
    code: "clone_required",
    error: "Create this ad from a sample before exporting.",
  });
  assert.equal(bodyReads, 0);
  assert.equal(packageCalls, 0);
});
