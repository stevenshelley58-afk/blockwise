import assert from "node:assert/strict";
import test from "node:test";
import { generateProviderVideoScript } from "../../src/lib/adstudio/video/provider.ts";
import { parseVideoProjectInput } from "../../src/lib/adstudio/video/validation.ts";

test("video provider prompt excludes asset refs and consent identities", async () => {
  const assetUrl = "https://private.example/video.mp4";
  const input = parseVideoProjectInput({
    recipeId: "home_value",
    audience: "Local homeowners",
    objective: "Generate seller leads",
    brief: { serviceArea: "Scarborough", offer: "A local property conversation", creativeBrief: "Show school timing details." },
    assets: [{ id: "secret-asset-id", kind: "video", url: assetUrl }, { id: "logo-1", kind: "logo", url: "https://example.com/logo.png" }],
    consentRecords: [{ id: "secret-consent-id", assetId: "secret-asset-id", subject: "Private Client", scope: "video", capturedAt: "2026-01-01T00:00:00.000Z", status: "approved" }],
  });
  let captured = "";
  await generateProviderVideoScript(input, {
    provider: {
      providerName: "test",
      providerType: "text_generation",
      capabilities: { structuredJson: true },
      generate: async (request) => {
        captured = request.messages[0]?.content ?? "";
        return { json: {}, rawText: "{}", usage: {}, providerMetadata: {} };
      },
    },
  });
  const payload = JSON.parse(captured) as { project: Record<string, unknown> };
  assert.equal(JSON.stringify(payload).includes(assetUrl), false);
  assert.equal(JSON.stringify(payload).includes("secret-asset-id"), false);
  assert.equal(JSON.stringify(payload).includes("Private Client"), false);
  assert.deepEqual(payload.project.assetSummary, { video: 1, logo: 1 });
  assert.equal((payload.project.brief as Record<string, unknown>).creativeBrief, "Show school timing details.");
});
