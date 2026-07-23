/**
 * outcome.mjs — MetaCaptureOutcome builder.
 *
 * The CLI prints exactly one of these as a single JSON object on stdout. The
 * Hermes supervisor parses stdout and depends on:
 *   - provider "hermes_browser", costUsd 0, rawDatasetId null
 *   - metadata.confirmed_absence === true ONLY for a clean, unchallenged load
 *     with zero results (the trusted-zero path)
 *   - metadata.pages_loaded / metadata.scrolls for diagnostics
 */

export const OUTCOME_STATUS = Object.freeze({
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  TIMED_OUT: "TIMED_OUT",
});

/**
 * @param {object} args
 * @param {string} args.runId
 * @param {string} args.startedAt ISO timestamp captured before the crawl
 * @param {"SUCCEEDED"|"FAILED"|"TIMED_OUT"} args.status
 * @param {object[]} args.items MetaAdLibraryAd[]
 * @param {string|null} [args.errorMessage]
 * @param {Record<string, unknown>} [args.metadata]
 */
export function buildOutcome({ runId, startedAt, status, items, errorMessage = null, metadata = {} }) {
  const safeItems = Array.isArray(items) ? items : [];
  return {
    runId,
    provider: "hermes_browser",
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    costUsd: 0,
    itemCount: safeItems.length,
    items: safeItems,
    rawDatasetId: null,
    errorMessage: errorMessage ?? null,
    metadata: {
      confirmed_absence: false,
      pages_loaded: 0,
      scrolls: 0,
      ...metadata,
    },
  };
}
