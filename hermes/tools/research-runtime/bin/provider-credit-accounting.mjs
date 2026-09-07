export function readScrapingBeeReceipt(headers, maxCredits) {
  const raw = headers.get("spb-cost") ?? headers.get("spb-auto-cost");
  const requestId = headers.get("spb-request-id") || null;
  if (raw === null) return { chargeKnown: false, credits: null, requestId };
  const credits = Number(raw);
  return Number.isFinite(credits) && credits >= 0 && credits <= maxCredits
    ? { chargeKnown: true, credits, requestId }
    : { chargeKnown: false, credits: null, requestId, invalid: true };
}

