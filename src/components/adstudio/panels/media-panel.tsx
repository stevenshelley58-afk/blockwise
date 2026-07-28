"use client";

import { Check, Image as ImageIcon, Images, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AssetUploadDropzone } from "@/components/asset-upload-dropzone";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AD_IMAGE_MAX_BYTES, AD_IMAGE_UPLOAD_TYPES } from "@/lib/upload/asset-file";

import { MEDIA_ASSETS } from "../use-media";
import { ROLE_META, ROLE_ORDER, resolveRole, type AssetRole, type MediaAsset } from "../asset-roles";

type MediaPanelProps = {
  primaryImage: string;
  primaryImageName?: string;
  mediaAssets?: MediaAsset[];
  onUploadImage: (file: File) => void | Promise<void>;
  onUploadRejected: (message: string) => void;
  selectedImageSrc?: string;
  replacing?: boolean;
  onSelectImage: (src: string) => void;
  onClearSelection: () => void;
  onConfirmReplace: () => void | Promise<void>;
  hasMoreAssets?: boolean;
  loadingMoreAssets?: boolean;
  onLoadMoreAssets?: () => void | Promise<void>;
};

type RoleFilter = AssetRole | "all";

export function MediaPanel({
  primaryImage,
  primaryImageName,
  mediaAssets = MEDIA_ASSETS,
  onUploadImage,
  onUploadRejected,
  selectedImageSrc,
  replacing = false,
  onSelectImage,
  onClearSelection,
  onConfirmReplace,
  hasMoreAssets = false,
  loadingMoreAssets = false,
  onLoadMoreAssets,
}: MediaPanelProps) {
  const [filter, setFilter] = useState<RoleFilter>("all");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const selectedAsset = mediaAssets.find((asset) => asset.src === primaryImage);
  const currentLabel = selectedAsset?.label ?? primaryImageName ?? "Uploaded image";
  const replacementAsset = mediaAssets.find((asset) => asset.src === selectedImageSrc);

  useEffect(() => {
    if (!selectedImageSrc) setConfirmOpen(false);
  }, [selectedImageSrc]);

  const counts = useMemo(() => {
    const next: Record<AssetRole, number> = { property: 0, person: 0, logo: 0, background: 0 };
    for (const asset of mediaAssets) next[resolveRole(asset)] += 1;
    return next;
  }, [mediaAssets]);

  const visibleAssets =
    filter === "all" ? mediaAssets : mediaAssets.filter((asset) => resolveRole(asset) === filter);

  const presentRoles = ROLE_ORDER.filter((role) => counts[role] > 0);

  return (
    <>
      <div className="studio-current-media" aria-label="Current image">
        <img src={primaryImage} alt="" />
        <span>
          <strong>Current image</strong>
          <small>{currentLabel}</small>
        </span>
        <small className="studio-current-media-state">In ad</small>
      </div>

      <AssetUploadDropzone
        className="studio-media-upload"
        label="Upload image"
        actionText="Upload image"
        helperText="PNG, JPG or WebP / up to 8 MB"
        acceptedTypes={AD_IMAGE_UPLOAD_TYPES}
        maxBytes={AD_IMAGE_MAX_BYTES}
        typeError="Use a JPG, PNG, or WebP image."
        sizeError="Use an image under 8 MB."
        capturePagePaste
        onFileAccepted={onUploadImage}
        onFileRejected={onUploadRejected}
      />

      {presentRoles.length > 0 ? (
        <div className="studio-library-filters" aria-label="Filter assets by type">
          <button type="button" aria-pressed={filter === "all"} className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
            All <span>{mediaAssets.length}</span>
          </button>
          {presentRoles.map((role) => (
            <button key={role} type="button" aria-pressed={filter === role} className={filter === role ? "active" : ""} onClick={() => setFilter(role)}>
              {ROLE_META[role].plural} <span>{counts[role]}</span>
            </button>
          ))}
        </div>
      ) : null}

      {visibleAssets.length > 0 ? (
        <div className="studio-media-grid">
          {visibleAssets.map((asset) => {
            const role = resolveRole(asset);
            const inUse = primaryImage === asset.src;
            return (
              <button
                className={`${inUse ? "active" : ""}${selectedImageSrc === asset.src ? " selected" : ""}`}
                key={asset.src}
                type="button"
                aria-pressed={selectedImageSrc === asset.src}
                onClick={() => inUse ? onClearSelection() : onSelectImage(asset.src)}
              >
                <span className="studio-media-role" aria-hidden>{ROLE_META[role].label}</span>
                <img src={asset.src} alt="" />
                <span>{asset.label}</span>
                <small>{inUse ? "Primary / in use" : `${asset.type ?? "Image"} / ${asset.ratio ?? "Image"}`}</small>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="studio-library-empty">
          <Images aria-hidden size={22} />
          <strong>No assets yet</strong>
          <p>Upload a property photo, headshot or logo to use it in an ad.</p>
        </div>
      )}

      {hasMoreAssets && onLoadMoreAssets ? (
        <Button
          className="w-full"
          variant="outline"
          type="button"
          disabled={loadingMoreAssets}
          onClick={() => void onLoadMoreAssets()}
        >
          {loadingMoreAssets ? "Loading…" : "Load more images"}
        </Button>
      ) : null}

      {replacementAsset ? (
        <section className="studio-media-replacement" aria-label="Selected replacement image">
          <img src={replacementAsset.src} alt="" />
          <span>
            <small>Selected replacement</small>
            <strong>{replacementAsset.label}</strong>
          </span>
          <button className="studio-media-selection-clear" type="button" onClick={onClearSelection} aria-label="Clear selected replacement">
            <X aria-hidden size={16} />
          </button>
          <Button type="button" onClick={() => setConfirmOpen(true)}>
            Replace image
          </Button>
        </section>
      ) : null}

      <Dialog
        open={confirmOpen && Boolean(replacementAsset)}
        onOpenChange={(open) => {
          if (replacing) return;
          setConfirmOpen(open);
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImageIcon aria-hidden className="size-5 text-muted-foreground" />
              Generate a new ad with this image?
            </DialogTitle>
            <DialogDescription>
              Blockwise will replace the photo in your current ad and keep its text, layout, colours and logos unchanged.
            </DialogDescription>
          </DialogHeader>
          {replacementAsset ? (
            <div className="studio-media-confirm-preview">
              <span><small>Current</small><img src={primaryImage} alt="Current image" /></span>
              <span><small>Replacement</small><img src={replacementAsset.src} alt="Selected replacement" /></span>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" type="button" disabled={replacing} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={replacing} onClick={() => void onConfirmReplace()}>
              {replacing ? "Generating new ad" : "Generate new ad"}
              {!replacing ? <Check aria-hidden /> : null}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
