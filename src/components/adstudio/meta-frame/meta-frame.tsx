"use client";

// MetaFrame (plan §8): one entry point that wraps any child (the editor
// canvas or a finished render <img>) in the requested Meta placement, with a
// shadcn Tabs placement picker. Replaces MetaChromePreview usage in the
// workbench behind ADSTUDIO_TEMPLATES_V2 (Track B swap).

import type { ReactNode } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { FbFeedDesktopFrame } from "./fb-feed-desktop";
import { FbFeedMobileFrame } from "./fb-feed-mobile";
import type { MetaFrameCommonProps } from "./frame-bits";
import { IgFeedFrame } from "./ig-feed";
import { FbStoryFrame, IgReelsFrame, IgStoryFrame } from "./stories";

export type MetaPlacement =
  | "fb-feed-mobile"
  | "fb-feed-desktop"
  | "ig-feed"
  | "ig-story"
  | "fb-story"
  | "ig-reels";

export const META_PLACEMENTS: Array<{ id: MetaPlacement; label: string }> = [
  { id: "fb-feed-mobile", label: "FB Feed" },
  { id: "fb-feed-desktop", label: "FB Desktop" },
  { id: "ig-feed", label: "IG Feed" },
  { id: "ig-story", label: "IG Story" },
  { id: "fb-story", label: "FB Story" },
  { id: "ig-reels", label: "Reels" },
];

export function MetaFrame({
  placement,
  showPicker = false,
  onPlacementChange,
  ...common
}: MetaFrameCommonProps & {
  placement: MetaPlacement;
  showPicker?: boolean;
  onPlacementChange?: (placement: MetaPlacement) => void;
}) {
  const frame = renderPlacement(placement, common);

  if (!showPicker) return frame;

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <Tabs value={placement} onValueChange={(value) => onPlacementChange?.(value as MetaPlacement)}>
        <TabsList>
          {META_PLACEMENTS.map((option) => (
            <TabsTrigger key={option.id} value={option.id}>
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {frame}
    </div>
  );
}

function renderPlacement(placement: MetaPlacement, common: MetaFrameCommonProps): ReactNode {
  switch (placement) {
    case "fb-feed-desktop":
      return <FbFeedDesktopFrame {...common} />;
    case "ig-feed":
      return <IgFeedFrame {...common} />;
    case "ig-story":
      return <IgStoryFrame {...common} />;
    case "fb-story":
      return <FbStoryFrame {...common} />;
    case "ig-reels":
      return <IgReelsFrame {...common} />;
    case "fb-feed-mobile":
    default:
      return <FbFeedMobileFrame {...common} />;
  }
}
