import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  buildMetaPaginationScenario,
  parseMetaPaginatedCapture,
} from "../hermes/tools/research-runtime/bin/meta-ad-library-pagination.mjs";

const PAGE = "123456789012345";
const CURSOR_1 = "cursor-first";
const CURSOR_2 = "cursor-second";
function connection({ ids, hasNextPage, endCursor, count = ids.length }) {
  return {
    count,
    edges: ids.map((id) => ({ node: { ad_archive_id: id, page_id: PAGE } })),
    page_info: { has_next_page: hasNextPage, end_cursor: endCursor },
  };
}
function html({
  ids = ["123456789012345_1"],
  hasNextPage = true,
  endCursor = CURSOR_1,
  count = ids.length,
} = {}) {
  return JSON.stringify({
    data: {
      ad_library_main: {
        search_results_connection: connection({
          ids,
          hasNextPage,
          endCursor,
          count,
        }),
      },
      page: { id: PAGE, name: "Fixture Page" },
    },
  });
}
function response({
  ids,
  hasNextPage,
  endCursor,
  count = ids.length,
  final = true,
  errors,
} = {}) {
  const body = {
    data: {
      ad_library_main: {
        search_results_connection: connection({
          ids,
          hasNextPage,
          endCursor,
          count,
        }),
      },
    },
    extensions: { is_final: final },
  };
  if (errors) body.errors = errors;
  return body;
}
function record({
  after = CURSOR_1,
  pageId = PAGE,
  status = 200,
  body = response({
    ids: ["123456789012345_2"],
    hasNextPage: false,
    endCursor: CURSOR_2,
  }),
  activeStatus = "active",
  country = "AU",
  operation = "AdLibrarySearchPaginationQuery",
  variables,
  url = "https://www.facebook.com/api/graphql/",
} = {}) {
  const requestVariables = variables ?? {
    pageId,
    after,
    activeStatus,
    country,
    operationName: operation,
  };
  const postData = new URLSearchParams({
    variables: JSON.stringify(requestVariables),
    fb_api_req_friendly_name: operation,
  }).toString();
  return {
    url,
    method: "POST",
    status_code: status,
    post_data: postData,
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}
function capture(xhr, extra = {}) {
  return { body: html(), xhr, ...extra };
}
function shellCapture(xhr = []) {
  return { body: "<html><body>Meta shell</body></html>", xhr };
}
function rootResponse({
  ids = [PAGE + "_1"],
  hasNextPage = true,
  endCursor = CURSOR_1,
  count = ids.length,
  errors,
} = {}) {
  return (
    JSON.stringify(
      response({
        ids,
        hasNextPage,
        endCursor,
        count,
        final: false,
        errors,
      }),
    ) +
    "\n" +
    JSON.stringify({ extensions: { is_final: true } })
  );
}
function rootRecord({
  pageId = PAGE,
  country = "AU",
  activeStatus = "active",
  status = 200,
  body,
  variables,
} = {}) {
  return record({
    status,
    operation: "AdLibraryFoundationRootQuery",
    variables: variables ?? {
      viewAllPageID: pageId,
      pageIDs: [],
      activeStatus,
      countries: [country],
    },
    body:
      body ??
      rootResponse({
        ids: [PAGE + "_1"],
        hasNextPage: true,
        endCursor: CURSOR_1,
      }),
  });
}

test("scenario uses bounded synchronous scrolling without fragile interception", () => {
  const scenario = buildMetaPaginationScenario();
  assert.equal(scenario.strict, true);
  const scrolls = scenario.instructions.filter(
    (instruction) =>
      typeof instruction.evaluate === "string" &&
      instruction.evaluate.includes("scrollHeight"),
  );
  assert.equal(scrolls.length, 16);
  const waits = scenario.instructions
    .filter((instruction) => Number.isFinite(instruction.wait))
    .map((instruction) => instruction.wait);
  assert.deepEqual(waits, [...Array(16).fill(1500), 3000]);
  assert.equal(16 * 1500 + 3000 + 5000, 32000);
  assert.ok(16 * 1500 + 3000 + 5000 < 40000);
  assert.match(scrolls[0].evaluate, /scrollTop/);
  assert.match(scrolls[0].evaluate, /window\.scrollTo/);
  assert.doesNotMatch(scrolls[0].evaluate, /Promise|async/);
  assert.doesNotMatch(
    JSON.stringify(scenario),
    /XMLHttpRequest|window\.fetch|metaPaginationRecords/,
  );
  for (const instruction of scenario.instructions)
    if (instruction.evaluate)
      assert.doesNotThrow(() => new vm.Script(instruction.evaluate));
});

test("invalid timing options fall back to the coherent bounded defaults", () => {
  const scenario = buildMetaPaginationScenario({
    maxScrolls: 0,
    delayMs: Number.NaN,
    settleMs: -1,
  });
  const waits = scenario.instructions
    .filter((instruction) => Number.isFinite(instruction.wait))
    .map((instruction) => instruction.wait);
  assert.deepEqual(waits, [...Array(16).fill(1500), 3000]);
  assert.equal(
    scenario.instructions.filter((instruction) => instruction.evaluate).length,
    16,
  );
});

test("native RootQuery recovers a shell capture then closes its cursor chain", () => {
  const rootIds = Array.from(
    { length: 30 },
    (_, index) => PAGE + "_" + (index + 1),
  );
  const result = parseMetaPaginatedCapture(
    shellCapture([
      rootRecord({
        body: rootResponse({
          ids: rootIds,
          hasNextPage: true,
          endCursor: CURSOR_1,
          count: 32,
        }),
      }),
      record({
        after: CURSOR_1,
        body: response({
          ids: [PAGE + "_31", PAGE + "_32"],
          hasNextPage: false,
          endCursor: "",
          count: 32,
        }),
      }),
    ]),
    PAGE,
  );
  assert.equal(result.outcome, "success");
  assert.equal(result.coverageComplete, true);
  assert.equal(result.paginationExhausted, true);
  assert.equal(result.paginationRecords, 1);
  assert.equal(result.connectionCount, 32);
  assert.equal(result.adIds.length, 32);
});

test("native RootQuery proves a strict zero only with final zero-count evidence", () => {
  const result = parseMetaPaginatedCapture(
    shellCapture([
      rootRecord({
        body: rootResponse({
          ids: [],
          hasNextPage: false,
          endCursor: "",
          count: 0,
        }),
      }),
    ]),
    PAGE,
  );
  assert.equal(result.outcome, "confirmed_absence");
  assert.equal(result.coverageComplete, true);
  assert.equal(result.paginationExhausted, true);
  assert.deepEqual(result.adIds, []);
  assert.equal(result.captureStrategy, "initial_page");
});

test("failed native RootQuery recovery preserves an unparseable shell outcome", () => {
  const zeroWithoutEdges = JSON.stringify({
    data: {
      ad_library_main: {
        search_results_connection: {
          count: 0,
          page_info: { has_next_page: false, end_cursor: "" },
        },
      },
    },
    extensions: { is_final: true },
  });
  for (const [root, warning] of [
    [
      rootRecord({ pageId: "999999999999999" }),
      "native_initial_request_mismatch",
    ],
    [rootRecord({ country: "NZ" }), "native_initial_request_mismatch"],
    [rootRecord({ status: 403 }), "native_initial_http_failure"],
    [
      rootRecord({
        variables: {
          viewAllPageID: PAGE,
          pageIDs: [],
          pageId: "999999999999999",
          activeStatus: "active",
          countries: ["AU"],
        },
      }),
      "native_initial_request_mismatch",
    ],
    [rootRecord({ body: zeroWithoutEdges }), "native_initial_edges_unproven"],
    [
      rootRecord({
        body: rootResponse({
          ids: [],
          hasNextPage: false,
          endCursor: "",
          count: 0.5,
        }),
      }),
      "native_initial_page_info_unproven",
    ],
    [
      rootRecord({
        body: rootResponse({
          ids: [PAGE + "_1"],
          hasNextPage: true,
          endCursor: CURSOR_1,
          errors: [{ message: "fixture" }],
        }),
      }),
      "native_initial_response_errors",
    ],
    [
      rootRecord({ body: { truncated: true } }),
      "response_truncated_or_malformed",
    ],
  ]) {
    const result = parseMetaPaginatedCapture(shellCapture([root]), PAGE);
    assert.equal(result.outcome, "unparseable");
    assert.equal(result.coverageComplete, false);
    assert.equal(result.paginationExhausted, false);
    assert.deepEqual(result.adIds, []);
    assert.ok(result.warnings.includes(warning));
  }
  const missing = parseMetaPaginatedCapture(shellCapture(), PAGE);
  assert.equal(missing.outcome, "unparseable");
  assert.ok(missing.warnings.includes("native_initial_missing"));
});

test("30 initial ads plus two ordered native pages produce complete coverage", () => {
  const firstIds = Array.from({ length: 30 }, (_, i) => PAGE + "_" + (i + 1));
  const result = parseMetaPaginatedCapture(
    {
      body: html({ ids: firstIds, endCursor: CURSOR_1, count: 32 }),
      xhr: [
        record({
          after: CURSOR_1,
          body: response({
            ids: [PAGE + "_31"],
            hasNextPage: true,
            endCursor: CURSOR_2,
            count: 32,
          }),
        }),
        record({
          after: CURSOR_2,
          body: response({
            ids: [PAGE + "_32"],
            hasNextPage: false,
            endCursor: CURSOR_2,
            count: 32,
          }),
        }),
      ],
    },
    PAGE,
  );
  assert.equal(result.outcome, "success");
  assert.equal(result.coverageComplete, true);
  assert.equal(result.paginationExhausted, true);
  assert.equal(result.paginationRecords, 2);
  assert.equal(result.adIds.length, 32);
  assert.equal(result.pageInfo.hasNextPage, false);
});

for (const [name, make] of [
  ["wrong page", () => record({ pageId: "999999999999999" })],
  ["cursor gap", () => record({ after: "not-the-prior-cursor" })],
  ["403", () => record({ status: 403 })],
  ["challenge", () => record({ body: "<div>checkpoint challenge</div>" })],
  ["truncated stream", () => record({ body: { truncated: true } })],
]) {
  test(name + " retains initial evidence as partial", () => {
    const result = parseMetaPaginatedCapture(capture([make()]), PAGE);
    assert.equal(result.outcome, "partial");
    assert.equal(result.coverageComplete, false);
    assert.equal(result.paginationExhausted, false);
    assert.equal(result.adIds.length, 1);
  });
}

test("failed JS scenario retains initial evidence as partial", () => {
  const result = parseMetaPaginatedCapture(
    capture([], {
      js_scenario_report: {
        task_executed: 2,
        task_failure: 1,
        task_success: 1,
      },
    }),
    PAGE,
  );
  assert.equal(result.outcome, "partial");
  assert.ok(result.warnings.includes("js_scenario_failed"));
  assert.equal(result.adIds.length, 1);
  assert.equal(result.captureStrategy, "native_cursor");
});
test("strict zero baseline remains confirmed absence and complete", () => {
  const body = JSON.stringify({
    data: {
      ad_library_main: {
        search_results_connection: connection({
          ids: [],
          hasNextPage: false,
          endCursor: "",
          count: 0,
        }),
      },
      page: { id: PAGE, name: "Fixture Page" },
    },
  });
  const result = parseMetaPaginatedCapture({ body }, PAGE);
  assert.equal(result.outcome, "confirmed_absence");
  assert.deepEqual(result.adIds, []);
  assert.deepEqual(result.pageInfo, { hasNextPage: false, endCursor: "" });
  assert.equal(result.coverageComplete, true);
  assert.equal(result.paginationRecords, 0);
});
test("initial challenge outcome remains visible and never completes", () => {
  const result = parseMetaPaginatedCapture(
    { body: "/__rd_verify_blocked" },
    PAGE,
  );
  assert.equal(result.outcome, "challenge");
  assert.equal(result.coverageComplete, false);
  assert.equal(result.paginationExhausted, false);
});

test("native XHR accepts only the exact HTTPS Facebook GraphQL endpoint", () => {
  for (const url of [
    "http://www.facebook.com/api/graphql/",
    "https://www.facebook.com:444/api/graphql/",
    "https://user@www.facebook.com/api/graphql/",
    "https://www.facebook.com/api/graphql/extra",
    "https://not-facebook.example/api/graphql/",
  ]) {
    const result = parseMetaPaginatedCapture(capture([record({ url })]), PAGE);
    assert.equal(result.outcome, "partial");
    assert.ok(result.warnings.includes("pagination_records_missing"));
  }
});

test("pagination request filters are required and must match requested filters", () => {
  for (const bad of [
    record({ activeStatus: null }),
    record({ activeStatus: "inactive" }),
    record({ country: "NZ" }),
  ]) {
    const result = parseMetaPaginatedCapture(capture([bad]), PAGE);
    assert.equal(result.outcome, "partial");
    assert.ok(result.warnings.includes("pagination_request_filters_mismatch"));
    assert.equal(result.coverageComplete, false);
  }
  const result = parseMetaPaginatedCapture(
    capture([record({ activeStatus: "all", country: "NZ" })]),
    PAGE,
    { activeStatus: "all", country: "NZ" },
  );
  assert.equal(result.outcome, "success");
  assert.equal(result.coverageComplete, true);
});

test("provider variables accept singleton pageIDs and countries, but reject ambiguity", () => {
  const result = parseMetaPaginatedCapture(
    capture([
      record({
        variables: {
          pageIDs: [PAGE],
          countries: ["AU"],
          activeStatus: "active",
          cursor: CURSOR_1,
        },
      }),
    ]),
    PAGE,
  );
  assert.equal(result.outcome, "success");
  assert.equal(result.coverageComplete, true);

  const rejected = parseMetaPaginatedCapture(
    capture([
      record({
        variables: {
          pageIDs: [PAGE, "999999999999999"],
          countries: ["AU"],
          activeStatus: "active",
          cursor: CURSOR_1,
        },
      }),
    ]),
    PAGE,
  );
  assert.equal(rejected.outcome, "partial");
  assert.ok(rejected.warnings.includes("pagination_records_missing"));
});

test("conflicting or nonempty multi-value identity and filter fields are rejected", () => {
  for (const variables of [
    {
      pageIDs: [PAGE, "999999999999999"],
      viewAllPageID: PAGE,
      countries: ["AU"],
      activeStatus: "active",
      cursor: CURSOR_1,
    },
    {
      pageId: PAGE,
      countries: ["AU", "NZ"],
      country: "AU",
      activeStatus: "active",
      cursor: CURSOR_1,
    },
    {
      pageId: PAGE,
      country: "AU",
      activeStatus: ["active", "inactive"],
      cursor: CURSOR_1,
    },
  ]) {
    const result = parseMetaPaginatedCapture(
      capture([record({ variables })]),
      PAGE,
    );
    assert.equal(result.outcome, "partial");
    assert.ok(result.warnings.includes("pagination_records_missing"));
  }
});

test("a nonterminal response must advance its cursor", () => {
  const result = parseMetaPaginatedCapture(
    capture([
      record({
        body: response({
          ids: [PAGE + "_2"],
          hasNextPage: true,
          endCursor: CURSOR_1,
        }),
      }),
    ]),
    PAGE,
  );
  assert.equal(result.outcome, "partial");
  assert.ok(result.warnings.includes("pagination_cursor_not_progressing"));
  assert.equal(result.coverageComplete, false);
});

test("newline-delimited complete GraphQL responses can form a chain", () => {
  const first = response({
    ids: [PAGE + "_2"],
    hasNextPage: false,
    endCursor: CURSOR_2,
  });
  const result = parseMetaPaginatedCapture(
    capture([
      record({
        body:
          JSON.stringify(first) +
          "\n" +
          JSON.stringify({ extensions: { is_final: true } }),
      }),
    ]),
    PAGE,
  );
  assert.equal(result.outcome, "success");
  assert.equal(result.coverageComplete, true);
});

test("duplicate archive IDs are deduped across initial and native pages", () => {
  const result = parseMetaPaginatedCapture(
    {
      body: html({ ids: [PAGE + "_1", PAGE + "_2"], endCursor: CURSOR_1 }),
      xhr: [
        record({
          body: response({
            ids: [PAGE + "_2", PAGE + "_3"],
            hasNextPage: false,
            endCursor: CURSOR_2,
          }),
        }),
      ],
    },
    PAGE,
  );
  assert.equal(result.outcome, "success");
  assert.deepEqual(result.adIds, [PAGE + "_1", PAGE + "_2", PAGE + "_3"]);
});

test("sanitized saved-provider xhr shape recovers its complete native cursor chain", () => {
  const initialIds = Array.from(
    { length: 10 },
    (_, index) => PAGE + "_" + (index + 1),
  );
  const pageTwoIds = Array.from(
    { length: 10 },
    (_, index) => PAGE + "_" + (index + 11),
  );
  const pageThreeIds = Array.from(
    { length: 6 },
    (_, index) => PAGE + "_" + (index + 21),
  );
  const result = parseMetaPaginatedCapture(
    {
      body: html({
        ids: initialIds,
        hasNextPage: true,
        endCursor: CURSOR_1,
        count: 26,
      }),
      xhr: [
        {
          url: "https://www.facebook.com/api/graphql/",
          method: "POST",
          status_code: 200,
          post_data: new URLSearchParams({
            variables: JSON.stringify({ country: "AU" }),
            fb_api_req_friendly_name: "AdLibraryFilterContextProviderQuery",
          }).toString(),
          body: JSON.stringify({ data: {}, extensions: { is_final: true } }),
        },
        record({
          variables: {
            activeStatus: "active",
            countries: ["AU"],
            cursor: CURSOR_1,
            pageIDs: [],
            viewAllPageID: PAGE,
          },
          body: response({
            ids: pageTwoIds,
            hasNextPage: true,
            endCursor: CURSOR_2,
            count: 26,
          }),
        }),
        record({
          variables: {
            activeStatus: "active",
            countries: ["AU"],
            cursor: CURSOR_2,
            pageIDs: [],
            viewAllPageID: PAGE,
          },
          body: response({
            ids: pageThreeIds,
            hasNextPage: false,
            endCursor: "",
            count: 26,
          }),
        }),
      ],
    },
    PAGE,
  );
  assert.equal(result.outcome, "success");
  assert.equal(result.paginationRecords, 2);
  assert.equal(result.paginationExhausted, true);
  assert.equal(result.connectionCount, 26);
  assert.equal(result.adIds.length, 26);
});

test("arbitrary non-GraphQL xhr entries do not prove exhaustion", () => {
  const result = parseMetaPaginatedCapture(
    {
      body: html({ ids: [`${PAGE}_1`, `${PAGE}_2`] }),
      xhr: [
        {
          status_code: 200,
          body: JSON.stringify(
            response({ ids: [`${PAGE}_3`], hasNextPage: false, endCursor: "" }),
          ),
        },
      ],
    },
    PAGE,
  );
  assert.equal(result.outcome, "partial");
  assert.equal(result.coverageComplete, false);
  assert.ok(result.warnings.includes("pagination_records_missing"));
});
test("capped scroll with valid nonterminal page stays partial", () => {
  const result = parseMetaPaginatedCapture(
    capture([
      record({
        body: response({
          ids: [`${PAGE}_2`],
          hasNextPage: true,
          endCursor: CURSOR_2,
        }),
      }),
    ]),
    PAGE,
  );
  assert.equal(result.outcome, "partial");
  assert.equal(result.paginationRecords, 1);
  assert.equal(result.pageInfo.hasNextPage, true);
});

test("encoded provider request line fits the upstream limit with header authentication", () => {
  const query = new URLSearchParams({
    url: "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=AU&view_all_page_id=107512001410098&media_type=all",
    mode: "auto",
    max_cost: "25",
    wait: "5000",
    json_response: "true",
    js_scenario: JSON.stringify(buildMetaPaginationScenario()),
  });
  assert.ok(
    Buffer.byteLength("GET /api/v1/?" + query.toString() + " HTTP/1.1") < 8190,
  );
});

test("every evaluator compiles and synchronous scroll reaches the real container bottom", () => {
  const scenario = buildMetaPaginationScenario();
  const elements = [
    { scrollTop: 0, scrollHeight: 24000 },
    { scrollTop: 0, scrollHeight: 8000 },
  ];
  const calls = [];
  const context = {
    document: { querySelectorAll: () => elements },
    window: { scrollTo: (...args) => calls.push(args) },
  };
  for (const instruction of scenario.instructions) {
    if (!instruction.evaluate) continue;
    assert.doesNotThrow(() => new vm.Script(instruction.evaluate));
    if (instruction.evaluate.includes("scrollTop")) {
      const result = vm.runInNewContext(instruction.evaluate, context);
      assert.equal(result?.then, undefined);
    }
  }
  assert.equal(calls.length, 16);
  assert.equal(elements[0].scrollTop, 24000);
  assert.equal(elements[1].scrollTop, 8000);
  assert.ok(calls.every(([x, y]) => x === 0 && y >= 24000));
});
