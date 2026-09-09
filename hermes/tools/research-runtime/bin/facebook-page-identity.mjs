import { createHash } from "node:crypto";
import {
  ensureFetchRun,
  loadCaptureJournal,
  reconcileSavedCaptureSettlement,
  saveCaptureJournal,
} from "./ad-radar-capture-journal.mjs";
import { executeScrapingBeePaidAttempt } from "./scrapingbee-paid-attempt.mjs";
const PROVIDER = "scrapingbee_facebook_page_identity",
  MAX = 2000000;
const AUTO_CAPS = new Set([1, 5, 10, 25]);
const clean = (v) => String(v ?? "").trim(),
  hasPort = (v) => /^https:\/\/[^\/]+:\d+(?:\/|$)/iu.test(clean(v)),
  hash = (v) => createHash("sha256").update(String(v)).digest("hex");
const ID = /^\d{5,}$/u,
  UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const RESERVED = new Set([
  "ads",
  "groups",
  "photos",
  "posts",
  "share",
  "sharer",
  "profile.php",
  "people",
  "pages",
  "watch",
  "marketplace",
  "events",
  "gaming",
  "login",
  "help",
]);
export function exactFacebookUrl(value) {
  let u;
  try {
    u = new URL(clean(value));
  } catch {
    return null;
  }
  if (
    u.protocol !== "https:" ||
    !["facebook.com", "www.facebook.com"].includes(u.hostname.toLowerCase()) ||
    u.port ||
    hasPort(value) ||
    u.username ||
    u.password ||
    u.hash ||
    u.search
  )
    return null;
  let p;
  try {
    p = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (p.length !== 1 || RESERVED.has(p[0].toLowerCase())) return null;
  if (ID.test(p[0]))
    return {
      url: "https://www.facebook.com/" + p[0],
      pageId: p[0],
      vanity: null,
    };
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(p[0])) return null;
  return {
    url: "https://www.facebook.com/" + p[0].toLowerCase(),
    pageId: null,
    vanity: p[0].toLowerCase(),
  };
}
function canonical(v, e) {
  const x = exactFacebookUrl(v);
  return Boolean(x && x.url.toLowerCase() === e.url.toLowerCase());
}
function pageId(row, expected) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const isPage = clean(row.__typename).toLowerCase() === "page";
  const explicit = [row.page_id, row.pageID].map(clean).find((x) => ID.test(x));
  const typedId = isPage && ID.test(clean(row.id)) ? clean(row.id) : "";
  const id =
    explicit ||
    typedId ||
    (isPage && ID.test(clean(row.userID)) ? clean(row.userID) : "");
  if (!id) return null;
  const vanity = clean(
    row.userVanity || row.username || row.vanity,
  ).toLowerCase();
  const exact = canonical(
    clean(
      row.permalink_url ||
        row.permalinkUrl ||
        row.page_url ||
        row.pageUrl ||
        row.url,
    ),
    expected,
  );
  if (!isPage && !(explicit && exact)) return null;
  if (isPage && vanity !== expected.vanity && !exact) return null;
  return id;
}
function attributes(tag) {
  const values = new Map();
  for (const match of tag.matchAll(
    /(?:^|\s)([A-Za-z:-]+)\s*=\s*(["'])(.*?)\2/gu,
  ))
    values.set(match[1].toLowerCase(), match[3]);
  return values;
}
function uniqueExactUrls(raw, expected) {
  const og = new Set();
  const canonicalUrls = new Set();
  const android = new Set();
  const ios = new Set();
  for (const tag of raw.matchAll(/<(?:meta|link)\b[^>]*>/giu)) {
    const value = attributes(tag[0]);
    const content = clean(value.get("content"));
    if (clean(value.get("property")).toLowerCase() === "og:url")
      og.add(content);
    if (
      clean(value.get("rel")).toLowerCase().split(/\s+/u).includes("canonical")
    )
      canonicalUrls.add(clean(value.get("href")));
    const deep = content.match(/^fb:\/\/profile\/(\d{5,})\/?$/iu);
    if (deep && clean(value.get("property")).toLowerCase() === "al:android:url")
      android.add(deep[1]);
    if (deep && clean(value.get("property")).toLowerCase() === "al:ios:url")
      ios.add(deep[1]);
  }
  const exact = (urls) =>
    urls.size === 1 && [...urls].every((url) => canonical(url, expected));
  return exact(og) &&
    exact(canonicalUrls) &&
    android.size === 1 &&
    ios.size === 1
    ? { android: [...android][0], ios: [...ios][0] }
    : null;
}
function freeHtmlPageIdentity(raw, expected) {
  const links = uniqueExactUrls(raw, expected);
  if (!links || links.android !== links.ios) return null;
  const ids = new Set();
  for (const match of raw.matchAll(/\{[^{}]{0,10000}\}/gu)) {
    try {
      const row = JSON.parse(match[0]);
      const id = clean(row?.userID);
      if (
        ID.test(id) &&
        clean(row?.userVanity).toLowerCase() === expected.vanity
      )
        ids.add(id);
    } catch {}
  }
  return ids.size === 1 && ids.has(links.android)
    ? {
        pageId: links.android,
        permalinkMatch: true,
        evidenceKind: "facebook_page_html_identity",
      }
    : null;
}
export function parseFacebookPageIdentity(body, exactUrl) {
  const expected = exactFacebookUrl(exactUrl);
  if (!expected) return null;
  if (expected.pageId)
    return {
      pageId: expected.pageId,
      permalinkMatch: true,
      evidenceKind: "numeric_url",
    };
  const ids = new Set();
  let nodes = 0;
  const visit = (x, depth = 0) => {
    if (!x || typeof x !== "object" || depth > 40 || nodes++ >= 10000) return;
    const id = pageId(x, expected);
    if (id) ids.add(id);
    for (const child of Object.values(x)) visit(child, depth + 1);
  };
  const raw = clean(body).replace(/&quot;/gu, '"');
  const candidates = [
    raw,
    ...[...raw.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/giu)].map(
      (m) => m[1],
    ),
  ];
  for (const text of candidates) {
    if (nodes >= 10000) break;
    try {
      visit(JSON.parse(text));
      continue;
    } catch {}
    for (const m of text.matchAll(/\{[^{}]{0,10000}\}/gu)) {
      if (nodes >= 10000) break;
      try {
        visit(JSON.parse(m[0]));
      } catch {}
    }
  }
  if (ids.size === 1) {
    return {
      pageId: [...ids][0],
      permalinkMatch: true,
      evidenceKind: "facebook_page_identity",
    };
  }
  return freeHtmlPageIdentity(raw, expected);
}
function out(pageUrl, parsed, more = {}) {
  return {
    pageId: parsed?.pageId || null,
    permalinkMatch: parsed?.permalinkMatch === true,
    pageUrl,
    sourceDocumentId: more.sourceDocumentId || null,
    evidenceKind: parsed?.evidenceKind || null,
    actualAttempted: more.actualAttempted === true,
    error: more.error || null,
    replayed: more.replayed === true,
  };
}
function aid(run) {
  const x = hash("facebook-page-identity:" + run)
    .slice(0, 32)
    .split("");
  x[12] = "5";
  x[16] = ((parseInt(x[16], 16) & 3) | 8).toString(16);
  return [
    x.slice(0, 8),
    x.slice(8, 12),
    x.slice(12, 16),
    x.slice(16, 20),
    x.slice(20),
  ]
    .map((a) => a.join(""))
    .join("-");
}
function scope(job) {
  const p = job?.payload || {};
  const coverage = clean(
    p.facebook_identity_scope ||
      p.coverage_week ||
      p.coverageWeek ||
      p.directory_coverage_version ||
      p.coverage_version ||
      p.coverageVersion,
  );
  const sweep =
    clean(
      p.sweep_id || p.sweepId || p.build_run_id || p.buildRunId || job?.id,
    ) || "unknown";
  return coverage ? coverage + ":" + sweep : sweep;
}
function build(job) {
  const id = clean(job?.payload?.build_run_id || job?.payload?.buildRunId);
  return UUID.test(id) ? id : null;
}
function safe(e, key) {
  let s = clean(e?.message || e);
  if (clean(key)) s = s.split(clean(key)).join("[redacted]");
  return s
    .replace(/(Bearer\s+)[^\s]+/giu, "$1[redacted]")
    .replace(/([?&](?:api[_-]?key|key|token)=)[^&\s]+/giu, "$1[redacted]");
}
function retry(e, key) {
  const x = new Error(
    safe(e, key) || "facebook_page_identity_persistence_failed",
  );
  x.retryable = true;
  return x;
}
function badResponse(status, receipt, captureMode) {
  if (!Number.isInteger(status) || status < 200 || status >= 300)
    return "facebook_page_identity_provider_http_" + status;
  return captureMode !== "auto" &&
    Number.isInteger(receipt?.initialStatus) &&
    receipt.initialStatus >= 400
    ? "facebook_page_identity_provider_initial_status_" + receipt.initialStatus
    : null;
}
export function createFacebookPageIdentityEvidence({
  rest,
  rpc,
  apiKey,
  enabled = true,
  balanceEvidence,
  recordAttempt,
  patchAttempt,
  sourceDocument,
  rawEvidenceDir,
  now = () => new Date().toISOString(),
  fetchImpl = fetch,
  captureMode = "classic",
  creditCap = 1,
  renderJs = false,
}) {
  if (
    ![
      rest,
      rpc,
      balanceEvidence,
      recordAttempt,
      patchAttempt,
      sourceDocument,
    ].every((x) => typeof x === "function")
  )
    throw new Error("facebook page identity handlers are required");
  const mode = clean(captureMode).toLowerCase() || "classic";
  const cap = Number(creditCap);
  if (
    !["classic", "auto"].includes(mode) ||
    !Number.isInteger(cap) ||
    !AUTO_CAPS.has(cap)
  )
    throw new Error("facebook_page_identity_mode_not_approved");
  if (
    (mode === "classic" && (renderJs !== false || cap !== 1)) ||
    (mode === "auto" && renderJs !== false)
  )
    throw new Error("facebook_page_identity_mode_not_approved");
  const tier = mode === "classic" ? "classic_html" : "auto";
  return async ({
    exactUrl,
    entity = {},
    job = {},
    sourceDocumentIds = [],
  } = {}) => {
    const original = clean(exactUrl),
      page = exactFacebookUrl(original);
    if (!page || page.pageId)
      return out(
        original,
        page?.pageId
          ? {
              pageId: page.pageId,
              permalinkMatch: true,
              evidenceKind: "numeric_url",
            }
          : null,
        {
          error: page?.pageId
            ? "facebook_page_identity_numeric_url_not_requested"
            : "facebook_exact_url_rejected",
        },
      );
    let run;
    try {
      run = await ensureFetchRun(rest, {
        build_run_id: build(job),
        work_queue_id: job.id || null,
        advertiser_page_id: null,
        scan_mode: null,
        idempotency_key:
          "facebook-page-identity:" +
          scope(job) +
          ":" +
          mode +
          ":" +
          cap +
          ":" +
          hash(page.url),
        source_provider: PROVIDER,
        role: "primary",
        trigger: "discovery",
        target_kind: "advertiser_page",
        target_value: page.url,
        input_payload: {
          exactUrl: page.url,
          scope: scope(job),
          captureMode: mode,
          creditCap: cap,
          entity: { kind: clean(entity.kind), id: clean(entity.id) },
          sourceDocumentIds,
        },
        input_hash: hash(
          JSON.stringify({
            scope: scope(job),
            captureMode: mode,
            creditCap: cap,
            exactUrl: page.url,
          }),
        ),
        status: "running",
        result_summary: {},
      });
    } catch (e) {
      throw retry(e, apiKey);
    }
    const input = {
        adFetchRunId: run,
        metaPageId: "identity:" + hash(page.url),
      },
      attempt = aid(run);
    const close = async ({
      status,
      error = null,
      sourceDocumentId = null,
      receipt = null,
      requests,
    }) => {
      const credits =
        requests === 0 ? 0 : receipt?.chargeKnown ? receipt.credits : cap;
      const rows = await rest(
        "research",
        "ad_fetch_runs?id=eq." + encodeURIComponent(run),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            status,
            completed_at: now(),
            source_document_id: sourceDocumentId,
            provider_request_count: requests,
            provider_credits: credits,
            result_summary: {
              provider: PROVIDER,
              exact_url: page.url,
              capture_mode: mode,
              credit_cap: cap,
              actual_attempted: requests > 0,
              provider_request_count: requests,
              provider_credits: credits,
              provider_request_id: receipt?.requestId || null,
              provider_http_status: receipt?.initialStatus ?? null,
            },
            error,
          }),
        },
      );
      if (!rows?.[0]?.id)
        throw new Error(
          "facebook_page_identity_fetch_run_finalization_missing",
        );
    };
    const unavailable = async (error) => {
      try {
        await close({ status: "failed", error, requests: 0 });
      } catch (e) {
        throw retry(e, apiKey);
      }
      return out(original, null, { error });
    };
    if (!enabled) return unavailable("facebook_page_identity_disabled");
    if (!clean(apiKey))
      return unavailable("facebook_page_identity_api_key_missing");
    const classify = async ({ body, status, receipt, replayed }) => {
      const sourceDocumentId = await sourceDocument(
        "facebook_page_identity",
        page.url,
        body,
        {
          provider: PROVIDER,
          exact_url: page.url,
          captured_at: now(),
          source_document_ids: sourceDocumentIds,
          status,
          provider_request_id: receipt?.requestId || null,
        },
      );
      if (!sourceDocumentId)
        throw new Error("facebook_page_identity_source_document_missing");
      const error = badResponse(status, receipt, mode);
      const parsed = error ? null : parseFacebookPageIdentity(body, page.url);
      return out(original, parsed, {
        sourceDocumentId,
        actualAttempted: true,
        replayed,
        error: error || (parsed ? null : "facebook_page_identity_unmatched"),
      });
    };
    const finish = async (result, receipt) => {
      await close({
        status: result.pageId ? "success" : "failed",
        error: result.error,
        sourceDocumentId: result.sourceDocumentId,
        receipt,
        requests: 1,
      });
      return result;
    };
    let saved;
    try {
      saved = await loadCaptureJournal(rawEvidenceDir, input);
    } catch (e) {
      throw retry(e, apiKey);
    }
    if (saved) {
      try {
        const result = await classify({
          body: saved.body,
          status: saved.status,
          receipt: saved.receipt,
          replayed: true,
        });
        await reconcileSavedCaptureSettlement({
          rest,
          settle: (p) => rpc("settle_provider_attempt_credits", p),
          attemptId: attempt,
          runId: run,
          receipt: saved.receipt,
          outcome: result.pageId ? "success" : "blocked",
        });
        return await finish(result, saved.receipt);
      } catch (e) {
        try {
          await close({
            status: "failed",
            error: safe(e, apiKey),
            receipt: saved.receipt,
            requests: 1,
          });
        } catch (x) {
          throw retry(x, apiKey);
        }
        throw retry(e, apiKey);
      }
    }
    let balance;
    try {
      balance = await balanceEvidence();
    } catch (e) {
      return unavailable(
        "facebook_page_identity_balance_unverified: " + safe(e, apiKey),
      );
    }
    if (!balance || Number(balance.remaining) < cap)
      return unavailable("facebook_page_identity_no_funds");
    const endpoint = new URL("https://app.scrapingbee.com/api/v1/");
    endpoint.searchParams.set("url", page.url);
    if (mode === "classic") {
      endpoint.searchParams.set("render_js", "false");
      endpoint.searchParams.set("premium_proxy", "false");
    } else {
      endpoint.searchParams.set("mode", "auto");
      endpoint.searchParams.set("max_cost", String(cap));
    }
    const started = Date.now();
    try {
      return await executeScrapingBeePaidAttempt({
        maxResponseBytes: MAX,
        reserve: () =>
          rpc("reserve_provider_attempt_credits", {
            p_attempt_id: attempt,
            p_provider: "scrapingbee",
            p_run_id: run,
            p_reserved_credits: cap,
            p_run_credit_cap: cap,
            p_provider_balance_remaining: balance.remaining,
            p_provider_balance_verified_at: balance.verifiedAt,
          }),
        persist: () =>
          recordAttempt({
            ad_fetch_run_id: run,
            advertiser_page_id: null,
            provider: PROVIDER,
            attempt_index: 1,
            idempotency_key: attempt,
            provider_credit_attempt_id: attempt,
            tier,
            request_url_host: "app.scrapingbee.com",
            request_params:
              mode === "classic"
                ? { render_js: false, premium_proxy: false }
                : { mode: "auto", max_cost: cap },
            outcome: "error",
            error: "reserved_before_provider_request",
            started_at: new Date(started).toISOString(),
          }),
        request: () =>
          fetchImpl(endpoint.toString(), {
            headers: {
              Authorization: "Bearer " + apiKey,
              Accept: "text/html,application/xhtml+xml",
            },
            signal: AbortSignal.timeout(90000),
          }),
        persistReceipt: ({ receipt, response }) =>
          patchAttempt(attempt, {
            http_status: response.status,
            provider_http_status: receipt.initialStatus,
            spb_cost: receipt.spbCost,
            spb_auto_cost: receipt.spbAutoCost,
            spb_request_id: receipt.requestId,
          }),
        handleResponse: async ({ response, body, receipt }) => {
          await saveCaptureJournal(rawEvidenceDir, input, {
            body,
            receipt,
            status: response.status,
          });
          const result = await finish(
            await classify({
              body,
              status: response.status,
              receipt,
              replayed: false,
            }),
            receipt,
          );
          return {
            attempt: {
              outcome: result.pageId ? "success" : "blocked",
              httpStatus: response.status,
              responseBytes: Buffer.byteLength(body),
              error: result.error,
            },
            result,
          };
        },
        complete: ({ receipt, outcome, httpStatus, responseBytes, error }) =>
          patchAttempt(attempt, {
            http_status: httpStatus,
            provider_http_status: receipt.initialStatus,
            spb_cost: receipt.spbCost,
            spb_auto_cost: receipt.spbAutoCost,
            spb_request_id: receipt.requestId,
            credits_charged: receipt.chargeKnown ? receipt.credits : cap,
            outcome,
            response_bytes: responseBytes,
            duration_ms: Date.now() - started,
            error: safe(error, apiKey),
            completed_at: now(),
          }),
        settle: ({ outcome, chargeKnown, actualCredits }) =>
          rpc("settle_provider_attempt_credits", {
            p_attempt_id: attempt,
            p_outcome: outcome,
            p_charge_known: chargeKnown,
            p_actual_credits: chargeKnown ? actualCredits : null,
          }),
      });
    } catch (e) {
      let journal;
      try {
        journal = await loadCaptureJournal(rawEvidenceDir, input);
      } catch (x) {
        throw retry(x, apiKey);
      }
      if (journal) {
        try {
          await close({
            status: "failed",
            error: safe(e, apiKey),
            receipt: journal.receipt,
            requests: 1,
          });
        } catch (x) {
          throw retry(x, apiKey);
        }
        throw retry(e, apiKey);
      }
      const result = out(original, null, {
        actualAttempted: true,
        error: safe(e, apiKey),
      });
      try {
        await close({ status: "failed", error: result.error, requests: 1 });
      } catch (x) {
        throw retry(x, apiKey);
      }
      throw retry(e, apiKey);
    }
  };
}
