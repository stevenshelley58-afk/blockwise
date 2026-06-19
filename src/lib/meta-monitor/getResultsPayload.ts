import { getMetaMonitorData } from "./getMetaMonitorData.ts";
import { buildSampleMetaMonitorPayload } from "./sampleMetaMonitorData.ts";
import type { MetaMonitorPayload } from "./types.ts";

/**
 * Results payload with an empty-state guard. A connected workspace that has no
 * meaningful delivery yet (a new, empty, or test account) shows the clearly
 * labelled sample preview instead of an ugly empty dashboard — real numbers
 * take over automatically the moment ads start delivering. Disconnected
 * workspaces already get the sample preview from getMetaMonitorData itself.
 */
export async function getResultsPayload(
  input: Parameters<typeof getMetaMonitorData>[0],
): Promise<MetaMonitorPayload> {
  const payload = await getMetaMonitorData(input);
  const summary = payload.summary;

  const hasNoMeaningfulDelivery =
    payload.ads.length === 0 || (summary != null && summary.leads === 0 && summary.spend < 20);

  if (payload.source === "live" && payload.connected && summary != null && hasNoMeaningfulDelivery) {
    return buildSampleMetaMonitorPayload({ range: input.range, now: input.now, connected: true });
  }

  return payload;
}
