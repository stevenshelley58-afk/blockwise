export function isFirstFillPage(page, queuedPageIds = new Set()) {
  if (!page || !page.id || !page.page_id || String(page.page_id).startsWith("slug:")) return false;
  if (!/^[0-9]+$/u.test(String(page.page_id))) return false;
  if (page.scan_enabled === false || page.initial_fill_completed_at) return false;
  // Scan state records operational progress. A failed first attempt remains
  // eligible until a complete run stamps initial_fill_completed_at.
  return !queuedPageIds.has(String(page.id));
}


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
