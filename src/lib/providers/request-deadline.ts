/**
 * Bound an outbound call with a deadline, and optionally tie it to the caller's
 * own cancellation signal. Without a deadline a hung provider holds the worker
 * (or the customer request) open until an unrelated infrastructure timeout
 * fires, which is the failure this helper exists to prevent.
 */
export function requestDeadline(
  timeoutMs: number,
  parent?: AbortSignal | null,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

/**
 * Wrap a fetch implementation so every outbound call is bounded by a deadline,
 * while still honouring a signal the caller already holds. Applied only to the
 * real transport: an injected fetch (tests, alternate transports) is returned
 * untouched so callers that assert on the exact signal they passed keep seeing
 * it. A non-positive or absent budget means "no deadline", which matches a
 * disabled model candidate (maxLatencyMs 0).
 */
export function withRequestDeadline(
  fetchImpl: typeof fetch,
  timeoutMs?: number | null,
): typeof fetch {
  const deadlineMs = Number(timeoutMs);
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) return fetchImpl;
  return (input, init) =>
    fetchImpl(input, { ...init, signal: requestDeadline(deadlineMs, init?.signal) });
}
