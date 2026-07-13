import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdStudioExportDownload,
  type ExportDownloadDependencies,
} from "../src/app/api/adstudio/export-packages/[id]/download-handler.ts";
import type { CreativeExportRender } from "../src/lib/adstudio/creative-export.ts";
import type { AdStudioCampaignPack } from "../src/lib/adstudio/types.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const campaignId = "campaign-1";
const store = { source: "workspace-store" };

function campaignPack(objects: Array<{ objectId: string }>): AdStudioCampaignPack {
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
    loadCampaign: async () => campaignPack([{ objectId: "legacy_image" }]),
    hydrateRenders: async (_store, _workspaceId, renders) => renders,
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

test("authoritative flat clone returns stable 409 before body, hydration, or packaging", async () => {
  let bodyReads = 0;
  let hydrationCalls = 0;
  let packageCalls = 0;
  const response = await handleAdStudioExportDownload({
    request: requestBody(
      { campaignPack: campaignPack([{ objectId: "legacy_image" }]), creativeRenders: [] },
      () => { bodyReads += 1; },
    ),
    campaignId,
    dependencies: dependencies({
      loadCampaign: async () => campaignPack([{ objectId: "template_clone_image" }]),
      hydrateRenders: async () => {
        hydrationCalls += 1;
        return [];
      },
      buildPackage: async () => {
        packageCalls += 1;
        return { zipBytes: new Uint8Array() };
      },
    }),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await responseJson(response), {
    code: "flat_clone_export_not_ready",
    error: "This AI-designed ad cannot be exported until its approved revision files are ready.",
  });
  assert.equal(bodyReads, 0);
  assert.equal(hydrationCalls, 0);
  assert.equal(packageCalls, 0);
});

test("legacy export ignores client campaign data and packages the authoritative campaign", async () => {
  const authoritative = campaignPack([{ objectId: "legacy_image" }]);
  const maliciousClientPack = campaignPack([{ objectId: "template_clone_image" }]);
  const renders = [{ creativeId: "creative-1" }] as unknown as CreativeExportRender[];
  let packagedCampaign: AdStudioCampaignPack | null = null;
  let hydratedRenders: CreativeExportRender[] | null = null;

  const response = await handleAdStudioExportDownload({
    request: requestBody({ campaignPack: maliciousClientPack, creativeRenders: renders }),
    campaignId,
    dependencies: dependencies({
      loadCampaign: async () => authoritative,
      hydrateRenders: async (_store, receivedWorkspaceId, receivedRenders) => {
        assert.equal(receivedWorkspaceId, workspaceId);
        hydratedRenders = receivedRenders;
        return receivedRenders;
      },
      buildPackage: async (pack) => {
        packagedCampaign = pack;
        return { zipBytes: new Uint8Array([80, 75]) };
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(packagedCampaign, authoritative);
  assert.notEqual(packagedCampaign, maliciousClientPack);
  assert.equal(hydratedRenders, renders);
  assert.match(response.headers.get("content-disposition") ?? "", /authoritative-campaign-creatives\.zip/);
});

test("malformed legacy payload returns stable 400 without hydration or packaging", async () => {
  for (const body of [null, {}, { creativeRenders: "not-an-array" }]) {
    let hydrationCalls = 0;
    let packageCalls = 0;
    const response = await handleAdStudioExportDownload({
      request: requestBody(body),
      campaignId,
      dependencies: dependencies({
        hydrateRenders: async () => {
          hydrationCalls += 1;
          return [];
        },
        buildPackage: async () => {
          packageCalls += 1;
          return { zipBytes: new Uint8Array() };
        },
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await responseJson(response), {
      code: "invalid_export_payload",
      error: "Creative renders are required.",
    });
    assert.equal(hydrationCalls, 0);
    assert.equal(packageCalls, 0);
  }
});
