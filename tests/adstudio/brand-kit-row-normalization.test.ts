import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rowToBrandKit } from "../../src/lib/adstudio/persistence.ts";

describe("legacy Brand Pack row normalization", () => {
  it("turns the partial production E2E row shape into a complete canonical Brand Pack", () => {
    const brandKit = rowToBrandKit({
      id: "brand-kit-1",
      workspace_id: "workspace-1",
      source_type: "manual",
      source_url: "",
      business_name: "Legacy E2E Realty",
      market_country: "AU",
      market_region: "WA",
      updated_at: "2026-08-30T12:00:00.000Z",
      identity_json: {
        businessName: "Legacy E2E Realty",
        marketCountry: "AU",
      },
      logos_json: {},
      colours_json: {
        primary: "#102030",
        background: "#FFFFFF",
      },
      typography_json: {},
      tone_json: {
        voice: "Clear local property advice",
      },
      visual_style_json: {},
      contact_json: {},
      // Live legacy rows can contain an object without the current arrays.
      compliance_json: {},
      review_status: "approved",
      locked_fields_json: null,
    });

    assert.equal(brandKit.identity.businessName, "Legacy E2E Realty");
    assert.equal(brandKit.identity.marketRegion, "WA");
    assert.deepEqual(brandKit.logos, {
      primaryLogoUrl: null,
      darkLogoUrl: null,
      lightLogoUrl: null,
      faviconUrl: null,
    });
    assert.deepEqual(brandKit.colours.confidence, { primary: 0, secondary: 0 });
    assert.equal(brandKit.colours.secondary, "#F1F5F9");
    assert.equal(brandKit.colours.accent, "#31C46F");
    assert.deepEqual(brandKit.tone.avoid, []);
    assert.deepEqual(brandKit.tone.preferredPhrases, []);
    assert.deepEqual(brandKit.tone.sampleCopy, []);
    assert.deepEqual(brandKit.visualStyle.styleTags, []);
    assert.deepEqual(brandKit.contact.socialLinks, []);
    assert.deepEqual(brandKit.compliance, {
      disclaimers: [],
      privacyPolicyUrl: null,
      termsUrl: null,
    });
    assert.deepEqual(brandKit.lockedFields, []);

    assert.doesNotThrow(() => brandKit.compliance.disclaimers.map((disclaimer) => disclaimer));
    assert.doesNotThrow(() => brandKit.tone.preferredPhrases.map((phrase) => phrase));
  });

  it("filters malformed legacy arrays instead of passing unsafe values to the client", () => {
    const brandKit = rowToBrandKit({
      id: "brand-kit-2",
      workspace_id: "workspace-1",
      tone_json: { avoid: ["hype", null, 42], preferredPhrases: "not-an-array" },
      visual_style_json: { styleTags: ["clean", false] },
      contact_json: { socialLinks: ["https://example.test", { unsafe: true }] },
      compliance_json: { disclaimers: ["General information only.", null] },
      locked_fields_json: ["identity.businessName", 12],
    });

    assert.deepEqual(brandKit.tone.avoid, ["hype"]);
    assert.deepEqual(brandKit.tone.preferredPhrases, []);
    assert.deepEqual(brandKit.visualStyle.styleTags, ["clean"]);
    assert.deepEqual(brandKit.contact.socialLinks, ["https://example.test"]);
    assert.deepEqual(brandKit.compliance.disclaimers, ["General information only."]);
    assert.deepEqual(brandKit.lockedFields, ["identity.businessName"]);
  });
});
