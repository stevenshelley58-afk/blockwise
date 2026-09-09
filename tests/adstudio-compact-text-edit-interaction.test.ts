import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { requestCreativeEdit, type CreativeEditMutation } from "../src/components/adstudio/canvas/creative-edit-client.ts";
import type { AdStudioCreative } from "../src/lib/adstudio/types.ts";

const flow = readFileSync("src/components/adstudio/ad-studio-customer-flow.tsx", "utf8");

test("compact editor waits for released-template layers and saves exact text as a new revision", async () => {
  assert.match(flow, /requestCreativeLayers\(creative\.creativeId\)/u);
  assert.match(flow, /loadedPlate === textLayers\?\.plate/u);
  assert.match(flow, /renderTextPatch\(\{ plate, box: selected\.box, style: selectedTextStyle, text: value \}\)/u);
  assert.match(flow, /newValue: value \}\)/u);
  assert.doesNotMatch(flow, /newValue: value, patchImage/u);
  assert.match(flow, /disabled=\{!draft\.trim\(\) \|\| busy \|\| !selectedTextInstantReady\}/u);

  const baseRevisionId = "11111111-1111-4111-8111-111111111111";
  const nextRevisionId = "22222222-2222-4222-8222-222222222222";
  const image = "/api/adstudio/media?path=released-template.png";
  const nextImage = "/api/adstudio/media?path=released-template-r2.png";
  const patchImage = "data:image/png;base64,iVBORw0KGgo=";
  const creative = {
    creativeId: "33333333-3333-4333-8333-333333333333",
    activeRevisionId: baseRevisionId,
    canvas: {
      width: 1080,
      height: 1350,
      objects: [{ objectId: "template_clone_image", role: "primary_image", content: image, assetId: image }],
      cloneQa: {
        regions: [{ key: "headline", kind: "text", box: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 } }],
        copyValues: { headline: "Original headline" },
      },
      textLayers: {
        status: "ready",
        builtAt: "2026-08-11T00:00:00.000Z",
        deterministicOnly: true,
        plate: "/api/adstudio/media?path=released-template-plate.png",
        styles: {},
        validFor: [image],
      },
    },
  } as unknown as AdStudioCreative;

  const originalFetch = globalThis.fetch;
  const requestBodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({
      image: nextImage,
      previewImage: patchImage,
      revisionId: nextRevisionId,
      revisionNumber: 2,
      qa: { ...creative.canvas.cloneQa, copyValues: { headline: "A better headline" } },
      textLayers: { ...creative.canvas.textLayers, validFor: [image, nextImage] },
      renderHistory: [image],
      redoHistory: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const result = await requestCreativeEdit({
      creative,
      mutationId: "44444444-4444-4444-8444-444444444444",
      mutation: {
        action: "edit",
        fieldKey: "headline",
        newValue: "A better headline",
        patchImage,
      } as unknown as CreativeEditMutation,
    });
    assert.equal(requestBodies[0]?.patchImage, undefined);
    assert.equal(requestBodies[0]?.newValue, "A better headline");
    assert.equal(requestBodies[0]?.expectedRevisionId, baseRevisionId);
    assert.equal(result.creative.activeRevisionId, nextRevisionId);
    assert.equal(result.creative.canvas.objects[0]?.content, nextImage);
    assert.equal(result.creative.canvas.cloneQa?.copyValues.headline, "A better headline");
    assert.equal(result.previewImage, patchImage);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
