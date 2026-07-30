import type { NicheFeatures } from "@/config/niche/niche";

const FEATURE_ROUTES: ReadonlyArray<{ prefix: string; feature: keyof NicheFeatures }> = [
  { prefix: "/ad-radar", feature: "adRadar" },
  { prefix: "/property-check", feature: "propertyCheck" },
  { prefix: "/suburb", feature: "suburbPages" },
  { prefix: "/audit", feature: "suburbPages" },
  { prefix: "/hero-lab", feature: "suburbPages" },
  { prefix: "/operator/research", feature: "adRadar" },
];

/** Pure route-to-feature lookup shared by middleware and route tests. */
export function isFeatureRouteAvailable(pathname: string, features: NicheFeatures): boolean {
  const route = FEATURE_ROUTES.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return !route || features[route.feature];
}
