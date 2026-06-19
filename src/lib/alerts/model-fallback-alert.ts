/**
 * Model-fallback alerting.
 *
 * Fires when a generation stage cannot use its operator-selected primary model
 * and falls back to another candidate (or the legacy env provider). That means
 * the model the operator picked in the console is failing — usually exhausted
 * credits, a rejected key, or rate limiting — so the owner should know.
 *
 * De-duplicated by (stage + toModel) within a rolling window so a burst of
 * requests all hitting the same dead primary produces one email, not hundreds.
 * Delivery reuses sendPaidServiceAlert (email + WhatsApp), so the owner-recipient
 * resolution in notify.ts applies here too.
 */

import { sendPaidServiceAlert, type AlertMessage } from "./notify.ts";

export type ModelFallbackEvent = {
  /** Generation stage, e.g. "adstudio.copy" or "adstudio.image". */
  stage: string;
  /** The operator-selected primary model that failed. */
  fromModel: string;
  /** The model (or "env_default") we fell back to. */
  toModel: string;
  /** Short human-readable reason (an error message); never include secrets. */
  reason: string;
};

export type ModelFallbackAlertResult = {
  sent: boolean;
  deduped: boolean;
  delivery?: { email: boolean; whatsapp: boolean };
  error?: string;
};

type SendAlert = (message: AlertMessage) => Promise<{ email: boolean; whatsapp: boolean }>;

type EmitDeps = {
  send?: SendAlert;
  now?: () => number;
  dedupeWindowMs?: number;
};

const REASON_MAX = 300;
// One alert per (stage, toModel) per hour — enough to notice, not enough to spam.
const DEFAULT_DEDUPE_WINDOW_MS = 60 * 60 * 1000;

const lastSentAt = new Map<string, number>();

export function dedupeKeyForFallback(event: Pick<ModelFallbackEvent, "stage" | "toModel">): string {
  return `${event.stage}::${event.toModel}`;
}

export function buildModelFallbackAlert(event: ModelFallbackEvent): AlertMessage {
  const reason = truncate((event.reason ?? "").trim() || "unknown error", REASON_MAX);
  return {
    subject: `[Blockwise model fallback] ${event.stage}: ${event.fromModel} → ${event.toModel}`,
    text: [
      `Stage: ${event.stage}`,
      `Primary model failed: ${event.fromModel}`,
      `Now serving with: ${event.toModel}`,
      `Reason: ${reason}`,
      "",
      "The operator-selected model for this stage is failing. Check provider credits, API keys, and rate limits in the model console.",
    ].join("\n"),
  };
}

/**
 * Emits a fallback alert (best-effort, never throws). Returns what happened so
 * callers/tests can assert, but production callers can fire-and-forget with
 * `void emitModelFallbackAlert(...)`.
 */
export async function emitModelFallbackAlert(
  event: ModelFallbackEvent,
  deps: EmitDeps = {},
): Promise<ModelFallbackAlertResult> {
  const now = deps.now ?? Date.now;
  const windowMs = deps.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  const send = deps.send ?? sendPaidServiceAlert;
  const key = dedupeKeyForFallback(event);
  const current = now();

  // Drop entries past their window first, so the map only ever holds keys that
  // can still de-dupe — bounding it to the active (stage, model) set.
  pruneExpired(current, windowMs);

  const previous = lastSentAt.get(key);
  if (previous !== undefined && current - previous < windowMs) {
    return { sent: false, deduped: true };
  }
  // Record before sending so a burst of requests hitting the same dead primary
  // de-dupes immediately rather than each firing its own email.
  lastSentAt.set(key, current);

  try {
    const delivery = await send(buildModelFallbackAlert(event));
    return { sent: true, deduped: false, delivery };
  } catch (error) {
    // Delivery failed: roll back the de-dupe record so the next request retries
    // instead of the owner being silently kept in the dark for the whole window.
    // (An alert must also never break the generation it is reporting on.)
    lastSentAt.delete(key);
    return { sent: false, deduped: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function pruneExpired(current: number, windowMs: number): void {
  for (const [key, sentAt] of lastSentAt) {
    if (current - sentAt >= windowMs) lastSentAt.delete(key);
  }
}

/** Clears the de-dupe window. Test-only. */
export function resetModelFallbackAlertDedupe(): void {
  lastSentAt.clear();
}

/** Number of live de-dupe entries. Test-only (asserts the map stays bounded). */
export function modelFallbackDedupeSize(): number {
  return lastSentAt.size;
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit).trimEnd()}…` : value;
}
