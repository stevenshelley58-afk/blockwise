import { getMetaMonitorData } from "./getMetaMonitorData.ts";
import { buildSampleMetaMonitorPayload } from "./sampleMetaMonitorData.ts";
import type { MetaMonitorPayload } from "./types.ts";

/**
 * Results payload with an empty-state guard. A connected workspace whose
 * selected range contains no ads at all (a brand-new or empty account) shows
 * the clearly labelled sample preview instead of an ugly empty dashboard.
 * Any real delivery — however small — renders live: hiding a genuine account
 * behind demo data is worse than showing modest numbers.
 */
export async function getResultsPayload(
  input: Parameters<typeof getMetaMonitorData>[0],
): Promise<MetaMonitorPayload> {
  const payload = await getMetaMonitorData(input);

  if (payload.source === "live" && payload.connected && payload.summary != null && payload.ads.length === 0) {
    return buildSampleMetaMonitorPayload({ range: input.range, customRange: input.customRange, now: input.now, connected: true });
  }

  return payload;
}
