/**
 * Bounded native pagination helper for ScrapingBee Meta captures.
 */
import { classifyMetaAdLibraryPayload } from "./meta-ad-library-parser.mjs";

const DEFAULT_SCROLLS = 8,
  MAX_SCROLLS = 16,
  BUDGET = 40000;
const NATIVE_SCROLL_TO_BOTTOM = String.raw`(()=>{for(const e of document.querySelectorAll("main,div"))e.scrollTop=e.scrollHeight;window.scrollTo(0,1e9)})()`;

// Provider GET request lines are limited to 8190 bytes. Remove indentation
// from our own scripts without changing tokens, quoted strings or regexes.
function compactScript(script) {
  return script
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .join(" ");
}

function positive(value, fallback, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : fallback;
}

export function buildMetaPaginationScenario({
  maxScrolls = DEFAULT_SCROLLS,
  delayMs = 1000,
  settleMs = 1500,
} = {}) {
  const scrolls = positive(maxScrolls, DEFAULT_SCROLLS, MAX_SCROLLS),
    delay = positive(delayMs, 1000, 4000),
    settle = positive(settleMs, 1500, 4000);
  if (scrolls * delay + settle + 5000 >= BUDGET)
    throw new Error("Meta pagination scenario exceeds 40 second budget");
  const instructions = [];
  for (let index = 0; index < scrolls; index += 1) {
    instructions.push(
      { evaluate: compactScript(NATIVE_SCROLL_TO_BOTTOM) },
      { wait: delay },
    );
  }
  instructions.push({ wait: settle });
  return { strict: true, instructions };
}
function unwrap(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  const s = String(raw || "");
  try {
    const x = JSON.parse(s);
    if (x && typeof x === "object" && !Array.isArray(x)) return x;
  } catch {}
  return { body: s };
}
function failed(c) {
  const r = c.js_scenario_report;
  if (!r || typeof r !== "object") return false;
  if (
    Number(r.task_failure) > 0 ||
    (r.task_success === 0 && Number(r.task_executed) > 0)
  )
    return true;
  return (
    Array.isArray(r.tasks) && r.tasks.some((x) => x && x.success === false)
  );
}
const MAX_NATIVE_XHR = 64;
const MAX_NATIVE_POST_DATA = 200000;
const PAGE_KEYS = [
  "pageId",
  "pageID",
  "page_id",
  "viewAllPageID",
  "view_all_page_id",
  "pageIDs",
  "pagesID",
];
const CURSOR_KEYS = ["after", "cursor", "endCursor", "end_cursor"];
const ACTIVE_KEYS = ["activeStatus", "active_status", "ad_active_status"];
const COUNTRY_KEYS = ["country", "country_code", "countryCode", "countries"];
const OPERATION_KEYS = [
  "operation",
  "operationName",
  "operation_name",
  "friendlyName",
  "friendly_name",
];
const AMBIGUOUS_NATIVE_FIELD = Symbol("ambiguous_native_field");

function nativeScalar(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return { value: null, ambiguous: false };
    if (value.length !== 1) return { value: null, ambiguous: true };
    return nativeScalar(value[0]);
  }
  return {
    value: ["string", "number", "boolean"].includes(typeof value)
      ? String(value)
      : null,
    ambiguous: false,
  };
}
function nativeField(value, keys) {
  const values = new Set();
  let visited = 0,
    ambiguous = false;
  const walk = (current, depth = 0) => {
    if (
      depth > 12 ||
      visited++ > 2000 ||
      current == null ||
      typeof current !== "object"
    )
      return;
    if (Array.isArray(current)) {
      for (const item of current) walk(item, depth + 1);
      return;
    }
    for (const key of keys) {
      const scalar = nativeScalar(current[key]);
      if (scalar.ambiguous) ambiguous = true;
      else if (scalar.value != null && scalar.value !== "")
        values.add(scalar.value);
    }
    for (const child of Object.values(current)) walk(child, depth + 1);
  };
  walk(value);
  if (ambiguous || values.size > 1) return AMBIGUOUS_NATIVE_FIELD;
  return values.size === 1 ? [...values][0] : null;
}
function isNativeGraphqlUrl(value) {
  try {
    const url = new URL(String(value));
    return (
      url.protocol === "https:" &&
      (url.hostname === "facebook.com" ||
        url.hostname === "www.facebook.com") &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.pathname === "/api/graphql" || url.pathname === "/api/graphql/")
    );
  } catch {
    return false;
  }
}
function nativeVariables(postData) {
  if (typeof postData !== "string" || postData.length > MAX_NATIVE_POST_DATA)
    return null;
  try {
    const form = new URLSearchParams(postData);
    const encoded = ["variables", "data", "payload"]
      .map((key) => form.get(key))
      .find(Boolean);
    if (!encoded) return null;
    const variables = JSON.parse(encoded);
    if (!variables || typeof variables !== "object") return null;
    const operation =
      form.get("fb_api_req_friendly_name") ||
      form.get("operationName") ||
      form.get("operation_name") ||
      null;
    return { variables, operation };
  } catch {
    return null;
  }
}
function nativeRecords(c) {
  if (!Array.isArray(c.xhr)) return [];
  const out = [];
  for (const entry of c.xhr.slice(0, MAX_NATIVE_XHR)) {
    if (!entry || typeof entry !== "object") continue;
    if (String(entry.method || "").toUpperCase() !== "POST") continue;
    if (!isNativeGraphqlUrl(entry.url)) continue;
    const parsed = nativeVariables(entry.post_data);
    if (!parsed) continue;
    const request = {
      pageId: nativeField(parsed.variables, PAGE_KEYS),
      after: nativeField(parsed.variables, CURSOR_KEYS),
      activeStatus: nativeField(parsed.variables, ACTIVE_KEYS),
      country: nativeField(parsed.variables, COUNTRY_KEYS),
      operation:
        parsed.operation || nativeField(parsed.variables, OPERATION_KEYS),
    };
    // A provider capture includes other GraphQL calls. Keep only requests with
    // enough identity and cursor data to enter the strict filter checks below.
    if (
      Object.values(request).includes(AMBIGUOUS_NATIVE_FIELD) ||
      typeof request.pageId !== "string" ||
      !request.pageId ||
      typeof request.after !== "string" ||
      !request.after ||
      typeof request.operation !== "string" ||
      !request.operation
    )
      continue;
    out.push({
      request,
      status: entry.status_code,
      body: entry.body,
    });
  }
  return out;
}
function responseBody(r) {
  for (const x of [r.response, r.responseBody, r.body]) {
    if (x && typeof x === "object") {
      if (x.truncated || x.malformed || x.unreadable)
        return { invalid: true, reason: "response_truncated_or_malformed" };
      return { value: x };
    }
    if (typeof x === "string") {
      if (x.length > 4000000)
        return { invalid: true, reason: "response_truncated_or_malformed" };
      try {
        return { value: JSON.parse(x) };
      } catch {
        try {
          const lines = x
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
          if (lines.length > 1)
            return { value: lines.map((line) => JSON.parse(line)) };
        } catch {
          // A malformed final line means the stream is incomplete.
        }
        return { invalid: true, reason: "response_truncated_or_malformed" };
      }
    }
  }
  return { invalid: true, reason: "response_body_missing" };
}
function connection(v, d = 0) {
  if (d > 12 || v == null || typeof v !== "object") return null;
  if (
    !Array.isArray(v) &&
    v.search_results_connection &&
    typeof v.search_results_connection === "object"
  )
    return { value: v.search_results_connection };
  if (Array.isArray(v)) {
    for (const x of v) {
      const y = connection(x, d + 1);
      if (y) return y;
    }
    return null;
  }
  for (const x of Object.values(v)) {
    const y = connection(x, d + 1);
    if (y) return y;
  }
  return null;
}
function finalStream(v, d = 0) {
  if (d > 12 || v == null || typeof v !== "object") return false;
  if (v.extensions && v.extensions.is_final === true) return true;
  if (Array.isArray(v)) return v.some((x) => finalStream(x, d + 1));
  return Object.values(v).some((x) => finalStream(x, d + 1));
}
function hasErrors(v, d = 0) {
  if (d > 12 || v == null || typeof v !== "object") return false;
  if (!Array.isArray(v) && Array.isArray(v.errors) && v.errors.length)
    return true;
  if (Array.isArray(v)) return v.some((x) => hasErrors(x, d + 1));
  return Object.values(v).some((x) => hasErrors(x, d + 1));
}
function adRecords(c) {
  const out = [],
    seen = new Set();
  if (!Array.isArray(c.edges)) return out;
  const walk = (v) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const id = v.ad_archive_id ?? v.adArchiveID;
    if (typeof id === "string" && /^\d[\d_]{5,}$/.test(id) && !seen.has(id)) {
      seen.add(id);
      out.push({ id, node: v });
    }
    for (const x of Object.values(v)) walk(x);
  };
  for (const e of c.edges)
    walk(e && typeof e === "object" ? (e.node ?? e) : null);
  return out;
}
function info(c) {
  const p = c && c.page_info;
  if (!p || typeof p !== "object" || typeof p.has_next_page !== "boolean")
    return null;
  return {
    hasNextPage: p.has_next_page,
    endCursor: typeof p.end_cursor === "string" ? p.end_cursor : null,
  };
}
function oneRequestValue(value) {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
  return value;
}
function reqPage(r) {
  const x = r.request || r.variables || r;
  const v = oneRequestValue(
    x.pageId ??
      x.page_id ??
      x.viewAllPageID ??
      x.view_all_page_id ??
      x.pageIDs ??
      x.pagesID,
  );
  return v == null ? null : String(v);
}
function reqAfter(r) {
  const x = r.request || r.variables || r;
  const v = x.after ?? x.cursor ?? x.endCursor ?? x.end_cursor;
  return v == null ? null : String(v);
}
function reqFilters(r, expectedCountry, expectedActiveStatus) {
  const x = r.request || r.variables || r;
  const operation = x.operation ?? x.operationName ?? x.friendlyOperation;
  const active = oneRequestValue(x.activeStatus ?? x.active_status);
  const country = oneRequestValue(x.country ?? x.country_code ?? x.countries);
  return (
    typeof operation === "string" &&
    operation.length > 0 &&
    typeof active === "string" &&
    active.toLowerCase() === expectedActiveStatus.toLowerCase() &&
    typeof country === "string" &&
    country.toUpperCase() === expectedCountry.toUpperCase()
  );
}
function pageHtml(c) {
  if (typeof c.body === "string") return c.body;
  if (c.body && typeof c.body === "object") return JSON.stringify(c.body);
  if (typeof c.html === "string") return c.html;
  return "";
}
function partial(base, warns, count = 0) {
  return {
    outcome: "partial",
    ads: base.ads || [],
    adIds: base.adIds || [],
    connectionCount: base.connectionCount ?? null,
    pageInfo: base.pageInfo || { hasNextPage: null, endCursor: null },
    warnings: [...new Set([...(base.warnings || []), ...warns])],
    coverageComplete: false,
    paginationExhausted: false,
    paginationRecords: count,
  };
}

/**
 * Parse final HTML and provider-native GraphQL XHR responses.
 * Only strict, observed pagination requests participate in the cursor chain.
 */
export function parseMetaPaginatedCapture(
  raw,
  expectedPageId,
  { country = "AU", activeStatus = "active" } = {},
) {
  const c = unwrap(raw),
    expected = String(expectedPageId ?? "").trim();
  const initial = classifyMetaAdLibraryPayload(pageHtml(c), {
    requestedPageId: expected || null,
  });
  const base = {
    outcome: initial.outcome,
    ads: initial.ads,
    adIds: initial.adIds,
    connectionCount: initial.connectionCount,
    pageInfo: initial.pageInfo,
    warnings: initial.warnings,
  };
  if (!expected || !/^\d{5,}$/.test(expected))
    return partial(base, ["requested_page_id_invalid"]);
  if (["challenge", "login_wall", "unparseable"].includes(initial.outcome))
    return {
      ...base,
      warnings: [...initial.warnings, "initial_capture_" + initial.outcome],
      coverageComplete: false,
      paginationExhausted: false,
      paginationRecords: 0,
    };
  if (initial.pageInfo.hasNextPage === false)
    return {
      ...base,
      warnings: [...initial.warnings],
      coverageComplete:
        initial.outcome === "success" ||
        initial.outcome === "confirmed_absence",
      paginationExhausted:
        initial.outcome === "success" ||
        initial.outcome === "confirmed_absence",
      paginationRecords: 0,
    };
  if (
    initial.outcome !== "success" ||
    initial.pageInfo.hasNextPage !== true ||
    typeof initial.pageInfo.endCursor !== "string" ||
    !initial.pageInfo.endCursor
  )
    return partial(base, ["initial_page_pagination_unproven"]);
  if (failed(c)) return partial(base, ["js_scenario_failed"]);
  const rs = nativeRecords(c);
  let cursor = initial.pageInfo.endCursor,
    last = null,
    ads = [...initial.ads];
  const ids = new Set(initial.adIds),
    warn = [...initial.warnings];
  let valid = 0,
    done = false,
    why = null;
  for (const r of rs) {
    const status = Number(r.status ?? r.httpStatus ?? 0);
    if (status < 200 || status >= 300) {
      why = "pagination_http_failure";
      break;
    }
    if (reqPage(r) !== expected) {
      why = "pagination_page_mismatch";
      break;
    }
    if (reqAfter(r) !== cursor) {
      why = "pagination_cursor_gap";
      break;
    }
    if (!reqFilters(r, String(country), String(activeStatus))) {
      why = "pagination_request_filters_mismatch";
      break;
    }
    const body = responseBody(r);
    if (body.invalid) {
      why = body.reason;
      break;
    }
    if (hasErrors(body.value)) {
      why = "pagination_response_errors";
      break;
    }
    const found = connection(body.value);
    if (!found || !finalStream(body.value)) {
      why = "pagination_response_not_final";
      break;
    }
    const pi = info(found.value);
    if (!pi) {
      why = "pagination_page_info_missing";
      break;
    }
    for (const a of adRecords(found.value))
      if (!ids.has(a.id)) {
        ids.add(a.id);
        ads.push(a);
      }
    valid++;
    last = found.value;
    if (pi.hasNextPage === true && pi.endCursor === cursor) {
      why = "pagination_cursor_not_progressing";
      break;
    }
    cursor = pi.endCursor;
    if (pi.hasNextPage === false) {
      done = true;
      break;
    }
    if (!cursor) {
      why = "pagination_cursor_missing";
      break;
    }
  }
  if (done)
    return {
      outcome: "success",
      ads,
      adIds: [...ids],
      connectionCount:
        typeof last.count === "number" ? last.count : initial.connectionCount,
      pageInfo: { hasNextPage: false, endCursor: cursor },
      warnings: [...new Set(warn)],
      coverageComplete: true,
      paginationExhausted: true,
      paginationRecords: valid,
    };
  if (why) warn.push(why);
  else
    warn.push(
      rs.length ? "pagination_chain_incomplete" : "pagination_records_missing",
    );
  const pbase = {
    ...base,
    ads,
    adIds: [...ids],
    connectionCount:
      last && typeof last.count === "number"
        ? last.count
        : base.connectionCount,
    pageInfo: (last && info(last)) || base.pageInfo,
  };
  return partial(pbase, warn, valid);
}
