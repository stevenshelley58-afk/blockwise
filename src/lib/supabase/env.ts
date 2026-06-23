const LEADING_BOM_PREFIX = /^(?:\uFEFF|ï»¿)+/u;

export function cleanSupabaseEnv(value?: string) {
  return value?.trim().replace(LEADING_BOM_PREFIX, "").trim() ?? "";
}
