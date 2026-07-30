export function resolveAdRadarRuntime(env, contentRunJobType, adRadarJobTypes) {
  const adRadarEnabled = env.HERMES_AD_RADAR_ENABLED === "true";

  return {
    adRadarEnabled,
    handledJobTypes: adRadarEnabled
      ? [...adRadarJobTypes, contentRunJobType]
      : [contentRunJobType],
  };
}
