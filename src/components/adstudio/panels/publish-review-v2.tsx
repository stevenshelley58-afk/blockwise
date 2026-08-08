"use client";

// §9.3 review additions for v2 creatives: both placements inside their real
// Meta frames, the exact payload preview ("What will be sent"), and the
// on-demand "Check against Meta's preview" action. Rendered only when the
// campaign carries v2 instance-doc creatives; the legacy chrome above it is
// untouched. No new global CSS — Tailwind in the .tw scope.

import { useState } from "react";

import { MetaFrame } from "@/components/adstudio/meta-frame/meta-frame";
import { labelForMetaCta } from "@/lib/adstudio/meta-cta.ts";
import { isAdDocInstanceShape, type AdDocInstance } from "@/lib/adstudio/v2/template-doc";
import { META_CREATIVE_FEATURE_KEYS } from "@/lib/adstudio/v2/creative-features.ts";
import type { AdStudioCampaignPack } from "@/lib/adstudio/types.ts";

const PREVIEW_FORMATS = [
  "MOBILE_FEED_STANDARD",
  "DESKTOP_FEED_STANDARD",
  "INSTAGRAM_STANDARD",
  "INSTAGRAM_STORY",
  "FACEBOOK_STORY_MOBILE",
  "INSTAGRAM_REELS",
  "RIGHT_COLUMN_STANDARD",
] as const;

export function v2CreativeInstances(pack: AdStudioCampaignPack): AdDocInstance[] {
  return pack.creatives
    .filter((creative) => isAdDocInstanceShape(creative.canvas as unknown))
    .map((creative) => creative.canvas as unknown as AdDocInstance);
}

function copyFromMeta(meta: AdStudioCampaignPack["copyPacks"][number]["meta"] | undefined) {
  return {
    primaryText: meta?.primaryText?.[0] ?? "",
    headline: meta?.headlines?.[0] ?? "",
    description: meta?.descriptions?.[0] ?? "",
    cta: labelForMetaCta(meta?.cta ?? "LEARN_MORE"),
  };
}

/** Both placements inside their real frames (Creatives step, §9.3). */
export function V2RenderFrames({ pack, brandKit }: { pack: AdStudioCampaignPack; brandKit: AdStudioCampaignPack["brandKit"] }) {
  const instances = v2CreativeInstances(pack);
  if (instances.length === 0) return null;
  const feed = instances.find((instance) => instance.format === "4:5") ?? instances[0];
  const story = instances.find((instance) => instance.format === "9:16");
  const renders = feed.renders ?? {};
  const meta = pack.copyPacks[0]?.meta;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <small className="text-xs font-semibold text-(--muted)">Feed · 4:5</small>
        {renders.feed ? (
          <MetaFrame brandKit={brandKit} copy={copyFromMeta(meta)} placement="fb-feed-mobile">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/adstudio/media?path=${encodeURIComponent(renders.feed)}`} alt="Rendered feed ad" className="aspect-[4/5] w-full object-cover" />
          </MetaFrame>
        ) : (
          <p className="text-xs text-(--muted)">Feed render pending.</p>
        )}
      </div>
      {story && renders.story ? (
        <div>
          <small className="text-xs font-semibold text-(--muted)">Story · 9:16</small>
          <MetaFrame brandKit={brandKit} copy={copyFromMeta(meta)} placement="ig-story">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/adstudio/media?path=${encodeURIComponent(renders.story)}`} alt="Rendered story ad" className="h-full w-full object-cover" />
          </MetaFrame>
        </div>
      ) : null}
    </div>
  );
}

export function PublishReviewV2({ pack, brandKit }: { pack: AdStudioCampaignPack; brandKit: AdStudioCampaignPack["brandKit"] }) {
  const instances = v2CreativeInstances(pack);
  const [previewFormat, setPreviewFormat] = useState<(typeof PREVIEW_FORMATS)[number]>("MOBILE_FEED_STANDARD");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  if (instances.length === 0) return null;

  const feed = instances.find((instance) => instance.format === "4:5") ?? instances[0];
  const meta = pack.copyPacks[0]?.meta;
  const renders = feed.renders ?? {};

  const checkAgainstMeta = async () => {
    setChecking(true);
    setPreviewError(null);
    setPreviewHtml(null);
    try {
      const response = await fetch("/api/adstudio/meta-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          adFormat: previewFormat,
          creative: {
            object_story_spec: {
              link_data: {
                message: meta?.primaryText?.[0] ?? "",
                name: meta?.headlines?.[0] ?? "",
                description: meta?.descriptions?.[0] ?? "",
                ...(meta?.cta ? { call_to_action: { type: meta.cta } } : {}),
              },
            },
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { html?: string; error?: string };
      if (!response.ok || !payload.html) {
        setPreviewError(payload.error ?? "Meta could not build that preview right now.");
        return;
      }
      setPreviewHtml(payload.html);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="mb-2 text-sm font-bold">How your ad appears on Meta</h2>
        <V2RenderFrames pack={pack} brandKit={brandKit} />
      </div>

      <details className="rounded-(--r-card) border border-(--line) p-3">
        <summary className="cursor-pointer text-sm font-bold">What will be sent to Meta</summary>
        <dl className="mt-2 grid gap-1 text-xs">
          <div><dt className="font-semibold">Primary text</dt><dd>{meta?.primaryText?.join(" · ")}</dd></div>
          <div><dt className="font-semibold">Headline</dt><dd>{meta?.headlines?.join(" · ")}</dd></div>
          <div><dt className="font-semibold">Description</dt><dd>{meta?.descriptions?.join(" · ")}</dd></div>
          <div><dt className="font-semibold">CTA</dt><dd>{labelForMetaCta(meta?.cta ?? "LEARN_MORE")} ({meta?.cta})</dd></div>
          <div><dt className="font-semibold">Lead form</dt><dd>{meta?.leadForm?.headline} — {meta?.leadForm?.questions?.length ?? 0} custom questions</dd></div>
          <div>
            <dt className="font-semibold">Images</dt>
            <dd>
              feed: {renders.feed ? "rendered 1080×1350" : "pending"}
              {renders.story ? " · story: rendered 1080×1920 (asset_feed_spec placement routing)" : ""}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Placements</dt>
            <dd>{meta ? "publisher platforms facebook+instagram as configured" : ""}</dd>
          </div>
          <div>
            <dt className="font-semibold">Advantage+ enhancements</dt>
            <dd>
              {META_CREATIVE_FEATURE_KEYS.length} features explicitly OPT_OUT — what you preview is what Meta renders
            </dd>
          </div>
        </dl>
      </details>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-(--r-card) border border-(--line) bg-(--surface) px-2 py-1.5 text-xs font-semibold"
            value={previewFormat}
            onChange={(event) => setPreviewFormat(event.target.value as (typeof PREVIEW_FORMATS)[number])}
            aria-label="Meta preview format"
          >
            {PREVIEW_FORMATS.map((format) => (
              <option key={format} value={format}>{format.replaceAll("_", " ").toLowerCase()}</option>
            ))}
          </select>
          <button className="studio-btn secondary" type="button" onClick={checkAgainstMeta} disabled={checking}>
            {checking ? "Asking Meta…" : "Check against Meta's preview"}
          </button>
        </div>
        {previewError ? <p className="text-xs text-(--danger,#e5484d)">{previewError}</p> : null}
        {previewHtml ? (
          <div
            className="overflow-hidden rounded-(--r-card) border border-(--line)"
            // Meta's generatepreviews returns the iframe HTML directly; it is
            // fetched on demand through the workspace's own connection.
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : null}
      </div>
    </div>
  );
}
