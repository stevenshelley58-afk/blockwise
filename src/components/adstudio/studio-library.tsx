"use client";

import { Image, LibraryBig, Megaphone, RefreshCw } from "lucide-react";
import { useState } from "react";

import { AdsLibrary } from "@/components/adstudio/ads-library";
import { MediaLibrary } from "@/components/adstudio/media-library";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LibraryAdModel, LibraryAssetModel } from "@/lib/adstudio/library-read-model";

type StudioLibraryProps = {
  initialView?: "ads" | "assets";
  workspaceId: string;
  brandKitId: string;
  ads: LibraryAdModel[];
  assets: LibraryAssetModel[];
  nextAssetCursor: string | null;
  adsError?: boolean;
  assetsError?: boolean;
};

/** The durable entry point for saved creatives and reusable customer media. */
export function StudioLibrary({
  initialView = "ads",
  workspaceId,
  brandKitId,
  ads,
  assets,
  nextAssetCursor,
  adsError = false,
  assetsError = false,
}: StudioLibraryProps) {
  const [tab, setTab] = useState<"ads" | "assets">(initialView);

  function changeTab(value: string) {
    const next = value === "assets" ? "assets" : "ads";
    setTab(next);
    window.history.replaceState(null, "", `/ad-studio/library?view=${next}`);
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pb-28 pt-8 md:px-6 md:pb-16 md:pt-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[27px] font-extrabold tracking-[-.02em]">Library</h1>
          <p className="mt-2 max-w-[62ch] text-sm leading-6 text-muted-foreground">
            Find a saved ad to continue, or choose media to make the next one yours.
          </p>
        </div>
        <p className="hidden items-center gap-2 rounded-full border border-(--line) bg-(--surface) px-3 py-2 text-xs text-muted-foreground sm:flex">
          <LibraryBig className="size-4" aria-hidden />
          One workspace, one source of truth
        </p>
      </header>

      <Tabs value={tab} onValueChange={changeTab} className="mt-7">
        <TabsList aria-label="Library sections" variant="line" className="w-full justify-start gap-2 overflow-x-auto border-b border-(--line) rounded-none p-0">
          <TabsTrigger value="ads" className="min-h-11 gap-2 rounded-none px-3 text-xs sm:px-4 sm:text-sm">
            <Megaphone className="size-4" aria-hidden />
            Ads
            <span className="rounded-full bg-(--surface-subtle) px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{ads.length}</span>
          </TabsTrigger>
          <TabsTrigger value="assets" className="min-h-11 gap-2 rounded-none px-3 text-xs sm:px-4 sm:text-sm">
            <Image className="size-4" aria-hidden />
            Assets
            <span className="rounded-full bg-(--surface-subtle) px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{assets.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ads" forceMount className="mt-6 data-[state=inactive]:hidden">
          {adsError ? <LibraryReadError label="saved ads" /> : <AdsLibrary ads={ads} embedded />}
        </TabsContent>
        <TabsContent value="assets" forceMount className="mt-6 data-[state=inactive]:hidden">
          {assetsError ? <LibraryReadError label="workspace media" /> : <MediaLibrary workspaceId={workspaceId} brandKitId={brandKitId} assets={assets} nextAssetCursor={nextAssetCursor} embedded />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LibraryReadError({ label }: { label: string }) {
  return (
    <div className="rounded-(--r-panel) border border-(--ui-error)/25 bg-(--ui-error-soft) p-6" role="alert">
      <div className="flex items-start gap-3">
        <RefreshCw className="mt-0.5 size-5 shrink-0 text-(--ui-error)" aria-hidden />
        <div>
          <h2 className="font-display text-[15.5px] font-extrabold">Couldn’t load {label}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Refresh the page to try again. Your other Library section is still available.</p>
          <Button type="button" variant="outline" size="pill" className="mt-4" onClick={() => window.location.reload()}>Refresh Library</Button>
        </div>
      </div>
    </div>
  );
}
