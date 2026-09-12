export function isFirstFillPage(page, queuedPageIds = new Set()) {
  if (!page || !page.id || !page.page_id || String(page.page_id).startsWith("slug:")) return false;
  if (page.initial_fill_completed_at || page.scan_state !== "needs_first_fill") return false;
  return !queuedPageIds.has(String(page.id));
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
