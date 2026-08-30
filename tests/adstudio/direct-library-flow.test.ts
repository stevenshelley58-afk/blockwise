import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CustomerAdNotFoundError,
  getOrCreateCustomerAd,
  parseCustomerAdId,
} from "../../src/lib/adstudio/create-customer-ad.ts";
import { loadAdStudioLibraryPage } from "../../src/lib/adstudio/library-read-model.ts";

type QueryCall = {
  table: string;
  method: string;
  args: unknown[];
};

describe("direct Ad Studio Library", () => {
  it("keeps Templates, Library, and Brand Pack available from the Studio navigation", () => {
    const source = readFileSync("src/components/adstudio/studio-navigation.tsx", "utf8");

    assert.match(source, /href: "\/ad-studio", label: "Templates"/);
    assert.match(source, /href: "\/ad-studio\/library", label: "Library"/);
    assert.match(source, /href: "\/ad-studio\/brand", label: "Brand Pack"/);
  });

  it("loads saved ads from the direct customer-ad, active-revision, and template records only", async () => {
    const calls: QueryCall[] = [];
    const rowsByTable: Record<string, Array<Record<string, unknown>>> = {
      ad_customer_ads: [
        {
          id: "ad-1",
          workspace_id: "workspace-1",
          template_id: "template-direct",
          active_revision_id: "revision-active",
          draft_revision_id: "revision-not-active",
          updated_at: "2026-08-30T07:00:00.000Z",
        },
      ],
      ad_revisions: [
        {
          id: "revision-active",
          ad_id: "ad-1",
          revision_number: 3,
          feed_png_path: "workspace-1/adstudio/ads/ad-1/feed.png",
        },
      ],
      ad_templates: [
        {
          template_id: "template-direct",
          template_json: { metadata: { title: "Auction Ready" } },
        },
      ],
    };

    const supabase = {
      from(table: string) {
        calls.push({ table, method: "from", args: [] });
        const query: any = {};
        for (const method of ["select", "eq", "order", "limit", "or", "gt", "in"] as const) {
          query[method] = (...args: unknown[]) => {
            calls.push({ table, method, args });
            return query;
          };
        }
        query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(resolve, reject);
        return query;
      },
      storage: {
        from(bucket: string) {
          assert.equal(bucket, "workspace-artifacts");
          return {
            async createSignedUrl(path: string, _expiresIn: number, options?: { transform?: { width?: number } }) {
              return {
                data: { signedUrl: `signed:${path}:${options?.transform?.width ?? "full"}` },
                error: null,
              };
            },
          };
        },
      },
    };

    const page = await loadAdStudioLibraryPage({
      supabase,
      workspaceId: "workspace-1",
      kind: "ads",
      limit: 24,
    });

    assert.deepEqual(
      calls.filter((call) => call.method === "from").map((call) => call.table),
      ["ad_customer_ads", "ad_revisions", "ad_templates"],
    );
    assert.deepEqual(
      calls.find((call) => call.table === "ad_revisions" && call.method === "in")?.args,
      ["id", ["revision-active"]],
    );
    assert.deepEqual(
      calls.find((call) => call.table === "ad_templates" && call.method === "in")?.args,
      ["template_id", ["template-direct"]],
    );
    assert.equal(calls.some((call) => call.table === "adstudio_creatives"), false);
    assert.equal(calls.some((call) => call.table === "adstudio_campaigns"), false);
    assert.deepEqual(page, {
      items: [
        {
          adId: "ad-1",
          templateId: "template-direct",
          name: "Auction Ready",
          src: "signed:workspace-1/adstudio/ads/ad-1/feed.png:full",
          revisionNumber: 3,
          updatedAt: "2026-08-30T07:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
  });

  it("does not reintroduce the legacy creative or campaign tables into the Library read model", () => {
    const source = readFileSync("src/lib/adstudio/library-read-model.ts", "utf8");

    assert.match(source, /"ad_customer_ads"/);
    assert.match(source, /from\("ad_revisions"\)/);
    assert.match(source, /from\("ad_templates"\)/);
    assert.doesNotMatch(source, /adstudio_creatives/);
    assert.doesNotMatch(source, /adstudio_campaigns/);
  });

  it("opens saved cards in their direct template editor and paginates through the Library API", () => {
    const source = readFileSync("src/components/adstudio/media-library.tsx", "utf8");
    const editorRoute = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/page.tsx", "utf8");
    const apiRoute = readFileSync("src/app/api/adstudio/library/route.ts", "utf8");

    assert.match(source, /href=\{`\/ad-studio\/templates\/\$\{encodeURIComponent\(ad\.templateId\)\}\?adId=\$\{encodeURIComponent\(ad\.adId\)\}`\}/);
    assert.match(source, /new URLSearchParams\(\{ kind, limit: "24", cursor \}\)/);
    assert.match(source, /fetch\(`\/api\/adstudio\/library\?\$\{params\}`/);
    assert.match(source, /Could not load more Library items\. Try again\./);
    assert.match(source, /onClick=\{\(\) => void loadMore\("assets"\)\}/);
    assert.match(source, /onClick=\{\(\) => void loadMore\("ads"\)\}/);
    assert.match(editorRoute, /function TemplateEditorPage/);
    assert.match(editorRoute, /parseCustomerAdId\(query\.adId\)/);
    assert.match(editorRoute, /getOrCreateCustomerAd\([\s\S]*\{ adId: requestedAdId \}\)/);
    assert.doesNotMatch(editorRoute, /PackEditorPage|const pack =/);
    assert.match(apiRoute, /\{ error: "Library could not be loaded\." \}/);
    assert.doesNotMatch(apiRoute, /error instanceof Error \? error\.message/);
  });

  it("preserves the exact saved-ad id through Review and publish and back to the editor", () => {
    const editor = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");
    const publishPage = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/publish/page.tsx", "utf8");
    const publishFlow = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/publish/publish-flow.tsx", "utf8");

    assert.match(editor, /\/publish\?adId=\$\{encodeURIComponent\(adId\)\}/);
    assert.match(publishPage, /parseCustomerAdId\(query\.adId\)/);
    assert.match(publishPage, /if \(!requestedAdId\) notFound\(\)/);
    assert.match(publishPage, /getOrCreateCustomerAd\([\s\S]*\{ adId: requestedAdId \}\)/);
    assert.match(publishPage, /\?adId=\$\{encodeURIComponent\(adId\)\}/);
    assert.match(publishFlow, /\?adId=\$\{encodeURIComponent\(adId\)\}/);
  });

  it("gives first-run workspaces a Brand Pack path instead of a disabled Upload dead end", () => {
    const source = readFileSync("src/components/adstudio/media-library.tsx", "utf8");

    assert.match(source, /Set up your Brand Pack before uploading images\./);
    assert.match(source, /href="\/ad-studio\/brand"/);
    assert.match(source, /Set up Brand Pack/);
    assert.doesNotMatch(source, /disabled=\{uploading \|\| !brandKitId\}/);
    assert.doesNotMatch(source, /reusable brand images/);
  });

  it("accepts one safe saved-ad id and rejects ambiguous or malformed ids", () => {
    const adId = "D9428888-122B-4A80-9A4F-22998B9D6000";
    assert.equal(parseCustomerAdId(adId), adId.toLowerCase());
    assert.equal(parseCustomerAdId([adId]), adId.toLowerCase());
    assert.equal(parseCustomerAdId([adId, adId]), null);
    assert.equal(parseCustomerAdId("not-an-ad-id"), null);
    assert.equal(parseCustomerAdId(""), null);
  });

  it("loads an exact Library ad and its own active revision", async () => {
    const adId = "d9428888-122b-4a80-9a4f-22998b9d6000";
    const revisionId = "8442c288-616d-4f9f-a341-7e1861d20997";
    const calls: QueryCall[] = [];
    const document = {
      schema: "blockwise.ad-document",
      templateId: "template-direct",
      sharedImageValues: {},
      sharedTextValues: { headline: "Saved headline" },
      feedCropOverrides: {},
      storyCropOverrides: {},
      colourMode: "template",
      resolvedColourMap: { primary: "#111111" },
      metaPrimaryText: "Saved primary text",
      metaHeadline: "Saved headline",
      metaDescription: "Saved description",
      metaCta: "LEARN_MORE",
      revision: 4,
      lastRenderedAt: null,
    };
    const supabase = customerAdSupabaseMock({
      calls,
      ad: { id: adId, active_revision_id: revisionId },
      revision: { document_json: document, revision_number: 4 },
    });

    const result = await getOrCreateCustomerAd(
      supabase as never,
      "workspace-1",
      { templateId: "template-direct", semanticColours: {} } as never,
      { adId },
    );

    assert.equal(result.adId, adId);
    assert.deepEqual(result.initialDocument, document);
    assert.deepEqual(
      calls.find((call) => call.table === "ad_customer_ads" && call.method === "eq" && call.args[0] === "id")?.args,
      ["id", adId],
    );
    assert.deepEqual(
      calls.find((call) => call.table === "ad_revisions" && call.method === "eq" && call.args[0] === "ad_id")?.args,
      ["ad_id", adId],
    );
  });

  it("selects one latest template ad before creating and never relies on an unbounded maybeSingle", async () => {
    const calls: QueryCall[] = [];
    const latestAdId = "199a9c42-808f-4aaf-b72e-cf4db71009d6";
    const supabase = customerAdSupabaseMock({
      calls,
      ad: { id: latestAdId, active_revision_id: null },
      revision: null,
    });

    const result = await getOrCreateCustomerAd(
      supabase as never,
      "workspace-1",
      { templateId: "template-direct", semanticColours: {} } as never,
    );

    assert.equal(result.adId, latestAdId);
    assert.deepEqual(
      calls.filter((call) => call.table === "ad_customer_ads" && call.method === "order").map((call) => call.args),
      [
        ["updated_at", { ascending: false }],
        ["id", { ascending: false }],
      ],
    );
    assert.deepEqual(
      calls.find((call) => call.table === "ad_customer_ads" && call.method === "limit")?.args,
      [1],
    );
  });

  it("creates a new template ad only when no latest saved ad exists", async () => {
    const calls: QueryCall[] = [];
    const createdAdId = "944c2f34-319a-45d1-a2ca-0eea1213eed3";
    const supabase = customerAdSupabaseMock({
      calls,
      ad: null,
      revision: null,
      created: { id: createdAdId },
    });

    const result = await getOrCreateCustomerAd(
      supabase as never,
      "workspace-1",
      { templateId: "template-direct", semanticColours: { primary: "#111111" } } as never,
    );

    assert.equal(result.adId, createdAdId);
    assert.deepEqual(
      calls.find((call) => call.table === "ad_customer_ads" && call.method === "insert")?.args,
      [{
        workspace_id: "workspace-1",
        template_id: "template-direct",
        colour_mode: "template",
        resolved_colour_map: { primary: "#111111" },
      }],
    );
  });

  it("fails closed when an exact Library ad does not belong to the workspace and template", async () => {
    const adId = "b530c69b-0c3f-4f2e-b0a4-436b7b6e0fa8";
    const supabase = customerAdSupabaseMock({ calls: [], ad: null, revision: null });

    await assert.rejects(
      getOrCreateCustomerAd(
        supabase as never,
        "workspace-1",
        { templateId: "template-direct", semanticColours: {} } as never,
        { adId },
      ),
      CustomerAdNotFoundError,
    );
    await assert.rejects(
      getOrCreateCustomerAd(
        supabase as never,
        "workspace-1",
        { templateId: "template-direct", semanticColours: {} } as never,
        { adId: "" },
      ),
      CustomerAdNotFoundError,
    );
  });
});

function customerAdSupabaseMock(input: {
  calls: QueryCall[];
  ad: Record<string, unknown> | null;
  revision: Record<string, unknown> | null;
  created?: Record<string, unknown> | null;
}) {
  return {
    from(table: string) {
      const query: any = {};
      for (const method of ["select", "eq", "order", "limit", "insert"] as const) {
        query[method] = (...args: unknown[]) => {
          input.calls.push({ table, method, args });
          return query;
        };
      }
      query.maybeSingle = async () => {
        input.calls.push({ table, method: "maybeSingle", args: [] });
        return { data: table === "ad_customer_ads" ? input.ad : input.revision, error: null };
      };
      query.single = async () => {
        input.calls.push({ table, method: "single", args: [] });
        return { data: input.created ?? null, error: null };
      };
      return query;
    },
  };
}
