/** Pure Ad Radar queue selection. No database or provider calls. */
const DAY_MS = 24 * 60 * 60 * 1000;

export function chunkIds(ids, size = 50) {
  if (!Number.isInteger(size) || size < 1 || size > 50) throw new Error("chunk size must be an integer from 1 to 50");
  const unique = [...new Set((ids || []).filter(Boolean))];
  return Array.from({ length: Math.ceil(unique.length / size) }, (_, index) => unique.slice(index * size, (index + 1) * size));
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function enabledStatus(page) {
  return page?.scan_enabled !== false && ["resolved_collectable", "no_ads_confirmed"].includes(page?.status);
}

function firstFill(page) {
  return page?.scan_state === "needs_first_fill" || !page?.initial_fill_completed_at;
}

export function selectDueAdRadarPages(pages, scope = {}, now = new Date(), limit = 3, activePageIds = new Set()) {
  const instant = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(instant)) throw new Error("now must be a valid date");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  const active = activePageIds instanceof Set ? activePageIds : new Set(activePageIds || []);
  const interested = (page) => Boolean(scope.isInterested?.(page));
  const waOwned = (page) => Boolean(scope.isWaOwned?.(page));
  const candidates = (pages || []).filter((page) => {
    if (page?.scan_enabled === false || !page?.id || !/^\d+$/u.test(String(page.page_id || "")) || active.has(page.id)) return false;
    const customer = interested(page);
    if (!customer && !enabledStatus(page)) return false;
    if (!customer && !waOwned(page)) return false;
    const backoff = timestamp(page.backoff_until);
    if (backoff !== null && backoff > instant) return false;
    const dueAt = timestamp(page.next_scan_at);
    if (dueAt === null || dueAt <= instant) return true;
    const completedAt = timestamp(page.last_scan_completed_at);
    return customer && (completedAt === null || instant - completedAt >= DAY_MS);
  }).sort((left, right) => {
    const interestDelta = Number(interested(right)) - Number(interested(left));
    if (interestDelta) return interestDelta;
    const firstFillDelta = Number(firstFill(right)) - Number(firstFill(left));
    if (firstFillDelta) return firstFillDelta;
    return (timestamp(left.next_scan_at) || 0) - (timestamp(right.next_scan_at) || 0);
  });
  if (limit < 2) return candidates.slice(0, limit);
  const customer = candidates.find(interested);
  const fill = candidates.find((page) => firstFill(page) && !interested(page));
  if (!customer || !fill || customer.id === fill.id) return candidates.slice(0, limit);
  return [customer, fill, ...candidates.filter((page) => page.id !== customer.id && page.id !== fill.id)].slice(0, limit);
}
