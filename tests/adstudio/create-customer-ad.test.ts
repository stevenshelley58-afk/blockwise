import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { getOrCreateCustomerAd, InvalidActiveRevisionError } from "../../src/lib/adstudio/create-customer-ad.ts";
import type { AdDocumentParsed } from "../../packages/ad-template-pack-contract/src/schema.ts";
import type { TemplatePack } from "../../packages/ad-template-pack-contract/src/types.ts";

const fixture = join(fileURLToPath(new URL(".", import.meta.url)), "..", "fixtures", "template-pack", "minimal-feed-story.json");
const pack = JSON.parse(readFileSync(fixture, "utf8")) as TemplatePack;
const workspaceId = "workspace-test";

function document(): AdDocumentParsed {
  return {
    schema: "blockwise.ad-document/v1",
    templateId: pack.templateId,
    templateVersion: pack.version,
    templateHash: pack.manifestSha256,
    rendererVersion: pack.rendererVersion,
    sharedImageValues: {},
    sharedTextValues: {},
    feedCropOverrides: {},
    storyCropOverrides: {},
    colourMode: "template",
    resolvedColourMap: { ...pack.semanticColours },
    metaPrimaryText: "",
    metaHeadline: "",
    metaDescription: "",
    metaCta: "LEARN_MORE",
    revision: 1,
    documentHash: "0".repeat(64),
    lastRenderedHash: null,
  };
}

function fakeSupabase(existing: unknown, revision: unknown, errors: Record<string, { message: string } | null> = {}) {
  return {
    from(table: string) {
      const query = {
        eq() { return query; },
        maybeSingle: async () => table === "ad_customer_ads"
          ? { data: existing, error: errors.existing ?? null }
          : { data: revision, error: errors.revision ?? null },
        insert() { return query; },
        select() { return query; },
        single: async () => ({ data: { id: "created-ad" }, error: null }),
      };
      return query;
    },
  };
}

describe("getOrCreateCustomerAd hydration", () => {
  it("returns the validated active revision document and revision number", async () => {
    const result = await getOrCreateCustomerAd(
      fakeSupabase({ id: "ad-1", active_revision_id: "rev-1" }, { document_json: document(), revision_number: 3 }) as never,
      workspaceId,
      pack,
    );
    assert.equal(result.adId, "ad-1");
    assert.equal(result.revisionNumber, 3);
    assert.deepEqual(result.initialDocument?.schema, "blockwise.ad-document/v1");
  });

  it("fails closed for a corrupt active revision without returning a blank document", async () => {
    await assert.rejects(
      getOrCreateCustomerAd(
      fakeSupabase({ id: "ad-1", active_revision_id: "rev-1" }, { document_json: { corrupt: true }, revision_number: 3 }) as never,
      workspaceId,
      pack,
      ),
      (error: unknown) => error instanceof InvalidActiveRevisionError && error.code === "invalid_active_revision",
    );
  });

  it("fails closed when the active revision row is missing", async () => {
    await assert.rejects(
      getOrCreateCustomerAd(
        fakeSupabase({ id: "ad-1", active_revision_id: "rev-1" }, null) as never,
        workspaceId,
        pack,
      ),
      InvalidActiveRevisionError,
    );
  });

  it("fails closed when either lookup reports an error", async () => {
    await assert.rejects(
      getOrCreateCustomerAd(fakeSupabase(null, null, { existing: { message: "database unavailable" } }) as never, workspaceId, pack),
      /Failed to load customer ad: database unavailable/,
    );
    await assert.rejects(
      getOrCreateCustomerAd(fakeSupabase({ id: "ad-1", active_revision_id: "rev-1" }, null, { revision: { message: "revision read failed" } }) as never, workspaceId, pack),
      /Failed to load saved ad revision: revision read failed/,
    );
  });
});
