/** Normalise customer Ad Radar query punctuation before sending it to Ad DB. */
export function normaliseAdRadarCardSearchQuery(value: string): string {
  return value.replace(/[(),]/g, "").trim();
}
