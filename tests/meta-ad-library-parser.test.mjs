import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyMetaAdLibraryPayload } from "../hermes/tools/research-runtime/bin/meta-ad-library-parser.mjs";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "meta-ad-library");
const fixture = (name) => readFileSync(join(fixturesDir, name), "utf8");

test("normal positive results classify as success with structured ads", () => {
  const result = classifyMetaAdLibraryPayload(fixture("positive-plain.json"));
  assert.equal(result.outcome, "success");
  assert.deepEqual(result.adIds, ["391219454073578_101", "391219454073578_102", "391219454073578_103"]);
  assert.equal(result.connectionCount, 3);
  assert.equal(result.pageInfo.hasNextPage, false);
  assert.equal(result.pageInfo.endCursor, "AQHR9c7.example-cursor");
});

test("escaped positive results parse identically to plain payloads", () => {
  const result = classifyMetaAdLibraryPayload(fixture("positive-escaped.json"));
  assert.equal(result.outcome, "success");
  assert.deepEqual(result.adIds, ["891243346185243_201", "891243346185243_202"]);
  assert.equal(result.pageInfo.hasNextPage, false);
  assert.equal(result.pageInfo.endCursor, "CUR.escaped-1");
});

test("reordered connection fields still classify as success", () => {
  const result = classifyMetaAdLibraryPayload(fixture("positive-reordered-fields.json"));
  assert.equal(result.outcome, "success");
  assert.deepEqual(result.adIds, ["678085702054671_301", "678085702054671_302"]);
  assert.equal(result.connectionCount, 2);
  assert.equal(result.pageInfo.hasNextPage, false);
});

const strictZeroPayload = ({
  pageId = "100042841013992",
  count = 0,
  edges = [],
  hasNextPage = false,
  endCursor = "",
  includePage = true,
} = {}) => JSON.stringify({
  data: {
    ad_library_main: {
      search_results_connection: {
        count,
        edges,
        page_info: { has_next_page: hasNextPage, end_cursor: endCursor },
      },
    },
    ...(includePage ? { page: { name: "Fixture Page", id: pageId } } : {}),
  },
});

const relayStreamZeroPayload = ({
  requestedPageId = "100042841013992",
  mappedPageId = requestedPageId,
  conflictingPageId = null,
  queryName = "AdLibraryFoundationRootQuery",
  complete = true,
  isFinal = true,
} = {}) => {
  const preloaderID = "adp_AdLibraryFoundationRootQueryRelayPreloader_fixture";
  const preloaders = [{
    preloaderID,
    queryName,
    variables: { viewAllPageID: mappedPageId },
  }];
  if (conflictingPageId) {
    preloaders.push({
      preloaderID,
      queryName: "AdLibraryFoundationRootQuery",
      variables: { viewAllPageID: conflictingPageId },
    });
  }
  const stream = [
    "RelayPrefetchedStreamCache@fixture",
    "next",
    [],
    [
      preloaderID,
      {
        __bbox: {
          complete,
          result: {
            label: "fixture$defer$AdLibraryV2SearchResultsContainer",
            data: {
              ad_library_main: {
                search_results_connection: {
                  count: 0,
                  edges: [],
                  page_info: { has_next_page: false, end_cursor: "" },
                },
              },
              page: null,
            },
            extensions: { is_final: isFinal },
          },
        },
      },
    ],
  ];
  return [
    '<script type="application/json">',
    JSON.stringify({ preloaders }),
    "</script>",
    '<script data-sjs type="application/json">',
    JSON.stringify({ require: [stream] }),
    "</script>",
  ].join("");
};

test("complete final Relay zero stream is correlated through its exact preloader", () => {
  const result = classifyMetaAdLibraryPayload(relayStreamZeroPayload(), {
    requestedPageId: "100042841013992",
  });
  assert.equal(result.outcome, "confirmed_absence");
  assert.equal(result.connectionCount, 0);
  assert.deepEqual(result.pageInfo, { hasNextPage: false, endCursor: "" });
});

test("Relay preloader correlation fails closed on mismatch or ambiguity", () => {
  for (const html of [
    relayStreamZeroPayload({ mappedPageId: "999999999999999" }),
    relayStreamZeroPayload({ conflictingPageId: "999999999999999" }),
    relayStreamZeroPayload({ queryName: "UnrelatedQuery" }),
  ]) {
    const result = classifyMetaAdLibraryPayload(html, {
      requestedPageId: "100042841013992",
    });
    assert.equal(result.outcome, "partial");
    assert.deepEqual(result.adIds, []);
  }
});

test("Relay zero stream must be both complete and final", () => {
  for (const html of [
    relayStreamZeroPayload({ complete: false }),
    relayStreamZeroPayload({ isFinal: false }),
  ]) {
    const result = classifyMetaAdLibraryPayload(html, {
      requestedPageId: "100042841013992",
    });
    assert.equal(result.outcome, "partial");
    assert.deepEqual(result.adIds, []);
  }
});

test("confirmed absence requires strict page correlation and exhausted empty connection", () => {
  const result = classifyMetaAdLibraryPayload(strictZeroPayload(), {
    requestedPageId: "100042841013992",
  });
  assert.equal(result.outcome, "confirmed_absence");
  assert.equal(result.connectionCount, 0);
  assert.deepEqual(result.pageInfo, { hasNextPage: false, endCursor: "" });
});

test("zero connection with a mismatched or missing exact page stays partial", () => {
  for (const html of [
    strictZeroPayload({ pageId: "999999999999999" }),
    strictZeroPayload({ includePage: false }),
  ]) {
    const result = classifyMetaAdLibraryPayload(html, {
      requestedPageId: "100042841013992",
    });
    assert.equal(result.outcome, "partial");
    assert.deepEqual(result.adIds, []);
    assert.ok(result.warnings.includes("requested_page_connection_not_found"));
  }
});

test("zero connection with a cursor or next page stays partial", () => {
  for (const html of [
    strictZeroPayload({ endCursor: "opaque-cursor" }),
    strictZeroPayload({ hasNextPage: true }),
  ]) {
    const result = classifyMetaAdLibraryPayload(html, {
      requestedPageId: "100042841013992",
    });
    assert.equal(result.outcome, "partial");
    assert.equal(result.connectionCount, 0);
  }
});

test("pagination evidence is surfaced, not inferred", () => {
  const result = classifyMetaAdLibraryPayload(fixture("paginated-results.json"));
  assert.equal(result.outcome, "success");
  assert.equal(result.adIds.length, 3);
  assert.equal(result.connectionCount, 500);
  assert.equal(result.pageInfo.hasNextPage, true);
  assert.equal(result.pageInfo.endCursor, "CUR.next-page-403");
});

test("challenge/captcha is a failure outcome, never zero ads", () => {
  const result = classifyMetaAdLibraryPayload(fixture("challenge-captcha.json"));
  assert.equal(result.outcome, "challenge");
  assert.equal(result.adIds.length, 0);
});

test("login wall is a failure outcome, never zero ads", () => {
  const result = classifyMetaAdLibraryPayload(fixture("login-wall.json"));
  assert.equal(result.outcome, "login_wall");
  assert.equal(result.adIds.length, 0);
});

test("HTTP 200 shell without a connection payload is unparseable", () => {
  const result = classifyMetaAdLibraryPayload(fixture("unparseable-200.json"));
  assert.equal(result.outcome, "unparseable");
});

test("empty input is unparseable, not absence", () => {
  const result = classifyMetaAdLibraryPayload("");
  assert.equal(result.outcome, "unparseable");
});
test("parser is deterministic across repeated runs", () => {
  const first = classifyMetaAdLibraryPayload(fixture("positive-plain.json"));
  const second = classifyMetaAdLibraryPayload(fixture("positive-plain.json"));
  assert.deepEqual(first, second);
});

test("requested numeric page id selects only its own connection and fails closed on a mismatch", () => {
  const html = fixture("positive-plain.json");
  assert.equal(classifyMetaAdLibraryPayload(html, { requestedPageId: "391219454073578" }).outcome, "success");
  const mismatch = classifyMetaAdLibraryPayload(html, { requestedPageId: "999999999999999" });
  assert.equal(mismatch.outcome, "partial");
  assert.deepEqual(mismatch.adIds, []);
  assert.ok(mismatch.warnings.includes("requested_page_connection_not_found"));
});

const serverRenderedCards = (pageId = "144517189067076") => [
  '<noscript><meta http-equiv="refresh" content="0; URL=/ads/library/?active_status=all&amp;view_all_page_id=',
  pageId,
  '&amp;country=AU"></noscript>',
  '<a href="https://facebook.com/jenningshopkins"><span>Jennings Hopkins</span></a>',
  '<div><span>Active</span><a href="https://www.facebook.com/jenningshopkins/">Jennings Hopkins</a><span>Library ID: 2166639457618591</span><div style="white-space: pre-wrap;"><span>JUST LISTED | 35 Endicott Loop, Dunsborough</span></div></div>',
  '<div><span>Active</span><a href="https://www.facebook.com/jenningshopkins/">Jennings Hopkins</a><span>Library ID: 1875345986779754</span><div style="white-space: pre-wrap;"><span>JUST LISTED | 7 Norfolk Street, Dunsborough</span></div></div>',
  '<div><span>Active</span><a href="https://www.facebook.com/jenningshopkins/">Jennings Hopkins</a><span>Library ID: 1077701668041882</span><div style="white-space: pre-wrap;"><span>JUST LISTED | 21 North Street, Dunsborough</span></div></div>',
  '<div><span>Active</span><a href="https://www.facebook.com/jenningshopkins/">Jennings Hopkins</a><span>Library ID: 1097740416278829</span><div style="white-space: pre-wrap;"><span>JUST LISTED | 4 Quindalup Road, Quindalup</span></div></div>',
].join("");

test("server-rendered cards recover IDs as partial evidence with proven page context", () => {
  const result = classifyMetaAdLibraryPayload(serverRenderedCards(), { requestedPageId: "144517189067076" });
  assert.equal(result.outcome, "partial");
  assert.deepEqual(result.adIds, [
    "2166639457618591",
    "1875345986779754",
    "1077701668041882",
    "1097740416278829",
  ]);
  assert.equal(result.pageInfo.hasNextPage, null);
  assert.ok(result.warnings.includes("server_rendered_card_fallback"));
  assert.ok(result.warnings.includes("pagination_unproven"));
  assert.equal(result.ads[0].node.page_id, "144517189067076");
  assert.equal(result.ads[0].node.page_name, "Jennings Hopkins");
  assert.equal(result.ads[0].node.ad_active_status, "active");
  assert.match(result.ads[0].node.snapshot.body, /Dunsborough/u);
});

test("server-rendered fallback rejects a wrong requested page", () => {
  const result = classifyMetaAdLibraryPayload(serverRenderedCards("999999999999999"), { requestedPageId: "144517189067076" });
  assert.equal(result.outcome, "unparseable");
  assert.deepEqual(result.adIds, []);
});

test("server-rendered fallback rejects global or unscoped library IDs", () => {
  const result = classifyMetaAdLibraryPayload(serverRenderedCards().replace(/<noscript>[\s\S]*?<\/noscript>/u, ""), { requestedPageId: "144517189067076" });
  assert.equal(result.outcome, "unparseable");
  assert.deepEqual(result.adIds, []);
});

test("server-rendered fallback keeps challenge responses as failures", () => {
  const result = classifyMetaAdLibraryPayload("/__rd_verify_blocked " + serverRenderedCards(), { requestedPageId: "144517189067076" });
  assert.equal(result.outcome, "challenge");
  assert.deepEqual(result.adIds, []);
});

test("server-rendered fallback rejects ambiguous cards with multiple library IDs", () => {
  const html = serverRenderedCards().replace(
    /<div><span>Active<\/span><a href="https:\/\/www\.facebook\.com\/jenningshopkins\/">Jennings Hopkins<\/a><span>Library ID: 1875345986779754<\/span>[\s\S]*?<\/div><div><span>Active<\/span>/u,
    '<div><span>Active</span><a href="https://www.facebook.com/jenningshopkins/">Jennings Hopkins</a><span>Library ID: 1875345986779754</span><span>Library ID: 9999999999999999</span><div style="white-space: pre-wrap;"><span>Ambiguous</span></div></div><div><span>Active</span><a href="https://www.facebook.com/jenningshopkins/">Jennings Hopkins</a>',
  );
  const result = classifyMetaAdLibraryPayload(html, { requestedPageId: "144517189067076" });
  assert.equal(result.outcome, "partial");
  assert.deepEqual(result.adIds, [
    "2166639457618591",
    "1077701668041882",
    "1097740416278829",
  ]);
  assert.ok(result.warnings.includes("server_rendered_card_fallback"));
});

test("server-rendered fallback does not promote an inactive neighboring card", () => {
  const html = serverRenderedCards().replace(
    '<div><span>Active</span><a href="https://www.facebook.com/jenningshopkins/">Jennings Hopkins</a><span>Library ID: 1875345986779754</span>',
    '<div><span>Inactive</span><a href="https://www.facebook.com/jenningshopkins/">Jennings Hopkins</a><span>Library ID: 1875345986779754</span>',
  );
  const result = classifyMetaAdLibraryPayload(html, { requestedPageId: "144517189067076" });
  assert.equal(result.outcome, "partial");
  assert.deepEqual(result.adIds, [
    "1077701668041882",
    "1097740416278829",
  ]);
  assert.ok(!result.adIds.includes("1875345986779754"));
});
