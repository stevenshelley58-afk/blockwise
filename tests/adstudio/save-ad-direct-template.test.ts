import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
            async download() {
              return { data: null, error: { message: "not found" } };
            },
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

  it("returns an unchanged revision when only editor lifecycle metadata changed", async () => {
    const template = {
      schema: "blockwise.ad-template",
      templateId: "template-direct",
      imageInputs: [],
      textInputs: [{ key: "headline", label: "Headline", placeholder: "Template headline", maxLength: 80 }],
    } as unknown as AdTemplate;
    const storedDocument = {
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
      revision: 1,
      lastRenderedAt: "2026-08-30T14:00:00.000Z",
    } as AdDocumentParsed;
    const incomingDocument = {
      ...storedDocument,
      revision: 2,
      lastRenderedAt: "2026-08-30T15:00:00.000Z",
    } as AdDocumentParsed;
    let renderCalls = 0;
    let storageCalls = 0;
    let rpcCalls = 0;

    const supabase = {
      from(table: string) {
        const query: any = {};
        for (const method of ["select", "eq"] as const) query[method] = () => query;
        query.single = async () => {
          if (table === "ad_customer_ads") {
            return { data: { id: "ad-1", active_revision_id: "revision-1", template_id: template.templateId }, error: null };
          }
          if (table === "ad_templates") return { data: { template_json: template }, error: null };
          throw new Error(`Unexpected table: ${table}`);
        };
        query.maybeSingle = async () => {
          assert.equal(table, "ad_revisions");
          return {
            data: {
              id: "revision-1",
              revision_number: 1,
              document_json: storedDocument,
              document_hash: documentToken(storedDocument),
              feed_png_hash: "a".repeat(64),
              story_png_hash: "b".repeat(64),
            },
            error: null,
          };
        };
        return query;
      },
      storage: {
        from() {
          storageCalls += 1;
          throw new Error("unchanged save must not access storage");
        },
      },
      async rpc() {
        rpcCalls += 1;
        throw new Error("unchanged save must not commit a revision");
      },
    };

    const result = await saveAd({
      supabase: supabase as never,
      workspaceId: "workspace-1",
      adId: "ad-1",
      document: incomingDocument,
      expectedRevision: 1,
      colourMap: {},
      imageValues: {},
      renderPlacement: async () => {
        renderCalls += 1;
        throw new Error("unchanged save must not render");
      },
    });

    assert.equal(result.unchanged, true);
    assert.equal(result.revisionId, "revision-1");
    assert.equal(result.revisionNumber, 1);
    assert.equal(renderCalls, 0);
    assert.equal(storageCalls, 0);
    assert.equal(rpcCalls, 0);
  });

  it("verifies identical content-addressed renders before any create-only upload", async () => {
    const template = {
      schema: "blockwise.ad-template",
      templateId: "template-direct",
      imageInputs: [],
      textInputs: [],
    } as unknown as AdTemplate;
    const document = {
      schema: "blockwise.ad-document",
      templateId: template.templateId,
      sharedImageValues: {},
      sharedTextValues: {},
      feedCropOverrides: {},
      storyCropOverrides: {},
      colourMode: "template",
      resolvedColourMap: {},
      metaPrimaryText: "Primary text",
      metaHeadline: "Headline",
      metaDescription: "Description",
      metaCta: "LEARN_MORE",
      revision: 0,
      lastRenderedAt: null,
    } as AdDocumentParsed;
    const bytes = {
      feed: Buffer.from("existing-feed-png"),
      story: Buffer.from("existing-story-png"),
    };
    const hashes = {
      feed: createHash("sha256").update(bytes.feed).digest("hex"),
      story: createHash("sha256").update(bytes.story).digest("hex"),
    };
    let downloadCalls = 0;
    let uploadCalls = 0;
    let rpcCalls = 0;

    const supabase = {
      from(table: string) {
        const query: any = {};
        for (const method of ["select", "eq"] as const) query[method] = () => query;
        query.single = async () => {
          if (table === "ad_customer_ads") {
            return { data: { id: "ad-1", active_revision_id: null, template_id: template.templateId }, error: null };
          }
          if (table === "ad_templates") return { data: { template_json: template }, error: null };
          throw new Error(`Unexpected table: ${table}`);
        };
        return query;
      },
      storage: {
        from(bucket: string) {
          assert.equal(bucket, "workspace-artifacts");
          return {
            async download(path: string) {
              downloadCalls += 1;
              const placement = path.includes("/feed-") ? "feed" : "story";
              return { data: new Blob([bytes[placement]]), error: null };
            },
            async upload() {
              uploadCalls += 1;
              throw new Error("identical existing render must not be uploaded");
            },
          };
        },
      },
      async rpc(name: string) {
        assert.equal(name, "commit_ad_revision");
        rpcCalls += 1;
        return { data: { id: "revision-1", revision_number: 1 }, error: null };
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
      renderPlacement: async (placement) => ({ sha256: hashes[placement], png: bytes[placement] }),
    });

    assert.equal(result.unchanged, false);
    assert.equal(downloadCalls, 2);
    assert.equal(uploadCalls, 0);
    assert.equal(rpcCalls, 1);
  });

  it("uses only the create-only direct template id, not generated-content hash semantics", () => {
    assert.equal(
      directTemplateRevisionIdentity("just-listed-calm-editorial"),
      "blockwise.ad-template:just-listed-calm-editorial",
    );
  });
});
