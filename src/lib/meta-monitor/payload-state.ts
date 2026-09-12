import type { MetaMonitorPayload } from "./types.ts";

/**
 * True when the payload is the demo fixture because the workspace has no Meta
 * connection at all. A connected account whose selected range holds no ads also
 * carries sample data, but it is marked `connected`, so the two states never
 * blur: only the disconnected one is a connect decision.
 */
export function hasNoMetaConnection(payload: MetaMonitorPayload): boolean {
  return payload.source === "sample" && !payload.connected;
}
