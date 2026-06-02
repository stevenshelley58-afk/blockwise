"use client";

import type { AdStudioBrandKit } from "@/lib/adstudio";

function hostOf(url: string): string {
  try {
    const host = new URL(url).host.replace(/^www\./, "");
    return host.endsWith(".example") ? "northstarrealty.com.au" : host;
  } catch {
    return "northstarrealty.com.au";
  }
}

export function useBrandKit(brandKit: AdStudioBrandKit) {
  const brand = brandKit.identity.businessName || "Northstar Realty";
  const initials = brand.charAt(0).toUpperCase();
  const domain = hostOf(brandKit.source.url);

  return { brand, initials, domain };
}
