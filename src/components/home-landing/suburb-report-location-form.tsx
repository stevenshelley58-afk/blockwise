"use client";

import { track } from "@vercel/analytics";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdRadarLocationForm } from "@/components/research/ad-radar-location-form";
import { trackCtaClick } from "@/lib/analytics/pixel";
import type { AdRadarSearchSuggestion } from "@/lib/research/ad-radar-search-suggestions";

type SuburbReportLocationFormProps = {
  analyticsLocation: string;
  mobile?: boolean;
};

export function SuburbReportLocationForm({ analyticsLocation, mobile = false }: SuburbReportLocationFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSearch(searchTerm: string) {
    setError(null);
    setIsSubmitting(true);
    try {
      const resolved = await resolveLocation(searchTerm);
      if (!resolved) {
        setError("Choose a suburb or postcode from the suggestions.");
        return;
      }

      const params = new URLSearchParams({ scan: "1" });
      if (resolved.suburb) params.set("s", slugify(resolved.suburb));
      const href = `/suburb/${resolved.postcode}?${params.toString()}`;
      trackCtaClick(analyticsLocation, { href, postcode: resolved.postcode });
      fireSafe("suburb_scan_started", { postcode: resolved.postcode });
      router.push(href);
    } catch {
      setError("We could not confirm that location. Try the postcode instead.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={mobile ? "hwm-report-search" : "hw-report-search"}>
      <AdRadarLocationForm
        buttonLabel="Show me the ads →"
        initialNote=""
        initialValue=""
        inputLabel="Suburb or postcode"
        isSubmitting={isSubmitting}
        onEmptySearch={() => setError("Enter a suburb or postcode first.")}
        onSearch={(value) => void handleSearch(value)}
        placeholder="Suburb or postcode"
        surface="landing"
        useBestGuess
        useBestGuessAsPlaceholder
      />
      <p className="hw-report-search-note">Free report. No email, no sign-up.</p>
      {error ? <p className="hw-report-search-error" role="alert">{error}</p> : null}
    </div>
  );
}

async function resolveLocation(searchTerm: string): Promise<{ postcode: string; suburb: string | null } | null> {
  const direct = parseLocation(searchTerm);
  if (direct) return direct;

  const response = await fetch(`/api/research/ad-radar/suggestions?q=${encodeURIComponent(searchTerm)}`);
  if (!response.ok) return null;
  const payload = await response.json() as { suggestions?: AdRadarSearchSuggestion[] };
  const location = payload.suggestions?.find((suggestion) => suggestion.kind === "location");
  return location ? parseLocation(`${location.mainText} ${location.secondaryText} ${location.searchTerm}`) : null;
}

function parseLocation(value: string): { postcode: string; suburb: string | null } | null {
  const postcode = value.match(/\b([0-9]{4})\b/)?.[1];
  if (!postcode) return null;
  const beforePostcode = value.slice(0, value.indexOf(postcode)).replace(/,?\s*(WA|Western Australia)\s*$/i, "").trim();
  const suburb = beforePostcode.split(",")[0]?.trim() || null;
  return { postcode, suburb };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function fireSafe(event: string, properties: Record<string, string>) {
  try { track(event, properties); } catch { /* analytics is best effort */ }
}
