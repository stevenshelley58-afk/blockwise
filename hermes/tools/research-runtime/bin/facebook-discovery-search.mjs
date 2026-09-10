import { createHash } from "node:crypto";
import {
  ensureFetchRun,
  loadCaptureJournal,
  reconcileSavedCaptureSettlement,
  saveCaptureJournal,
} from "./ad-radar-capture-journal.mjs";
import { executeScrapingBeePaidAttempt } from "./scrapingbee-paid-attempt.mjs";

const PROVIDER = "scrapingbee_google_search";
const CAP = 10;
const ENDPOINT = "https://app.scrapingbee.com/api/v1/google";
const MAX_RESPONSE_BYTES = 2_000_000;
// A paid Google search is only worth making while the provider can resolve the
// result links. On 2026-09-10 every result of every search came back as an
// unresolved Google /goto?url= redirect and each one was charged 10 credits:
// 38,445 credits in 100 minutes across a directory sweep. Three consecutive
// provider-side resolution failures inside an hour is treated as a provider
// capability problem, and paid searches stop instead of repeating per entity.
const PROVIDER_RESOLUTION_FAILURE_LIMIT = 3;
const PROVIDER_RESOLUTION_FAILURE_WINDOW_MS = 60 * 60 * 1000;
const PROVIDER_RESOLUTION_FAILURE =
  /^google_search_(?:goto_urls_unresolved|result_url_missing)$/u;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const clean = (value) => String(value ?? "").trim();
const hash = (value) =>
  createHash("sha256").update(String(value)).digest("hex");

function attemptIdFor(runId) {
  const chars = hash(`attempt:${runId}`).slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 3) | 8).toString(16);
  return `${chars.slice(0, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12, 16).join("")}-${chars.slice(16, 20).join("")}-${chars.slice(20).join("")}`;
}
function safeError(error, apiKey, query = "") {
  let message = clean(error?.message || error);
  const querySecret = clean(query);
  const secrets = [clean(apiKey)];
  if (querySecret.length > 2 && !/^google_search_[a-z0-9_]+$/iu.test(message)) {
    secrets.push(querySecret, encodeURIComponent(querySecret));
  }
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return message
    .replace(/(Bearer\s+)[^\s]+/giu, "$1[redacted]")
    .replace(
      /([?&](?:api[_-]?key|key|token|search|q)=)[^&\s]+/giu,
      "$1[redacted]",
    );
}
function retryable(error, apiKey, query) {
  const result = new Error(
    safeError(error, apiKey, query) || "google_search_persistence_failed",
  );
  result.retryable = true;
  return result;
}

function searchScope(job) {
  const payload = job?.payload || {};
  const sweep =
    clean(
      payload.sweep_id ||
        payload.sweepId ||
        payload.build_run_id ||
        payload.buildRunId ||
        job?.sweep_id ||
        job?.sweepId ||
        job?.id,
    ) || "unknown";
  const coverage = clean(
    payload.directory_coverage_version ||
      payload.coverage_version ||
      payload.coverageVersion,
  );
  return coverage ? `${sweep}:coverage:${coverage}` : sweep;
}
function buildRunIdFor(job) {
  const value = clean(job?.payload?.build_run_id || job?.payload?.buildRunId);
  return UUID.test(value) ? value : null;
}

function responseFailure(status, receipt) {
  if (!Number.isInteger(status) || status < 200 || status >= 300)
    return `google_search_provider_http_${status}`;
  return Number.isInteger(receipt?.initialStatus) &&
    receipt.initialStatus >= 400
    ? `google_search_provider_initial_status_${receipt.initialStatus}`
    : null;
}

/**
 * True when recent paid Google searches all failed because the provider could
 * not resolve result links. Reading the attempt ledger costs nothing, so the
 * sweep stops spending once the provider's state is proven rather than
 * discovering it again for every remaining entity.
 */
export async function providerResolutionDegraded(
  rest,
  now = () => new Date().toISOString(),
) {
  try {
    const since = new Date(
      Date.parse(now()) - PROVIDER_RESOLUTION_FAILURE_WINDOW_MS,
    ).toISOString();
    const rows = await rest(
      "research",
      "ad_fetch_attempts?select=outcome,error&tier=eq.google_light"
        + `&started_at=gte.${encodeURIComponent(since)}`
        + `&order=started_at.desc&limit=${PROVIDER_RESOLUTION_FAILURE_LIMIT}`,
    );
    if (!Array.isArray(rows) || rows.length < PROVIDER_RESOLUTION_FAILURE_LIMIT)
      return false;
    return rows.every(
      (row) =>
        clean(row?.outcome) !== "success" &&
        PROVIDER_RESOLUTION_FAILURE.test(clean(row?.error)),
    );
  } catch {
    // A spending guard must never block the search path when history is
    // unreadable; the per-request accounting still protects the budget.
    return false;
  }
}

export function parseGoogleSearchResponse(body, query) {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("google_search_invalid_json");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("google_search_invalid_payload");
  if (
    payload.error ||
    payload.errors ||
    payload.error_message ||
    payload.challenge ||
    payload.challenges ||
    payload.captcha
  )
    throw new Error("google_search_blocked_or_error");
  const supplied = [
    payload.metadata?.query,
    payload.meta_data?.query,
    payload.query,
  ]
    .filter((value) => value !== undefined)
    .map(clean);
  const metaUrl = clean(payload.meta_data?.url || payload.metadata?.url);
  if (metaUrl) {
    let parsed;
    try {
      parsed = new URL(metaUrl);
    } catch {
      throw new Error("google_search_metadata_url_invalid");
    }
    const q = parsed.searchParams.get("q");
    if (q === null) throw new Error("google_search_metadata_query_missing");
    supplied.push(clean(q));
  }
  if (supplied.some((value) => value !== clean(query)))
    throw new Error("google_search_query_mismatch");
  if (!Array.isArray(payload.organic_results))
    throw new Error("google_search_missing_results");
  // Unresolved Google /goto?url= redirects mean the provider found results but
  // could not resolve their links. That is a provider-side capability failure
  // charged in full, not a per-result parse error, so it gets its own name and
  // the sweep can stop spending instead of repeating it for every entity.
  const gotoUrls =
    payload.meta_data?.goto_urls || payload.metadata?.goto_urls || null;
  const unresolvedRedirects = payload.organic_results.filter((item) =>
    /^(?:https?:\/\/www\.google\.[^/]+\/|\/)?goto\?url=/iu.test(
      clean(item?.url || item?.link),
    ),
  );
  if (
    unresolvedRedirects.length > 0 &&
    unresolvedRedirects.length === payload.organic_results.length &&
    Number(gotoUrls?.resolved ?? 0) === 0
  )
    throw new Error("google_search_goto_urls_unresolved");
  const results = payload.organic_results.map((item) => {
    const url = clean(item?.url || item?.link);
    if (!/^https?:\/\//iu.test(url))
      throw new Error("google_search_result_url_missing");
    return {
      url,
      title: clean(item?.title),
      description: clean(item?.description || item?.snippet),
    };
  });
  const zeroFlag = payload.zero_results_for_original_query;
  if (zeroFlag !== undefined && typeof zeroFlag !== "boolean")
    throw new Error("google_search_zero_results_flag_invalid");
  if (zeroFlag === true && results.length > 0)
    throw new Error("google_search_zero_results_mismatch");
  return {
    results,
    zeroResultsForOriginalQuery:
      typeof zeroFlag === "boolean" ? zeroFlag : results.length === 0,
  };
}

export function createFacebookSearchEvidence({
  rest,
  rpc,
  apiKey,
  enabled = true,
  balanceEvidence,
  recordAttempt,
  patchAttempt,
  sourceDocument,
  rawEvidenceDir,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
}) {
  if (
    ![rest, rpc, recordAttempt, patchAttempt, sourceDocument].every(
      (fn) => typeof fn === "function",
    )
  )
    throw new Error("facebook search handlers are required");
  return async ({ entity = {}, query, job = {} }) => {
    const search = clean(query);
    if (!search)
      return {
        complete: false,
        actualAttempted: false,
        error: "google_search_query_missing",
        sourceUrl: "reason:google_search_query_missing",
        results: [],
        providerRequestCount: 0,
      };
    const kind = clean(entity.kind || entity.type || "entity");
    const id = clean(
      entity.id || entity.entityId || entity.key || job.id || "unknown",
    );
    const scope = searchScope(job),
      queryHash = hash(search);
    let runId;
    try {
      runId = await ensureFetchRun(rest, {
        build_run_id: buildRunIdFor(job),
        work_queue_id: job.id || null,
        advertiser_page_id: null,
        scan_mode: null,
        idempotency_key: `facebook-discovery-search:${scope}:${kind}:${id}:${queryHash}`,
        source_provider: PROVIDER,
        role: "primary",
        trigger: "discovery",
        target_kind: "search_query",
        target_value: search,
        input_payload: { entity: { kind, id }, query: search, scope },
        input_hash: hash(JSON.stringify({ kind, id, search, scope })),
        status: "running",
        result_summary: {},
      });
    } catch (error) {
      throw retryable(error, apiKey, search);
    }
    const input = {
      adFetchRunId: runId,
      metaPageId: `search:${kind}:${id}:${queryHash}`,
    };
    const sourceUrl = `https://www.google.com/search?q=${encodeURIComponent(search)}`;
    const attemptId = attemptIdFor(runId);
    const closeRun = async ({
      status,
      error = null,
      sourceDocumentId = null,
      receipt = null,
      requests,
      zeroResults = false,
    }) => {
      const credits =
        requests === 0 ? 0 : receipt?.chargeKnown ? receipt.credits : CAP;
      const rows = await rest(
        "research",
        `ad_fetch_runs?id=eq.${encodeURIComponent(runId)}`,
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
              query: search,
              actual_attempted: requests > 0,
              provider_request_count: requests,
              provider_credits: credits,
              zero_results_for_original_query: zeroResults,
              provider_request_id: receipt?.requestId || null,
              provider_http_status: receipt?.initialStatus ?? null,
            },
            error,
          }),
        },
      );
      if (!rows?.[0]?.id)
        throw new Error("google_search_fetch_run_finalization_missing");
    };
    const unavailable = async (error) => {
      try {
        await closeRun({ status: "failed", error, requests: 0 });
      } catch (finalizationError) {
        throw retryable(finalizationError, apiKey, search);
      }
      return {
        complete: false,
        actualAttempted: false,
        error,
        sourceUrl: `reason:${error}`,
        results: [],
        providerRequestCount: 0,
      };
    };
    if (!enabled) return unavailable("google_search_disabled");
    if (!clean(apiKey)) return unavailable("google_search_api_key_missing");
    if (await providerResolutionDegraded(rest, now))
      return unavailable("google_search_provider_degraded");

    const classify = async ({ body, status, receipt, replayed }) => {
      const sourceDocumentId = await sourceDocument(
        "facebook_discovery_google_search",
        sourceUrl,
        body,
        {
          provider: PROVIDER,
          query: search,
          entity_kind: kind,
          entity_id: id,
          status,
          provider_request_id: receipt?.requestId || null,
          captured_at: now(),
        },
      );
      if (!sourceDocumentId)
        throw new Error("google_search_source_document_missing");
      const invalid = responseFailure(status, receipt);
      if (invalid)
        return {
          complete: false,
          actualAttempted: true,
          error: invalid,
          sourceDocumentId,
          sourceUrl,
          results: [],
          receipt,
          replayed,
        };
      try {
        const parsed = parseGoogleSearchResponse(body, search);
        return {
          complete: true,
          actualAttempted: true,
          sourceDocumentId,
          sourceUrl,
          results: parsed.results,
          zeroResultsForOriginalQuery: parsed.zeroResultsForOriginalQuery,
          receipt,
          replayed,
        };
      } catch (error) {
        return {
          complete: false,
          actualAttempted: true,
          error: safeError(error, apiKey, search),
          sourceDocumentId,
          sourceUrl,
          results: [],
          receipt,
          replayed,
        };
      }
    };
    const finish = async (result) => {
      await closeRun({
        status: result.complete ? "success" : "failed",
        error: result.error || null,
        sourceDocumentId: result.sourceDocumentId,
        receipt: result.receipt,
        requests: 1,
        zeroResults: result.zeroResultsForOriginalQuery === true,
      });
      return { ...result, providerRequestCount: 1 };
    };
    let saved;
    try {
      saved = await loadCaptureJournal(rawEvidenceDir, input);
    } catch (error) {
      throw retryable(error, apiKey, search);
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
          settle: (payload) => rpc("settle_provider_attempt_credits", payload),
          attemptId,
          runId,
          receipt: saved.receipt,
          outcome: result.complete ? "success" : "blocked",
        });
        return await finish(result);
      } catch (error) {
        try {
          await closeRun({
            status: "failed",
            error: safeError(error, apiKey, search),
            receipt: saved.receipt,
            requests: 1,
          });
        } catch (finalizationError) {
          throw retryable(finalizationError, apiKey, search);
        }
        throw retryable(error, apiKey, search);
      }
    }
    let balance;
    try {
      balance = await balanceEvidence();
    } catch (error) {
      return unavailable(
        `google_search_balance_unverified: ${safeError(error, apiKey, search)}`,
      );
    }
    if (!balance || Number(balance.remaining) < CAP)
      return unavailable("google_search_no_funds");
    const params = new URLSearchParams({
      search,
      country_code: "au",
      light_request: "true",
      page: "1",
      pages: "1",
      search_type: "classic",
      nfpr: "true",
    });
    const started = Date.now();
    try {
      return await executeScrapingBeePaidAttempt({
        maxResponseBytes: MAX_RESPONSE_BYTES,
        reserve: () =>
          rpc("reserve_provider_attempt_credits", {
            p_attempt_id: attemptId,
            p_provider: "scrapingbee",
            p_run_id: runId,
            p_reserved_credits: CAP,
            p_run_credit_cap: CAP,
            p_provider_balance_remaining: balance.remaining,
            p_provider_balance_verified_at: balance.verifiedAt,
          }),
        persist: () =>
          recordAttempt({
            ad_fetch_run_id: runId,
            advertiser_page_id: null,
            provider: "scrapingbee",
            attempt_index: 1,
            idempotency_key: attemptId,
            provider_credit_attempt_id: attemptId,
            tier: "google_light",
            request_url_host: "app.scrapingbee.com",
            request_params: {
              search,
              country_code: "au",
              light_request: true,
              page: 1,
              pages: 1,
              search_type: "classic",
              nfpr: true,
            },
            outcome: "error",
            error: "reserved_before_provider_request",
            started_at: new Date(started).toISOString(),
          }),
        request: () =>
          fetchImpl(`${ENDPOINT}?${params}`, {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(90_000),
          }),
        persistReceipt: ({ receipt, response }) =>
          patchAttempt(attemptId, {
            http_status: response.status,
            provider_http_status: receipt.initialStatus,
            spb_cost: receipt.spbCost,
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
          );
          return {
            attempt: {
              outcome: result.complete ? "success" : "blocked",
              httpStatus: response.status,
              responseBytes: Buffer.byteLength(body),
              error: result.error || null,
            },
            result,
          };
        },
        complete: ({ receipt, outcome, httpStatus, responseBytes, error }) =>
          patchAttempt(attemptId, {
            http_status: httpStatus,
            provider_http_status: receipt.initialStatus,
            spb_cost: receipt.spbCost,
            spb_request_id: receipt.requestId,
            credits_charged: receipt.chargeKnown ? receipt.credits : CAP,
            outcome,
            response_bytes: responseBytes,
            duration_ms: Date.now() - started,
            error: safeError(error, apiKey, search),
            completed_at: now(),
          }),
        settle: ({ outcome, chargeKnown, actualCredits }) =>
          rpc("settle_provider_attempt_credits", {
            p_attempt_id: attemptId,
            p_outcome: outcome,
            p_charge_known: chargeKnown,
            p_actual_credits: chargeKnown ? actualCredits : null,
          }),
      });
    } catch (error) {
      let journal;
      try {
        journal = await loadCaptureJournal(rawEvidenceDir, input);
      } catch (journalError) {
        throw retryable(journalError, apiKey, search);
      }
      if (journal) {
        try {
          await closeRun({
            status: "failed",
            error: safeError(error, apiKey, search),
            receipt: journal.receipt,
            requests: 1,
          });
        } catch (finalizationError) {
          throw retryable(finalizationError, apiKey, search);
        }
        throw retryable(error, apiKey, search);
      }
      const failure = {
        complete: false,
        actualAttempted: true,
        error: safeError(error, apiKey, search),
        sourceUrl,
        results: [],
        providerRequestCount: 1,
      };
      try {
        await closeRun({ status: "failed", error: failure.error, requests: 1 });
      } catch (finalizationError) {
        throw retryable(finalizationError, apiKey, search);
      }
      return failure;
    }
  };
}
