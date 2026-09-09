export const DEFAULT_META_GRAPH_VERSION =
  // Verified by the Meta provider probe before enabling writes. Keep the
  // override for emergency provider roll-forwards, but never silently fall
  // back to an expired Graph version.
  process.env.META_GRAPH_API_VERSION ?? process.env.META_API_VERSION ?? "v26.0";
