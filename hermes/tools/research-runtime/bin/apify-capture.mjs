export const APIFY_BASE_URL = "https://api.apify.com/v2";
export const DEFAULT_APIFY_RESULT_LIMIT = 250;
export const DEFAULT_APIFY_PER_RUN_CAP_USD = 1;
export const DEFAULT_APIFY_MONTHLY_CAP_USD = 25;
export const DEFAULT_APIFY_ACCOUNT_LIMIT_USD = 30;
export const BANNED_APIFY_ACTOR_IDS = Object.freeze(["apify/facebook-ads-scraper"]);

const TERMINAL_RUN_STATUSES = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);
const DEFAULT_REQUIRED_SCHEMA_GROUPS = Object.freeze([
  Object.freeze(["external_ad_id"]),
  Object.freeze(["page_id"]),
  Object.freeze(["creative_text", "media_url"]),
]);

const defaultApifyToken = () => process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN;

export class ApifyCaptureError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ApifyCaptureError";
    this.details = details;
  }
}

export async function createApifyRun({
  actorId,
  input = {},
  maxTotalChargedUsd = DEFAULT_APIFY_PER_RUN_CAP_USD,
  timeoutSecs,
  resultLimit = DEFAULT_APIFY_RESULT_LIMIT,
  resultLimitField,
  resultLimitKeys,
  token = defaultApifyToken(),
  fetchImpl = fetch,
  baseUrl = APIFY_BASE_URL,
} = {}) {
  const cleanActorId = assertNonEmptyString(actorId, "actorId");
  const perRunCap = assertPositiveNumber(maxTotalChargedUsd, "maxTotalChargedUsd");
  const cappedInput = applyApifyResultCap(input, { resultLimit, resultLimitField, resultLimitKeys });
  const url = new URL(`${baseUrl}/acts/${apifyActorPathId(cleanActorId)}/runs`);
  url.searchParams.set("maxTotalChargedUsd", moneyParam(perRunCap));
  if (timeoutSecs !== undefined) url.searchParams.set("timeout", String(assertPositiveInteger(timeoutSecs, "timeoutSecs")));

  return apifyFetchJson(fetchImpl, url, {
    method: "POST",
    headers: apifyHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(cappedInput),
  }, "create run");
}

export async function createBudgetedApifyRun(options = {}) {
  const guard = await guardApifyBudget(options);
  if (!guard.allowed) {
    throw new ApifyCaptureError(`Apify budget guard blocked run: ${guard.reason}`, { guard });
  }

  return createApifyRun({
    ...options,
    maxTotalChargedUsd: options.maxTotalChargedUsd ?? guard.perRunCapUsd ?? DEFAULT_APIFY_PER_RUN_CAP_USD,
  });
}

export async function pollApifyRun({
  runId,
  token = defaultApifyToken(),
  fetchImpl = fetch,
  baseUrl = APIFY_BASE_URL,
  intervalMs = 2000,
  timeoutMs = 120000,
  sleep = delay,
  now = () => Date.now(),
} = {}) {
  const cleanRunId = assertNonEmptyString(runId, "runId");
  const startedAt = now();

  while (true) {
    const detail = await fetchApifyRunDetails({ runId: cleanRunId, token, fetchImpl, baseUrl });
    const status = String(detail?.status || "").toUpperCase();
    if (TERMINAL_RUN_STATUSES.has(status)) {
      if (status === "SUCCEEDED") return detail;
      throw new ApifyCaptureError(`Apify run ${cleanRunId} finished with status ${status}`, { runId: cleanRunId, detail });
    }

    if (now() - startedAt >= timeoutMs) {
      throw new ApifyCaptureError(`Apify run ${cleanRunId} did not finish within ${timeoutMs}ms`, { runId: cleanRunId, detail });
    }

    await sleep(intervalMs);
  }
}

export async function fetchApifyRunDetails({
  runId,
  token = defaultApifyToken(),
  fetchImpl = fetch,
  baseUrl = APIFY_BASE_URL,
} = {}) {
  const cleanRunId = assertNonEmptyString(runId, "runId");
  return apifyFetchJson(fetchImpl, `${baseUrl}/actor-runs/${encodeURIComponent(cleanRunId)}`, {
    method: "GET",
    headers: apifyHeaders(token),
  }, "fetch run details");
}

export async function fetchApifyDatasetItems({
  datasetId,
  limit = DEFAULT_APIFY_RESULT_LIMIT,
  clean = true,
  token = defaultApifyToken(),
  fetchImpl = fetch,
  baseUrl = APIFY_BASE_URL,
} = {}) {
  const cleanDatasetId = assertNonEmptyString(datasetId, "datasetId");
  const resultLimit = assertPositiveInteger(limit, "limit");
  const url = new URL(`${baseUrl}/datasets/${encodeURIComponent(cleanDatasetId)}/items`);
  url.searchParams.set("clean", clean ? "true" : "false");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(resultLimit));

  const body = await apifyFetchJson(fetchImpl, url, {
    method: "GET",
    headers: apifyHeaders(token),
  }, "fetch dataset items", { unwrapData: false });

  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  throw new ApifyCaptureError("Apify dataset items response was not an array", { datasetId: cleanDatasetId, body });
}

export async function runApifyCapture({
  actorId,
  input,
  schemaMap,
  maxTotalChargedUsd,
  timeoutSecs,
  resultLimit = DEFAULT_APIFY_RESULT_LIMIT,
  token = defaultApifyToken(),
  fetchImpl = fetch,
  baseUrl = APIFY_BASE_URL,
  pollOptions = {},
  writeRawEvidence,
} = {}) {
  const run = await createApifyRun({
    actorId,
    input,
    maxTotalChargedUsd,
    timeoutSecs,
    resultLimit,
    token,
    fetchImpl,
    baseUrl,
  });
  const runId = run?.id;
  if (!runId) throw new ApifyCaptureError("Apify run creation response did not include a run id", { actorId, run });

  const detail = await pollApifyRun({ runId, token, fetchImpl, baseUrl, ...pollOptions });
  const datasetId = detail?.defaultDatasetId || run?.defaultDatasetId;
  if (!datasetId) throw new ApifyCaptureError("Apify run did not expose a default dataset id", { actorId, run, detail });

  const rawItems = await fetchApifyDatasetItems({ datasetId, limit: resultLimit, token, fetchImpl, baseUrl });
  const outcome = await mapApifyDatasetItems({
    actorId,
    items: rawItems,
    schemaMap,
    writeRawEvidence,
  });
  const cost = extractApifyRunCost(detail);

  return {
    ...outcome,
    costUsd: cost.costUsd,
    rawDatasetId: datasetId,
    metadata: {
      ...outcome.metadata,
      run_id: runId,
      raw_dataset_id: datasetId,
      usage_total_usd: cost.costUsd,
      charged_event_counts: cost.chargedEventCounts,
    },
  };
}

export function extractApifyRunCost(runDetail) {
  const detail = unwrapApifyData(runDetail);
  const costUsd = firstFiniteNumber([
    detail?.usageTotalUsd,
    detail?.usage_total_usd,
    detail?.chargedTotalUsd,
    detail?.charged_total_usd,
    detail?.costUsd,
    detail?.cost_usd,
    detail?.billing?.usageTotalUsd,
    detail?.billing?.totalUsd,
    detail?.usage?.totalUsd,
    detail?.usage?.usageTotalUsd,
    detail?.stats?.usageTotalUsd,
  ]) ?? 0;

  return {
    runId: detail?.id ?? null,
    actorId: detail?.actId ?? detail?.actorId ?? null,
    costUsd,
    chargedEventCounts: extractChargedEventCounts(detail),
  };
}

export function ledgerCostFromApifyRunDetail(runDetail) {
  const detail = unwrapApifyData(runDetail);
  const cost = extractApifyRunCost(detail);
  return {
    cost_usd: cost.costUsd,
    result_summary: {
      provider: cost.actorId ? `apify:${cost.actorId}` : "apify",
      apify_run_id: cost.runId,
      usage_total_usd: cost.costUsd,
      charged_event_counts: cost.chargedEventCounts,
    },
  };
}

export async function fetchApifyLimits({
  token = defaultApifyToken(),
  fetchImpl = fetch,
  baseUrl = APIFY_BASE_URL,
} = {}) {
  const body = await apifyFetchJson(fetchImpl, `${baseUrl}/users/me/limits`, {
    method: "GET",
    headers: apifyHeaders(token),
  }, "fetch limits");
  return normaliseApifyLimits(body);
}

export async function updateApifyLimits({
  maxMonthlyUsageUsd,
  token = defaultApifyToken(),
  fetchImpl = fetch,
  baseUrl = APIFY_BASE_URL,
} = {}) {
  const accountCap = assertPositiveNumber(maxMonthlyUsageUsd, "maxMonthlyUsageUsd");
  const body = await apifyFetchJson(fetchImpl, `${baseUrl}/users/me/limits`, {
    method: "PUT",
    headers: apifyHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ maxMonthlyUsageUsd: accountCap }),
  }, "update limits");
  return normaliseApifyLimits(body);
}

export async function ensureApifyAccountLimit({
  settings = {},
  desiredMaxMonthlyUsageUsd,
  token = defaultApifyToken(),
  fetchImpl = fetch,
  baseUrl = APIFY_BASE_URL,
  limits,
} = {}) {
  const parsedSettings = normaliseApifySettings(settings);
  const desired = desiredMaxMonthlyUsageUsd === undefined
    ? parsedSettings.accountLimitUsd
    : assertPositiveNumber(desiredMaxMonthlyUsageUsd, "desiredMaxMonthlyUsageUsd");
  if (desired > parsedSettings.accountLimitUsd) {
    throw new ApifyCaptureError("Apify account limit raise exceeds configured ceiling", {
      desiredMaxMonthlyUsageUsd: desired,
      configuredCeilingUsd: parsedSettings.accountLimitUsd,
    });
  }

  const current = limits ? normaliseApifyLimits(limits) : await fetchApifyLimits({ token, fetchImpl, baseUrl });
  if (current.maxMonthlyUsageUsd === desired) {
    return { updated: false, maxMonthlyUsageUsd: current.maxMonthlyUsageUsd, limits: current };
  }

  const updated = await updateApifyLimits({ maxMonthlyUsageUsd: desired, token, fetchImpl, baseUrl });
  return {
    updated: true,
    previousMaxMonthlyUsageUsd: current.maxMonthlyUsageUsd,
    maxMonthlyUsageUsd: updated.maxMonthlyUsageUsd,
    limits: updated,
  };
}

export async function guardApifyBudget({
  settings = {},
  limits,
  ledgerSpendUsd,
  readLedgerSpendUsd,
  setRuntimeSetting,
  fileDefect,
  token = defaultApifyToken(),
  fetchImpl = fetch,
  baseUrl = APIFY_BASE_URL,
  now = () => new Date(),
} = {}) {
  const parsedSettings = normaliseApifySettings(settings);
  if (!parsedSettings.enabled) {
    return {
      allowed: false,
      reason: "apify_disabled",
      failClosed: false,
      ...parsedSettings,
    };
  }

  let checkedLimits;
  try {
    checkedLimits = limits ? normaliseApifyLimits(limits) : await fetchApifyLimits({ token, fetchImpl, baseUrl });
  } catch (error) {
    return {
      allowed: false,
      reason: "apify_limits_unavailable",
      failClosed: true,
      errorMessage: error.message,
      ...parsedSettings,
    };
  }

  let localSpendUsd;
  try {
    if (ledgerSpendUsd !== undefined) {
      localSpendUsd = assertNonNegativeNumber(ledgerSpendUsd, "ledgerSpendUsd");
    } else if (typeof readLedgerSpendUsd === "function") {
      localSpendUsd = assertNonNegativeNumber(
        await readLedgerSpendUsd({
          sourceProviderPrefix: "apify:",
          since: startOfCalendarMonth(now()),
          until: now(),
        }),
        "ledgerSpendUsd",
      );
    } else {
      throw new Error("ledger reader missing");
    }
  } catch (error) {
    return {
      allowed: false,
      reason: "apify_ledger_unavailable",
      failClosed: true,
      errorMessage: error.message,
      limits: checkedLimits,
      ...parsedSettings,
    };
  }

  const apifyReportedUsageUsd = assertNonNegativeNumber(checkedLimits.monthlyUsageUsd, "monthlyUsageUsd");
  const accountBackstopThresholdUsd = Number.isFinite(checkedLimits.maxMonthlyUsageUsd)
    ? checkedLimits.maxMonthlyUsageUsd * 0.9
    : Number.POSITIVE_INFINITY;
  const warnings = [];
  if (parsedSettings.monthlyCapUsd >= checkedLimits.maxMonthlyUsageUsd) {
    warnings.push("apify_monthly_cap_not_below_account_limit");
  }

  const localCapExceeded = localSpendUsd >= parsedSettings.monthlyCapUsd;
  const accountBackstopExceeded = apifyReportedUsageUsd >= accountBackstopThresholdUsd;
  if (localCapExceeded || accountBackstopExceeded) {
    const defect = {
      signature: "apify_budget_cap",
      reason: "apify_budget_cap",
      provider: "apify",
      limitType: localCapExceeded ? "local_monthly_cap" : "account_backstop",
      localSpendUsd,
      apifyReportedUsageUsd,
      monthlyCapUsd: parsedSettings.monthlyCapUsd,
      accountBackstopThresholdUsd,
    };
    const sideEffects = await settleBudgetSideEffects([
      setRuntimeSetting?.("apify_state", "circuit_open", defect),
      fileDefect?.(defect),
    ]);

    return {
      allowed: false,
      reason: "apify_budget_cap",
      failClosed: false,
      circuitOpen: true,
      localSpendUsd,
      apifyReportedUsageUsd,
      spendUsd: localSpendUsd,
      accountBackstopThresholdUsd,
      limitType: defect.limitType,
      limits: checkedLimits,
      warnings,
      sideEffects,
      ...parsedSettings,
    };
  }

  return {
    allowed: true,
    reason: "within_budget",
    failClosed: false,
    localSpendUsd,
    apifyReportedUsageUsd,
    spendUsd: localSpendUsd,
    accountBackstopThresholdUsd,
    limits: checkedLimits,
    warnings,
    ...parsedSettings,
  };
}

export function normaliseApifySettings(settings = {}) {
  return {
    enabled: settingBoolean(settings, "apify_enabled", true),
    monthlyCapUsd: settingNumber(settings, "apify_monthly_cap_usd", DEFAULT_APIFY_MONTHLY_CAP_USD),
    perRunCapUsd: settingNumber(settings, "apify_per_run_cap_usd", DEFAULT_APIFY_PER_RUN_CAP_USD),
    accountLimitUsd: settingNumber(settings, "apify_account_limit_usd", DEFAULT_APIFY_ACCOUNT_LIMIT_USD),
    state: settingString(settings, "apify_state", "ready"),
  };
}

export function normaliseApifyLimits(limits = {}) {
  const body = unwrapApifyData(limits);
  return {
    monthlyUsageUsd: firstFiniteNumber([
      body?.current?.monthlyUsageUsd,
      body?.current?.monthly_usage_usd,
      body?.monthlyUsageUsd,
      body?.monthly_usage_usd,
    ]) ?? 0,
    maxMonthlyUsageUsd: firstFiniteNumber([
      body?.limits?.maxMonthlyUsageUsd,
      body?.limits?.max_monthly_usage_usd,
      body?.maxMonthlyUsageUsd,
      body?.max_monthly_usage_usd,
    ]) ?? Number.POSITIVE_INFINITY,
    raw: body,
  };
}

export function applyApifyResultCap(input = {}, {
  resultLimit = DEFAULT_APIFY_RESULT_LIMIT,
  resultLimitField,
  resultLimitKeys = ["maxResults", "count"],
} = {}) {
  const limit = assertPositiveInteger(resultLimit, "resultLimit");
  const source = isObject(input) ? input : {};
  const out = { ...source };
  const candidateKeys = resultLimitField ? [resultLimitField] : resultLimitKeys;
  const existingKeys = candidateKeys.filter((key) => Object.prototype.hasOwnProperty.call(out, key));
  const keysToSet = existingKeys.length ? existingKeys : [resultLimitField || "maxResults"];

  for (const key of keysToSet) {
    const current = Number(out[key]);
    out[key] = Number.isFinite(current) && current > 0 ? Math.min(Math.trunc(current), limit) : limit;
  }

  return out;
}

export async function mapApifyDatasetItems({
  actorId,
  items,
  schemaMap,
  requiredGroups = DEFAULT_REQUIRED_SCHEMA_GROUPS,
  failureThreshold = 0.05,
  writeRawEvidence,
} = {}) {
  const cleanActorId = assertNonEmptyString(actorId, "actorId");
  const rawItems = Array.isArray(items) ? items : [];
  const rows = rawItems.map((item, index) => {
    const mapped = mapSchemaFields(item, schemaMap);
    const missingGroups = missingRequiredGroups(mapped, requiredGroups);
    return { index, mapped, missingGroups, item };
  });
  const failed = rows.filter((row) => row.missingGroups.length > 0);
  const failureRate = rows.length ? failed.length / rows.length : 0;

  if (failureRate > failureThreshold) {
    const evidence = {
      provider: `apify:${cleanActorId}`,
      actorId: cleanActorId,
      reason: "schema_map_required_fields_missing",
      failureRate,
      failedCount: failed.length,
      rawItemCount: rows.length,
      failures: failed.slice(0, 25).map(({ index, missingGroups }) => ({ index, missingGroups })),
      rawItems,
    };
    if (typeof writeRawEvidence === "function") await writeRawEvidence(evidence);
    throw new ApifyCaptureError(`Apify schema_map failed for ${(failureRate * 100).toFixed(1)}% of dataset items`, evidence);
  }

  const mappedItems = rows.filter((row) => row.missingGroups.length === 0).map((row) => row.mapped);
  return {
    items: mappedItems,
    confirmed_absence: rawItems.length === 0,
    metadata: {
      provider: `apify:${cleanActorId}`,
      raw_item_count: rawItems.length,
      mapped_item_count: mappedItems.length,
      mapping_failure_count: failed.length,
      mapping_failure_rate: failureRate,
    },
  };
}

export function mapSchemaFields(item, schemaMap = {}) {
  const fields = isObject(schemaMap?.fields) ? schemaMap.fields : schemaMap;
  if (!isObject(fields)) return {};

  const mapped = {};
  for (const [targetField, spec] of Object.entries(fields)) {
    const value = normaliseMappedValue(resolveMapSpec(item, spec));
    if (value !== undefined) mapped[targetField] = value;
  }
  return mapped;
}

export function inferApifySchemaMap(items = []) {
  const rows = Array.isArray(items) ? items.filter(isObject).slice(0, 25) : [];
  const paths = rows.flatMap((item) => collectApifyValuePaths(item));
  const fields = {};
  const confidence = {};

  for (const targetField of [
    "external_ad_id",
    "page_id",
    "page_name",
    "creative_text",
    "headline",
    "landing_url",
    "media_url",
    "image_url",
    "video_url",
    "ad_snapshot_url",
    "startDate",
    "endDate",
    "status",
  ]) {
    const candidates = bestApifyFieldPaths(targetField, paths);
    if (candidates.length) {
      fields[targetField] = candidates.length === 1 ? candidates[0].path : { paths: candidates.map((candidate) => candidate.path) };
      confidence[targetField] = candidates[0].score;
    }
  }

  return {
    fields,
    inferred: true,
    sample_size: rows.length,
    confidence,
  };
}

export async function fetchApifyActorDetails({
  actorId,
  token = defaultApifyToken(),
  fetchImpl = fetch,
  baseUrl = APIFY_BASE_URL,
} = {}) {
  const cleanActorId = assertNonEmptyString(actorId, "actorId");
  return apifyFetchJson(fetchImpl, `${baseUrl}/acts/${apifyActorPathId(cleanActorId)}`, {
    method: "GET",
    headers: apifyHeaders(token),
  }, "fetch actor details");
}

export function extractApifyPricePer1kUsd(actorDetail) {
  const detail = unwrapApifyData(actorDetail);
  const pricingInfos = Array.isArray(detail?.pricingInfos)
    ? detail.pricingInfos
    : Array.isArray(detail?.pricing_infos)
      ? detail.pricing_infos
      : [];
  const prices = [];

  for (const info of pricingInfos) {
    const model = String(info?.pricingModel || info?.pricing_model || info?.model || "").toUpperCase();
    const directPrice = firstFiniteNumber([
      info?.pricePerEvent,
      info?.price_per_event,
      info?.pricePerDatasetItem,
      info?.price_per_dataset_item,
      info?.pricePerResult,
      info?.price_per_result,
      info?.pricingInfo?.pricePerEvent,
      info?.pricingInfo?.pricePerDatasetItem,
    ]);
    if (directPrice !== undefined && /PAY_PER_EVENT|PRICE_PER_DATASET_ITEM|PAY_PER_RESULT/u.test(model)) {
      prices.push(directPrice * 1000);
    }

    const tiers = [info?.tiers, info?.pricingTiers, info?.prices].filter(Array.isArray).flat();
    for (const tier of tiers) {
      const tierPrice = firstFiniteNumber([
        tier?.pricePerEvent,
        tier?.price_per_event,
        tier?.pricePerDatasetItem,
        tier?.price_per_dataset_item,
        tier?.unitPrice,
        tier?.unit_price,
      ]);
      if (tierPrice !== undefined) prices.push(tierPrice * 1000);
    }
  }

  return prices.length ? Math.min(...prices) : null;
}

export function scoreApifyActor(actor, options = {}) {
  const actorId = String(actor?.actor_id || actor?.actorId || actor?.id || "").trim();
  const bannedActorIds = new Set([...(options.bannedActorIds || BANNED_APIFY_ACTOR_IDS)]);
  const status = String(actor?.status || "").toLowerCase();

  if (!actorId) return { actorId: null, selectable: false, reason: "missing_actor_id" };
  if (status === "banned" || bannedActorIds.has(actorId)) return { actorId, selectable: false, reason: "banned" };
  if (status !== "approved") return { actorId, selectable: false, reason: "not_approved" };

  const benchmark = actor?.last_benchmark || actor?.lastBenchmark;
  if (!isObject(benchmark)) return { actorId, selectable: false, reason: "missing_benchmark" };

  const benchmarkStatus = String(benchmark.status || "").toLowerCase();
  if (benchmark.passed === false || benchmarkStatus === "failed") {
    return { actorId, selectable: false, reason: "benchmark_failed" };
  }

  const failureRate = firstFiniteNumber([benchmark.failure_rate, benchmark.failureRate]) ?? 0;
  const duplicateRatio = firstFiniteNumber([benchmark.duplicate_ratio, benchmark.duplicateRatio]) ?? 0;
  const mappingPassRate = firstFiniteNumber([benchmark.mapping_pass_rate, benchmark.mappingPassRate, benchmark.schema_map_pass_rate]) ?? 1;
  if (failureRate > (options.maxFailureRate ?? 0.05)) return { actorId, selectable: false, reason: "failure_rate_too_high", failureRate };
  if (duplicateRatio >= (options.maxDuplicateRatio ?? 0.1)) return { actorId, selectable: false, reason: "duplicate_ratio_too_high", duplicateRatio };
  if (mappingPassRate < (options.minMappingPassRate ?? 0.95)) return { actorId, selectable: false, reason: "mapping_pass_rate_too_low", mappingPassRate };

  const validAdCount = firstFiniteNumber([
    benchmark.valid_ad_count,
    benchmark.validAdCount,
    benchmark.valid_ads,
    benchmark.validAds,
  ]);
  const costUsd = firstFiniteNumber([
    benchmark.cost_usd,
    benchmark.costUsd,
    benchmark.usage_total_usd,
    benchmark.usageTotalUsd,
  ]);
  const costPerValidAdUsd = firstFiniteNumber([
    benchmark.cost_per_valid_ad_usd,
    benchmark.costPerValidAdUsd,
  ]) ?? (costUsd !== undefined && validAdCount > 0 ? costUsd / validAdCount : undefined);

  if (!(validAdCount > 0) && costPerValidAdUsd === undefined) {
    return { actorId, selectable: false, reason: "missing_valid_ad_cost" };
  }
  if (!(costPerValidAdUsd >= 0)) return { actorId, selectable: false, reason: "invalid_cost_per_valid_ad" };

  return {
    actorId,
    selectable: true,
    reason: "passing",
    score: costPerValidAdUsd,
    costPerValidAdUsd,
    validAdCount: validAdCount ?? null,
    costUsd: costUsd ?? null,
    latencyMs: firstFiniteNumber([benchmark.latency_ms, benchmark.latencyMs]) ?? null,
    failureRate,
    duplicateRatio,
    mappingPassRate,
  };
}

export function selectCheapestApifyActor(actors = [], options = {}) {
  const scores = (Array.isArray(actors) ? actors : []).map((actor) => scoreApifyActor(actor, options));
  const selectable = scores
    .filter((score) => score.selectable)
    .sort((a, b) => {
      const byScore = a.score - b.score;
      if (Math.abs(byScore) > 1e-12) return byScore;
      const currentActorId = options.currentActorId ? String(options.currentActorId) : null;
      if (currentActorId && a.actorId === currentActorId) return -1;
      if (currentActorId && b.actorId === currentActorId) return 1;
      return (a.latencyMs ?? Number.POSITIVE_INFINITY) - (b.latencyMs ?? Number.POSITIVE_INFINITY);
    });

  if (!selectable.length) {
    return { actor: null, actorId: null, score: null, scores, reason: "no_passing_actors" };
  }

  const winner = selectable[0];
  const actor = actors.find((candidate) => String(candidate?.actor_id || candidate?.actorId || candidate?.id || "").trim() === winner.actorId) || null;
  return { actor, actorId: winner.actorId, score: winner, scores, reason: "selected_cheapest_passing_actor" };
}

export function summariseBenchmarkItems(items = []) {
  const rows = Array.isArray(items) ? items : [];
  const seen = new Set();
  let duplicateCount = 0;
  let validAdCount = 0;

  for (const item of rows) {
    if (!isBenchmarkAdValid(item)) continue;
    validAdCount += 1;
    const externalId = String(item.external_ad_id || item.externalAdId || item.ad_id || item.adId || item.id).trim();
    if (seen.has(externalId)) duplicateCount += 1;
    seen.add(externalId);
  }

  return {
    rawItemCount: rows.length,
    validAdCount,
    duplicateCount,
    duplicateRatio: validAdCount ? duplicateCount / validAdCount : 0,
  };
}

export function isBenchmarkAdValid(item) {
  return Boolean(
    firstUsefulValue([item?.external_ad_id, item?.externalAdId, item?.ad_id, item?.adId, item?.id]) &&
    firstUsefulValue([item?.page_id, item?.pageId, item?.pageID]) &&
    firstUsefulValue([item?.creative_text, item?.creativeText, item?.body, item?.text, item?.media_url, item?.mediaUrl, item?.image_url, item?.video_url]),
  );
}

export function apifyActorPathId(actorId) {
  return encodeURIComponent(assertNonEmptyString(actorId, "actorId").replace(/\//gu, "~"));
}

function apifyHeaders(token, extra = {}) {
  return {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function apifyFetchJson(fetchImpl, url, init, action, options = {}) {
  const response = await fetchImpl(url, init);
  const body = await readJsonResponse(response);
  if (!response.ok) {
    throw new ApifyCaptureError(`Apify ${action} failed with HTTP ${response.status}`, {
      status: response.status,
      body,
    });
  }

  return options.unwrapData === false ? body : unwrapApifyData(body);
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function unwrapApifyData(body) {
  return body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "data") ? body.data : body;
}

function extractChargedEventCounts(detail) {
  const direct = detail?.chargedEventCounts || detail?.charged_event_counts || detail?.usage?.chargedEventCounts;
  if (isObject(direct)) return direct;

  const counts = {};
  const usage = isObject(detail?.usage) ? detail.usage : {};
  for (const [key, value] of Object.entries(usage)) {
    if (isObject(value)) {
      const count = firstFiniteNumber([value.count, value.quantity, value.chargedCount]);
      if (count !== undefined) counts[key] = count;
    }
  }
  return counts;
}

function resolveMapSpec(item, spec) {
  if (typeof spec === "string") return readPath(item, spec);
  if (Array.isArray(spec)) return firstUsefulValue(spec.map((entry) => resolveMapSpec(item, entry)));
  if (!isObject(spec)) return spec;
  if (Object.prototype.hasOwnProperty.call(spec, "literal")) return spec.literal;

  let value;
  if (typeof spec.path === "string") value = readPath(item, spec.path);
  if (!hasUsefulValue(value) && Array.isArray(spec.paths)) {
    value = firstUsefulValue(spec.paths.map((path) => resolveMapSpec(item, path)));
  }
  if (!hasUsefulValue(value) && Array.isArray(spec.coalesce)) {
    value = firstUsefulValue(spec.coalesce.map((entry) => resolveMapSpec(item, entry)));
  }
  if (!hasUsefulValue(value) && Object.prototype.hasOwnProperty.call(spec, "default")) value = spec.default;
  if (Array.isArray(value) && spec.join) value = value.filter(hasUsefulValue).map(String).join(String(spec.join === true ? " " : spec.join));
  if (spec.type === "string" && value !== undefined && value !== null) value = String(value);
  if (spec.type === "number" && value !== undefined && value !== null) value = Number(value);
  if (spec.trim === false) return value;
  return value;
}

function collectApifyValuePaths(value, path = "", out = []) {
  if (Array.isArray(value)) {
    if (path) out.push({ path, key: lastPathKey(path), value });
    value.slice(0, 3).forEach((entry, index) => collectApifyValuePaths(entry, `${path}[${index}]`, out));
    return out;
  }
  if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      collectApifyValuePaths(entry, nextPath, out);
    }
    return out;
  }
  if (path && hasUsefulValue(value)) out.push({ path, key: lastPathKey(path), value });
  return out;
}

function bestApifyFieldPaths(targetField, paths) {
  const seen = new Set();
  const scored = paths
    .map((entry) => ({ ...entry, score: scoreApifyFieldPath(targetField, entry) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  const bestScore = scored[0]?.score || 0;
  const floor = Math.max(40, bestScore * 0.6);
  const out = [];
  for (const entry of scored) {
    if (entry.score < floor || seen.has(entry.path)) continue;
    seen.add(entry.path);
    out.push({ path: entry.path, score: entry.score });
    if (out.length >= 6) break;
  }
  return out;
}

function scoreApifyFieldPath(targetField, { path, key, value }) {
  const normalisedPath = path.toLowerCase();
  const normalisedKey = key.toLowerCase();
  const textValues = arrayValues(value).map((entry) => String(entry || "").trim()).filter(Boolean);
  const firstText = textValues[0] || "";
  const isNumericId = textValues.some((entry) => /^\d{8,}$/u.test(entry));
  const isUrl = textValues.some((entry) => /^https?:\/\//iu.test(entry));
  const isLongText = textValues.some((entry) => /[a-z]/iu.test(entry) && entry.length >= 20);
  const contains = (...needles) => needles.some((needle) => normalisedPath.includes(needle) || normalisedKey.includes(needle));

  if (targetField === "external_ad_id") {
    if (!isNumericId) return 0;
    if (contains("adarchiveid", "ad_archive_id", "archive_id", "library_id")) return 120;
    if (contains("ad.id", "ad_id", "adid", "ad.id")) return 95;
    if (normalisedKey === "id" && contains("ad", "creative")) return 70;
    return normalisedKey === "id" ? 20 : 0;
  }

  if (targetField === "page_id") {
    if (!isNumericId) return 0;
    if (contains("pageid", "page_id", "page.id", "page_id")) return 110;
    if (normalisedKey === "id" && contains("page")) return 80;
    return 0;
  }

  if (targetField === "page_name") {
    if (!isLongText && firstText.length < 3) return 0;
    return contains("page_name", "pagename", "page.name") ? 90 : 0;
  }

  if (targetField === "creative_text") {
    if (!isLongText) return 0;
    if (contains("creative_text", "body", "message", "text", "ad_creative_bodies")) return 100;
    if (contains("description", "caption")) return 40;
    return 0;
  }

  if (targetField === "headline") {
    if (!firstText || firstText.length > 180 || isUrl) return 0;
    return contains("headline", "title", "link_title") ? 80 : 0;
  }

  if (targetField === "landing_url") {
    if (!isUrl) return 0;
    return contains("landing", "link_url", "url", "destination") && !contains("image", "video", "media", "thumbnail", "snapshot")
      ? 90
      : 0;
  }

  if (targetField === "media_url" || targetField === "image_url" || targetField === "video_url") {
    if (!isUrl) return 0;
    const mediaScore = contains("media", "image", "video", "thumbnail", "picture", "originalimageurl", "videohdurl") ? 90 : 0;
    if (targetField === "image_url" && contains("image", "picture", "originalimageurl")) return mediaScore + 15;
    if (targetField === "video_url" && contains("video", "videohdurl", "videosdurl")) return mediaScore + 15;
    return targetField === "media_url" ? mediaScore : 0;
  }

  if (targetField === "ad_snapshot_url") {
    return isUrl && contains("snapshot", "ad_snapshot") ? 80 : 0;
  }

  if (targetField === "startDate") {
    return firstText && contains("start", "delivery_start") ? 60 : 0;
  }

  if (targetField === "endDate") {
    return firstText && contains("end", "stop", "delivery_stop") ? 60 : 0;
  }

  if (targetField === "status") {
    return /^(active|inactive|ended|stopped)$/iu.test(firstText) && contains("status") ? 60 : 0;
  }

  return 0;
}

function arrayValues(value) {
  return Array.isArray(value) ? value.flatMap(arrayValues) : [value];
}

function lastPathKey(path) {
  const withoutIndex = String(path).replace(/\[\d+\]$/u, "");
  return withoutIndex.split(".").pop() || withoutIndex;
}

function readPath(source, path) {
  if (path === "$" || path === ".") return source;
  const tokens = pathTokens(path);
  let current = source;
  for (const token of tokens) {
    if (current === undefined || current === null) return undefined;
    current = current[token];
  }
  return current;
}

function pathTokens(path) {
  const tokens = [];
  for (const segment of String(path).split(".")) {
    const matches = segment.matchAll(/([^[\]]+)|\[(\d+)\]/gu);
    for (const match of matches) tokens.push(match[1] ?? Number(match[2]));
  }
  return tokens;
}

function missingRequiredGroups(mapped, requiredGroups) {
  return requiredGroups.filter((group) => !group.some((field) => hasUsefulValue(mapped?.[field])));
}

function normaliseMappedValue(value) {
  if (Array.isArray(value)) {
    const cleaned = value.map(normaliseMappedValue).filter((entry) => entry !== undefined);
    return cleaned.length ? cleaned : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (value === null || value === undefined) return undefined;
  return value;
}

function firstUsefulValue(values) {
  return values.find(hasUsefulValue);
}

function hasUsefulValue(value) {
  if (Array.isArray(value)) return value.some(hasUsefulValue);
  if (typeof value === "string") return value.trim().length > 0;
  return value !== undefined && value !== null;
}

function firstFiniteNumber(values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function settingValue(settings, key) {
  if (settings instanceof Map) return settings.get(key);
  if (Array.isArray(settings)) {
    const row = settings.find((candidate) => candidate?.key === key || candidate?.name === key || candidate?.setting_key === key);
    if (!row) return undefined;
    return row.value_json ?? row.value ?? row.setting_value ?? row.settingValue;
  }
  if (isObject(settings) && Object.prototype.hasOwnProperty.call(settings, key)) return settings[key];
  return undefined;
}

function settingNumber(settings, key, fallback) {
  const value = settingValue(settings, key);
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function settingBoolean(settings, key, fallback) {
  const value = settingValue(settings, key);
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return !["false", "0", "off", "no", "disabled"].includes(String(value).trim().toLowerCase());
}

function settingString(settings, key, fallback) {
  const value = settingValue(settings, key);
  return value === undefined || value === null ? fallback : String(value);
}

function startOfCalendarMonth(date) {
  const value = date instanceof Date ? date : new Date(date);
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

async function settleBudgetSideEffects(promises) {
  const settled = await Promise.allSettled(promises.filter(Boolean));
  return settled.map((entry) => entry.status === "fulfilled"
    ? { status: "fulfilled" }
    : { status: "rejected", reason: entry.reason?.message || String(entry.reason) });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function moneyParam(value) {
  return String(Math.round(value * 100) / 100);
}

function assertNonEmptyString(value, name) {
  const string = String(value ?? "").trim();
  if (!string) throw new ApifyCaptureError(`${name} is required`);
  return string;
}

function assertPositiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new ApifyCaptureError(`${name} must be a positive number`);
  return number;
}

function assertNonNegativeNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new ApifyCaptureError(`${name} must be a non-negative number`);
  return number;
}

function assertPositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new ApifyCaptureError(`${name} must be a positive integer`);
  return Math.trunc(number);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
