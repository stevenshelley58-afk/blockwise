import type { NicheFeatures } from "@/config/niche/niche";

const FEATURE_ROUTES: ReadonlyArray<{ prefix: string; features: readonly (keyof NicheFeatures)[] }> = [
  { prefix: "/ad-radar", features: ["adRadar"] },
  { prefix: "/property-check", features: ["propertyCheck"] },
  { prefix: "/suburb", features: ["suburbPages"] },
  { prefix: "/audit", features: ["suburbPages"] },
  { prefix: "/operator/research", features: ["adRadar"] },
  { prefix: "/api/operator/research", features: ["adRadar"] },
  { prefix: "/api/property-checks", features: ["propertyCheck"] },
  { prefix: "/api/research/ad-radar/suggestions", features: ["adRadar"] },
  { prefix: "/api/research/ads/search", features: ["adRadar"] },
  { prefix: "/api/research/advertisers/autocomplete", features: ["adRadar"] },
  { prefix: "/api/research/locations/autocomplete", features: ["adRadar"] },
  { prefix: "/api/research/locations/guess", features: ["adRadar"] },
  { prefix: "/api/research/swipe-file", features: ["adRadar"] },
  { prefix: "/api/research/audit/lead", features: ["suburbPages"] },
  { prefix: "/api/research/audit/suggestions", features: ["suburbPages"] },
  { prefix: "/api/research/local-ad-radar", features: ["adRadar", "suburbPages"] },
];

/** Pure route-to-feature lookup shared by middleware and route tests. */
export function isFeatureRouteAvailable(pathname: string, features: NicheFeatures): boolean {
  const route = FEATURE_ROUTES.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return !route || route.features.some((feature) => features[feature]);
}
