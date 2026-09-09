import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveAdvertiserDomain } from "../../src/lib/adstudio/advertiser-domain.ts";
import type { AdStudioBrandKit } from "../../src/lib/adstudio/types.ts";

describe("Ad Studio advertiser domain", () => {
  it("prefers the advertiser website over a social profile in Meta previews", () => {
    const brandKit = {
      source: { type: "website", url: "https://www.exampleagency.com.au/about" },
      compliance: { privacyPolicyUrl: "", termsUrl: "" },
      contact: { socialLinks: ["https://www.facebook.com/exampleagency"] },
    } as AdStudioBrandKit;

    assert.deepEqual(resolveAdvertiserDomain({ brandKit }), {
      host: "exampleagency.com.au",
      baseUrl: "https://www.exampleagency.com.au",
      isPlaceholder: false,
      setupNudge: null,
    });
  });
});
