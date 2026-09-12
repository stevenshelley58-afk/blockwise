function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function linkedRecord(page, key) {
  const value = page?.[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The first-fill lane is deliberately limited to the audited WA roster.
 * A globally scan-enabled Page is not authorization to spend the first-fill
 * budget. An unlinked page may enter only when an operator explicitly placed
 * it in the WA unmapped quarantine.
 */
export function isWaFirstFillScope(page) {
  const verifiedWa = (record) => {
    const row = asObject(record);
    return String(row.state || "").toUpperCase() === "WA"
      && String(row.status || "") === "licensed_verified";
  };
  if (verifiedWa(linkedRecord(page, "agent")) || verifiedWa(linkedRecord(page, "agency"))
    || verifiedWa(linkedRecord(page, "agents")) || verifiedWa(linkedRecord(page, "agencies"))) return true;

  const metadata = asObject(page?.metadata);
  return !page?.agent_id
    && !page?.agency_id
    && String(metadata.first_fill_intent || "") === "unmapped_quarantine"
    && String(metadata.first_fill_state || "").toUpperCase() === "WA";
}

export function isFirstFillPage(page, queuedPageIds = new Set()) {
  if (!page || !page.id || !page.page_id || String(page.page_id).startsWith("slug:")) return false;
  if (!/^[0-9]+$/u.test(String(page.page_id))) return false;
  if (page.scan_enabled === false || page.initial_fill_completed_at) return false;
  if (!isWaFirstFillScope(page)) return false;
  // Scan state records operational progress. A failed first attempt remains
  // eligible until a complete run stamps initial_fill_completed_at.
  return !queuedPageIds.has(String(page.id));
}

export const FIRST_FILL_CAPTURE_INPUT = Object.freeze({
  country: "ALL",
  activeStatus: "active",
});

export const FIRST_FILL_QUEUE_FILTER = "&or=(payload->>scanMode.eq.initial_fill,payload->>scan_mode.eq.initial_fill,payload->>initialFill.eq.true,payload->>parent_scan_mode.eq.initial_fill)";

export function initialFillAvailableAt(page, currentTime = new Date()) {
  const now = currentTime instanceof Date ? currentTime.getTime() : Date.parse(currentTime);
  const backoff = Date.parse(String(page?.backoff_until || ""));
  if (Number.isFinite(backoff) && backoff > now) return new Date(backoff).toISOString();
  return new Date(now).toISOString();
}

export function adRadarCollectorDedupeKey(advertiserPageId) {
  return `ad-radar:collector:${advertiserPageId}`;
}
export function shouldRunAdDbJob(candidate, firstFillOnly) {
  if (!candidate) return false;
  const payload = candidate.payload || {};
  const initialFill = candidate.job_type === "blockwise-ad-collector"
    && (payload.scanMode === "initial_fill" || payload.scan_mode === "initial_fill" || payload.initialFill === true);
  const firstFillChild = candidate.job_type === "blockwise-media-collector"
    && payload.ad_db_child === true
    && payload.parent_scan_mode === "initial_fill";
  if (firstFillOnly) return initialFill || firstFillChild;
  return initialFill || firstFillChild
    || candidate.job_type === "blockwise-ad-collector"
    || (candidate.job_type === "blockwise-media-collector" && payload.ad_db_child === true);
}
