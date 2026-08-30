import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AdDocumentParsed } from "../../packages/ad-template-contract/src/schema.ts";
import type { AdTemplate } from "../../packages/ad-template-contract/src/types.ts";
import { documentToken } from "../../src/lib/adstudio/document-token.ts";
import {
  directTemplateRevisionIdentity,
  saveAd,
} from "../../src/lib/adstudio/save-ad.ts";

describe("direct-template revision persistence", () => {
  it("commits a real direct-template save with its stable identity and immutable document hash", async () => {
    const template = {
      schema: "blockwise.ad-template",
      templateId: "template-direct",
      imageInputs: [],
      textInputs: [
        {
          key: "headline",
          label: "Headline",
          placeholder: "Template headline",
          maxLength: 80,
        },
      ],
    } as unknown as AdTemplate;
    const document = {
      schema: "blockwise.ad-document",
      templateId: template.templateId,
      sharedImageValues: {},
      sharedTextValues: { headline: "Customer headline" },
      feedCropOverrides: {},
      storyCropOverrides: {},
      colourMode: "template",
      resolvedColourMap: {},
      metaPrimaryText: "Primary text",
      metaHeadline: "Customer headline",
      metaDescription: "Description",
      metaCta: "LEARN_MORE",
      revision: 0,
      lastRenderedAt: null,
    } as AdDocumentParsed;
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const supabase = {
      from(table: string) {
        const query: any = {};
        for (const method of ["select", "eq"] as const) {
          query[method] = () => query;
        }
        query.single = async () => {
          if (table === "ad_customer_ads") {
            return {
              data: {
                id: "ad-1",
                active_revision_id: null,
                template_id: template.templateId,
              },
              error: null,
            };
          }
          if (table === "ad_templates") {
            return { data: { template_json: template }, error: null };
          }
          throw new Error(`Unexpected table: ${table}`);
        };
        return query;
      },
      storage: {
        from(bucket: string) {
          assert.equal(bucket, "workspace-artifacts");
          return {
            async upload() {
              return { error: null };
            },
          };
        },
      },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        return {
          data: {
            id: "revision-1",
            revision_number: 1,
          },
          error: null,
        };
      },
    };

    const result = await saveAd({
      supabase: supabase as never,
      workspaceId: "workspace-1",
      adId: "ad-1",
      document,
      expectedRevision: 0,
      colourMap: {},
      imageValues: {},
      renderPlacement: async (placement) => ({
        sha256: placement === "feed" ? "a".repeat(64) : "b".repeat(64),
        png: Buffer.from(`png:${placement}`),
      }),
    });

    assert.equal(result.revisionNumber, 1);
    assert.equal(result.unchanged, false);
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0]?.name, "commit_ad_revision");

    const revision = rpcCalls[0]?.args.p_revision as Record<string, unknown>;
    assert.equal(
      revision.template_hash,
      "blockwise.ad-template:template-direct",
    );
    assert.equal(revision.document_hash, documentToken(document));
    assert.deepEqual(revision.document_json, document);
  });

  it("uses only the create-only direct template id, not generated-content hash semantics", () => {
    assert.equal(
      directTemplateRevisionIdentity("just-listed-calm-editorial"),
      "blockwise.ad-template:just-listed-calm-editorial",
    );
  });
});
