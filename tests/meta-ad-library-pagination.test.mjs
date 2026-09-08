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
  operation = "AdLibrarySearch",
} = {}) {
  return {
    request: { pageId, after, activeStatus, country, operation },
    status,
    response: body,
  };
}
function capture(records, extra = {}) {
  return {
    body: html(),
    evaluate_results: [{ metaPaginationRecords: records }],
    ...extra,
  };
}

test("scenario recorder is bounded and has valid JS", () => {
  const scenario = buildMetaPaginationScenario();
  assert.equal(scenario.strict, true);
  assert.match(scenario.instructions[1].evaluate, /scrollHeight/);
  assert.match(scenario.instructions[1].evaluate, /scrollTop/);
  assert.match(scenario.instructions[1].evaluate, /window.scrollBy/);
  assert.match(scenario.instructions[1].evaluate, /maxIterations = 12/);
  assert.match(scenario.instructions[0].evaluate, /XMLHttpRequest/);
  assert.match(scenario.instructions[0].evaluate, /window\.fetch/);
  assert.match(scenario.instructions[3].evaluate, /metaPaginationRecords/);
  assert.doesNotThrow(() => new vm.Script(scenario.instructions[0].evaluate));
  assert.doesNotThrow(() => new vm.Script(scenario.instructions[1].evaluate));
  assert.doesNotThrow(() => new vm.Script(scenario.instructions[3].evaluate));
});

test("30 initial ads plus two ordered native pages produce complete coverage", () => {
  const firstIds = Array.from({ length: 30 }, (_, i) => `${PAGE}_${i + 1}`);
  const result = parseMetaPaginatedCapture(
    {
      body: html({ ids: firstIds, endCursor: CURSOR_1, count: 32 }),
      evaluate_results: [
        {
          metaPaginationRecords: [
            record({
              after: CURSOR_1,
              body: response({
                ids: [`${PAGE}_31`],
                hasNextPage: true,
                endCursor: CURSOR_2,
                count: 32,
              }),
            }),
            record({
              after: CURSOR_2,
              body: response({
                ids: [`${PAGE}_32`],
                hasNextPage: false,
                endCursor: CURSOR_2,
                count: 32,
              }),
            }),
          ],
        },
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
  test(`${name} retains initial evidence as partial`, () => {
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

test("recorder-shaped pageIDs and countries arrays are accepted only as singletons", () => {
  const next = record();
  next.request = {
    pageIDs: [PAGE],
    countries: ["AU"],
    activeStatus: "active",
    operation: "AdLibrarySearch",
    after: CURSOR_1,
  };
  const result = parseMetaPaginatedCapture(capture([next]), PAGE);
  assert.equal(result.outcome, "success");
  assert.equal(result.coverageComplete, true);

  const multiple = record();
  multiple.request = { ...next.request, pageIDs: [PAGE, "999999999999999"] };
  const rejected = parseMetaPaginatedCapture(capture([multiple]), PAGE);
  assert.equal(rejected.outcome, "partial");
  assert.ok(rejected.warnings.includes("pagination_page_mismatch"));
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
      body: html({ ids: [`${PAGE}_1`, `${PAGE}_2`], endCursor: CURSOR_1 }),
      evaluate_results: [
        {
          metaPaginationRecords: [
            record({
              body: response({
                ids: [`${PAGE}_2`, `${PAGE}_3`],
                hasNextPage: false,
                endCursor: CURSOR_2,
              }),
            }),
          ],
        },
      ],
    },
    PAGE,
  );
  assert.equal(result.outcome, "success");
  assert.deepEqual(result.adIds, [`${PAGE}_1`, `${PAGE}_2`, `${PAGE}_3`]);
});
test("missing terminal response and arbitrary xhr[] do not prove exhaustion", () => {
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
