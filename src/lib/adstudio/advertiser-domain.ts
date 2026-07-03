import type { AdStudioBrandKit, AdStudioPlatformCopyPack } from "./types.ts";

export const ADVERTISER_DOMAIN_PLACEHOLDER = "yourdomain.com.au";
export const ADVERTISER_URL_PLACEHOLDER = `https://${ADVERTISER_DOMAIN_PLACEHOLDER}`;

export type AdvertiserDomainResolution = {
  host: string;
  baseUrl: string;
  isPlaceholder: boolean;
  setupNudge: string | null;
};

type ResolveAdvertiserDomainInput = {
  brandKit: AdStudioBrandKit;
  finalUrls?: Array<string | null | undefined>;
  copyPacks?: Pick<AdStudioPlatformCopyPack, "googleSearch" | "googlePmax" | "googleDemandGen">[];
};

export function resolveAdvertiserDomain(input: ResolveAdvertiserDomainInput): AdvertiserDomainResolution {
  const parsed = advertiserUrlCandidates(input).map(parseAdvertiserUrl).find((candidate) => candidate !== null);

  if (parsed) {
    return {
      host: displayHost(parsed),
      baseUrl: parsed.origin,
      isPlaceholder: false,
      setupNudge: null,
    };
  }

  return {
    host: ADVERTISER_DOMAIN_PLACEHOLDER,
    baseUrl: ADVERTISER_URL_PLACEHOLDER,
    isPlaceholder: true,
    setupNudge: "Add your website in Publish to show the real advertiser domain.",
  };
}

export function resolveAdvertiserBaseUrl(brandKit: AdStudioBrandKit): string {
  return resolveAdvertiserDomain({ brandKit }).baseUrl;
}

export function resolveLeadFormPrivacyPolicyUrl(brandKit: AdStudioBrandKit): string {
  const directPrivacyUrl = parseAdvertiserUrl(brandKit.compliance.privacyPolicyUrl);

  if (directPrivacyUrl) {
    return directPrivacyUrl.href.replace(/\/$/, "");
  }

  return appendAdvertiserPath(resolveAdvertiserBaseUrl(brandKit), "privacy");
}

export function appendAdvertiserPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function advertiserUrlCandidates(input: ResolveAdvertiserDomainInput): Array<string | null | undefined> {
  const copyPackFinalUrls =
    input.copyPacks?.flatMap((copyPack) => [
      copyPack.googleSearch.finalUrl,
      copyPack.googlePmax.finalUrl,
      copyPack.googleDemandGen.finalUrl,
    ]) ?? [];

  return [
    ...(input.finalUrls ?? []),
    ...copyPackFinalUrls,
    input.brandKit.compliance.privacyPolicyUrl,
    input.brandKit.compliance.termsUrl,
    ...input.brandKit.contact.socialLinks,
    input.brandKit.source.url,
  ];
}

function parseAdvertiserUrl(value: string | null | undefined): URL | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  if (/^(mailto|tel|sms):/i.test(trimmed)) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    if (!/^https?:$/i.test(url.protocol)) {
      return null;
    }

    const host = displayHost(url);
    if (!host || isDisallowedAdvertiserHost(host)) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function displayHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function isDisallowedAdvertiserHost(host: string): boolean {
  return (
    host === "blockwise.sale" ||
    host.endsWith(".blockwise.sale") ||
    host === "example.com" ||
    host.endsWith(".example")
  );
}
