"use client";

import { Images, Megaphone, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Toaster, toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { AD_IMAGE_MAX_BYTES, AD_IMAGE_UPLOAD_TYPES, validateAssetUploadFile } from "@/lib/upload/asset-file";
import type { LibraryAdModel, LibraryAssetModel } from "@/lib/adstudio/library-read-model";

// Inlined from deleted asset-roles.ts (Phase 1)
type AssetRole = "property" | "person" | "logo" | "background";
type MediaAsset = { src: string; fullSrc?: string; label: string; type?: string; ratio?: string; role?: string };
const ROLE_ORDER: AssetRole[] = ["property", "person", "logo", "background"];
const ROLE_META: Record<AssetRole, { label: string; plural: string }> = {
  property: { label: "Property", plural: "Property" },
  person: { label: "Person", plural: "People" },
  logo: { label: "Logo", plural: "Logos" },
  background: { label: "Background", plural: "Backgrounds" },
};
function resolveRole(asset: MediaAsset): AssetRole {
  if (asset.role && asset.role in ROLE_META) return asset.role as AssetRole;
  const hay = `${asset.label ?? ""} ${asset.type ?? ""}`.toLowerCase();
  if (/agent|headshot|portrait|profile|person|team/.test(hay)) return "person";
  if (/logo|wordmark|brandmark/.test(hay)) return "logo";
  if (/office|skyline|interior|living|backdrop|background|market view/.test(hay)) return "background";
  return "property";
}
import { uploadAdStudioMedia } from "./media-upload";

export type LibraryAsset = LibraryAssetModel;
export type LibraryAd = LibraryAdModel;

type MediaLibraryProps = {
  workspaceId: string;
  brandKitId: string;
  assets: LibraryAsset[];
  ads: LibraryAd[];
  nextAssetCursor: string | null;
  nextAdCursor: string | null;
  assetsOnly?: boolean;
};

type RoleFilter = AssetRole | "all";

function formatLabel(format: string): string {
  if (format === "9:16") return "Story";
  if (format === "4:5") return "Feed";
  if (format === "1:1") return "Square";
  return format || "Ad";
}

export function MediaLibrary({
  workspaceId,
  brandKitId,
  assets,
  ads,
  nextAssetCursor: initialAssetCursor,
  nextAdCursor: initialAdCursor,
  assetsOnly = false,
}: MediaLibraryProps) {
  const [uploaded, setUploaded] = useState<LibraryAsset[]>([]);
  const [loadedAssets, setLoadedAssets] = useState(assets);
  const [loadedAds, setLoadedAds] = useState(ads);
  const [nextAssetCursor, setNextAssetCursor] = useState(initialAssetCursor);
  const [nextAdCursor, setNextAdCursor] = useState(initialAdCursor);
  const [loadingMore, setLoadingMore] = useState<"assets" | "ads" | null>(null);
  const [filter, setFilter] = useState<RoleFilter>("all");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fresh uploads land at the front so they are visible without a reload.
  const allAssets = useMemo(() => [...uploaded, ...loadedAssets], [uploaded, loadedAssets]);

  const counts = useMemo(() => {
    const next: Record<AssetRole, number> = { property: 0, person: 0, logo: 0, background: 0 };
    for (const asset of allAssets) next[resolveRole(asset)] += 1;
    return next;
  }, [allAssets]);

  const presentRoles = ROLE_ORDER.filter((role) => counts[role] > 0);
  const visibleAssets =
    filter === "all" ? allAssets : allAssets.filter((asset) => resolveRole(asset) === filter);

  async function handleUpload(file: File | null | undefined) {
    if (!file) return;
    const validationError = validateAssetUploadFile(file, {
      acceptedTypes: AD_IMAGE_UPLOAD_TYPES,
      maxBytes: AD_IMAGE_MAX_BYTES,
      typeError: "Use a JPG, PNG, or WebP image.",
      sizeError: "Use an image under 8 MB.",
    });
    if (validationError) {
      toast.error(validationError);
      return;
    }
    if (!brandKitId) {
      toast.error("Set up your brand before uploading images.");
      return;
    }

    setUploading(true);
    try {
      const result = await uploadAdStudioMedia({ file, workspaceId, brandKitId });
      setUploaded((previous) => [
        // A fresh upload is already the durable media-proxy source.
        { id: `upload-${Date.now()}`, src: result.src, fullSrc: result.src, label: file.name, type: "uploaded_asset", role: "property" },
        ...previous,
      ]);
      toast.success("Added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload that image.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function loadMore(kind: "assets" | "ads") {
    const cursor = kind === "assets" ? nextAssetCursor : nextAdCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(kind);
    try {
      const params = new URLSearchParams({ wave: "library", kind, limit: "24", cursor });
      const response = await fetch(`/api/adstudio/bootstrap?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load more.");
      const page = (await response.json()) as {
        items: Array<LibraryAsset | LibraryAd>;
        nextCursor: string | null;
      };
      if (kind === "assets") {
        setLoadedAssets((current) => [...current, ...(page.items as LibraryAsset[])]);
        setNextAssetCursor(page.nextCursor);
      } else {
        setLoadedAds((current) => [...current, ...(page.items as LibraryAd[])]);
        setNextAdCursor(page.nextCursor);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load more.");
    } finally {
      setLoadingMore(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6">
      <Toaster richColors position="top-center" />

      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Library</h1>
        <Button type="button" disabled={uploading || !brandKitId} onClick={() => fileInputRef.current?.click()}>
          <Upload aria-hidden />
          {uploading ? "Uploading…" : "Upload"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={AD_IMAGE_UPLOAD_TYPES.join(",")}
          hidden
          aria-label="Upload image"
          onChange={(event) => void handleUpload(event.target.files?.[0])}
        />
      </header>

      <Tabs defaultValue="assets">
        <TabsList>
          <TabsTrigger value="assets">Assets ({allAssets.length})</TabsTrigger>
          {!assetsOnly ? <TabsTrigger value="ads">Ads ({loadedAds.length})</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="assets" className="mt-4">
          {presentRoles.length > 0 ? (
            <div className="mb-4 flex flex-wrap gap-2" aria-label="Filter assets by type">
              <Badge asChild variant={filter === "all" ? "default" : "outline"}>
                <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                  All {allAssets.length}
                </button>
              </Badge>
              {presentRoles.map((role) => (
                <Badge asChild key={role} variant={filter === role ? "default" : "outline"}>
                  <button type="button" aria-pressed={filter === role} onClick={() => setFilter(role)}>
                    {ROLE_META[role].plural} {counts[role]}
                  </button>
                </Badge>
              ))}
            </div>
          ) : null}

          {visibleAssets.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {visibleAssets.map((asset) => (
                <Card key={asset.id} className="gap-0 overflow-hidden py-0">
                  <div className="aspect-square w-full overflow-hidden bg-(--surface-subtle)">
                    <img
                      src={asset.src}
                      alt={asset.label}
                      width={640}
                      height={640}
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 240px"
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                    />
                  </div>
                  <div className="px-3 py-2">
                    <p className="truncate text-xs font-medium">{asset.label}</p>
                    <p className="text-[11px] text-muted-foreground">{ROLE_META[resolveRole(asset)].label}</p>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Images aria-hidden className="size-6" />} title="Upload your first image." />
          )}
          {nextAssetCursor ? (
            <div className="mt-5 flex justify-center">
              <Button type="button" variant="outline" disabled={loadingMore !== null} onClick={() => void loadMore("assets")}>
                {loadingMore === "assets" ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </TabsContent>

        {!assetsOnly ? <TabsContent value="ads" className="mt-4">
          {loadedAds.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {loadedAds.map((ad) => (
                <Link
                  key={ad.adId}
                  href={`/ad-studio/ads/${encodeURIComponent(ad.adId)}`}
                  className="rounded-(--r-card) focus-visible:outline-2 focus-visible:outline-(--accent)"
                >
                  <Card className="gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md">
                    <div className="aspect-[4/5] w-full overflow-hidden bg-(--surface-subtle)">
                      {ad.src ? <img
                        src={ad.src}
                        alt={ad.name}
                        width={640}
                        height={800}
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 240px"
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover"
                      /> : <div className="grid size-full place-items-center text-xs text-muted-foreground">Preview unavailable</div>}
                    </div>
                    <div className="px-3 py-2">
                      <p className="truncate text-xs font-semibold">{ad.name}</p>
                      <p className="text-[11px] text-muted-foreground">{formatLabel(ad.format)}</p>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Megaphone aria-hidden className="size-6" />}
              title="Your ads will appear here."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/ad-studio?newAd=1">
                    <Plus aria-hidden />
                    Create ad
                  </Link>
                </Button>
              }
            />
          )}
          {nextAdCursor ? (
            <div className="mt-5 flex justify-center">
              <Button type="button" variant="outline" disabled={loadingMore !== null} onClick={() => void loadMore("ads")}>
                {loadingMore === "ads" ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </TabsContent> : null}
      </Tabs>
    </div>
  );
}

function EmptyState({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-(--r-card) border border-dashed px-6 py-16 text-center">
      <span className="text-muted-foreground">{icon}</span>
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {action}
    </div>
  );
}
