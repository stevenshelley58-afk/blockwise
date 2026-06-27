import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { loadAdvertiserSuggestions } from "../src/lib/research/advertiser-autocomplete.ts";

type Captured = { schema?: string; from?: string; select?: string; ilike?: [string, string] };

function mockSupabase(rows: Array<{ page_id: string | null; page_name: string | null; page_image_url: string | null }>) {
  const captured: Captured = {};
  const builder = {
    select(columns: string) {
      captured.select = columns;
      return builder;
    },
    ilike(column: string, pattern: string) {
      captured.ilike = [column, pattern];
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return Promise.resolve({ data: rows, error: null });
    },
  };
  const client = {
    schema(name: string) {
      captured.schema = name;
      return {
        from(view: string) {
          captured.from = view;
          return builder;
        },
      };
    },
  };
  return { client, captured };
}

test("advertiser autocomplete short-circuits queries shorter than two characters", async () => {
  const { client } = mockSupabase([]);
  assert.deepEqual(await loadAdvertiserSuggestions(client, "r"), []);
});

test("advertiser autocomplete queries the cards view by page name with an escaped contains filter", async () => {
  const { client, captured } = mockSupabase([]);
  await loadAdvertiserSuggestions(client, "50%_off");
  assert.equal(captured.schema, "research");
  assert.equal(captured.from, "v_customer_meta_ad_library_cards");
  assert.deepEqual(captured.ilike, ["page_name", "%50\\%\\_off%"]);
});

test("advertiser autocomplete dedupes by page and ranks prefix matches first", async () => {
  const { client } = mockSupabase([
    { page_id: "p1", page_name: "Murray Realty", page_image_url: "https://cdn.example/m.png" },
    { page_id: "p2", page_name: "Ray White Subiaco", page_image_url: null },
    { page_id: "p2", page_name: "Ray White Subiaco", page_image_url: null },
    { page_id: "p3", page_name: "Ray White Cottesloe", page_image_url: null },
  ]);

  const suggestions = await loadAdvertiserSuggestions(client, "ray");

  assert.deepEqual(
    suggestions.map((s) => s.pageName),
    ["Ray White Cottesloe", "Ray White Subiaco", "Murray Realty"],
  );
  assert.equal(suggestions.length, 3);
  assert.equal(suggestions[0].pageId, "p3");
});

test("advertiser autocomplete route guards, rate-limits, and delegates to the loader", () => {
  const routeSource = readFileSync(
    join(process.cwd(), "src/app/api/research/advertisers/autocomplete/route.ts"),
    "utf8",
  );
  assert.match(routeSource, /requireApiWorkspace\(request, "monitor"\)/);
  assert.match(routeSource, /bucket: "advertisers-autocomplete"/);
  assert.match(routeSource, /loadAdvertiserSuggestions\(supabase, q\)/);
  assert.match(routeSource, /if \(q\.length < 2\)/);
});
