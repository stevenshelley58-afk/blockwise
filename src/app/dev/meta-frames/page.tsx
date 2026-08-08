import type { Metadata } from "next";

import { MetaFrame, type MetaPlacement } from "@/components/adstudio/meta-frame/meta-frame";
import { SafeZoneOverlay } from "@/components/adstudio/meta-frame/safe-zone-overlay";
import { buildAdStudioFallbackBrandKit } from "@/lib/adstudio/trial-brand-kit";

// Dev-only visual harness for the Meta placement frames (Track B).
export const metadata: Metadata = { title: "Meta frames harness", robots: "noindex" };

const LONG_COPY =
  "Fresh family homes hitting the Scarborough market this month — walk to the beach, dual living, and a studio the kids will fight over. Book a private appraisal before the spring rush.";

const COPY = {
  primaryText: LONG_COPY,
  headline: "Free appraisal this month in Scarborough",
  description: "Local agents, real comparables, no obligation",
  cta: "Get quote",
};

export default async function MetaFramesHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") {
    return <p>Not available in production.</p>;
  }
  const params = await searchParams;
  const placement = (params.placement ?? "fb-feed-mobile") as MetaPlacement;
  const brandKit = buildAdStudioFallbackBrandKit({ workspaceId: "harness", workspaceName: "Harness Realty" });
  const vertical = placement === "ig-story" || placement === "fb-story" || placement === "ig-reels";

  return (
    <main className="tw min-h-screen bg-[#0f1216] p-6 text-white">
      <h1 className="mb-4 text-lg font-bold">Meta frames harness — {placement}</h1>
      <div className="flex flex-wrap gap-2 text-sm">
        {(["fb-feed-mobile", "fb-feed-desktop", "ig-feed", "ig-story", "fb-story", "ig-reels"] as MetaPlacement[]).map((option) => (
          <a
            key={option}
            href={`/dev/meta-frames?placement=${option}`}
            className={
              option === placement
                ? "rounded-md bg-white px-3 py-1.5 font-semibold text-black"
                : "rounded-md bg-white/10 px-3 py-1.5 hover:bg-white/20"
            }
          >
            {option}
          </a>
        ))}
      </div>
      <div className="mt-6 flex justify-center">
        <div className="relative">
          <MetaFrame brandKit={brandKit} copy={COPY} placement={placement}>
            <div
              className={
                vertical
                  ? "flex h-full w-full items-center justify-center bg-gradient-to-b from-[#31537c] to-[#1d2f47] text-white/70"
                  : "flex aspect-[4/5] w-full items-center justify-center bg-gradient-to-b from-[#7d8db1] to-[#31537c] text-white/70"
              }
            >
              creative render
            </div>
          </MetaFrame>
          {vertical ? <SafeZoneOverlay surface={placement === "ig-reels" ? "reels" : "story"} /> : null}
        </div>
      </div>
    </main>
  );
}
