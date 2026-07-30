export function resolveAdRadarRuntime(
  env: Record<string, string | undefined>,
  contentRunJobType: string,
  adRadarJobTypes: string[],
): {
  adRadarEnabled: boolean;
  handledJobTypes: string[];
};
