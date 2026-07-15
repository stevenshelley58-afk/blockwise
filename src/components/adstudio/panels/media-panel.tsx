"use client";

import { Check, Image as ImageIcon, Images, Megaphone, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AssetUploadDropzone } from "@/components/asset-upload-dropzone";
import { AD_IMAGE_MAX_BYTES, AD_IMAGE_UPLOAD_TYPES } from "@/lib/upload/asset-file";

import { PanelHeader } from "../inspector";
import { MEDIA_ASSETS, type AssetRole } from "../use-media";

/** Loosely-typed asset so the panel accepts both demo assets (role-tagged) and
 *  live workspace/brand-kit assets (which carry no explicit role yet). */
type MediaAsset = {
  src: string;
  label: string;
  type?: string;
  ratio?: string;
  role?: string;
};

type GeneratedAd = {
  creativeId: string;
  src: string;
  label: string;
  formatLabel: string;
};

type MediaPanelProps = {
  primaryImage: string;
  primaryImageName?: string;
  mediaAssets?: MediaAsset[];
  generatedAds?: GeneratedAd[];
  activeGeneratedAdId?: string;
  onUploadImage: (file: File) => void | Promise<void>;
  onUploadRejected: (message: string) => void;
  selectedImageSrc?: string;
  replacing?: boolean;
  onSelectImage: (src: string) => void;
  onClearSelection: () => void;
  onConfirmReplace: () => void | Promise<void>;
  onSelectGeneratedAd?: (creativeId: string) => void;
};

type RoleFilter = AssetRole | "all";
type LibraryView = "assets" | "ads";

const ROLE_ORDER: AssetRole[] = ["property", "person", "logo", "background"];

const ROLE_META: Record<AssetRole, { label: string; plural: string }> = {
  property: { label: "Property", plural: "Property" },
  person: { label: "Person", plural: "People" },
  logo: { label: "Logo", plural: "Logos" },
  background: { label: "Background", plural: "Backgrounds" },
};

/** Resolve a display role from an explicit tag, falling back to label/type cues
 *  so live workspace assets (agent headshots, office shots, logos) still group. */
function resolveRole(asset: MediaAsset): AssetRole {
  if (asset.role && asset.role in ROLE_META) return asset.role as AssetRole;
  const hay = `${asset.label ?? ""} ${asset.type ?? ""}`.toLowerCase();
  if (/agent|headshot|portrait|profile|person|team/.test(hay)) return "person";
  if (/logo|wordmark|brandmark/.test(hay)) return "logo";
  if (/office|skyline|interior|living|backdrop|background|market view/.test(hay)) return "background";
  return "property";
}

export function MediaPanel({
  primaryImage,
  primaryImageName,
  mediaAssets = MEDIA_ASSETS,
  generatedAds = [],
  activeGeneratedAdId,
  onUploadImage,
  onUploadRejected,
  selectedImageSrc,
  replacing = false,
  onSelectImage,
  onClearSelection,
  onConfirmReplace,
  onSelectGeneratedAd,
}: MediaPanelProps) {
  const [libraryView, setLibraryView] = useState<LibraryView>("assets");
  const [filter, setFilter] = useState<RoleFilter>("all");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmRef = useRef<HTMLElement>(null);
  const confirmTriggerRef = useRef<HTMLButtonElement>(null);

  function closeConfirmation() {
    if (replacing) return;
    setConfirmOpen(false);
    window.setTimeout(() => confirmTriggerRef.current?.focus(), 0);
  }

  const selectedAsset = mediaAssets.find((asset) => asset.src === primaryImage);
  const currentLabel = selectedAsset?.label ?? primaryImageName ?? "Uploaded image";
  const replacementAsset = mediaAssets.find((asset) => asset.src === selectedImageSrc);

  useEffect(() => {
    if (!selectedImageSrc) setConfirmOpen(false);
  }, [selectedImageSrc]);

  useEffect(() => {
    if (!confirmOpen) return;
    const dialog = confirmRef.current;
    window.setTimeout(() => dialog?.focus(), 0);
    function handleKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !replacing) {
        event.preventDefault();
        closeConfirmation();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = dialog.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [confirmOpen, replacing]);

  const counts = useMemo(() => {
    const next: Record<AssetRole, number> = { property: 0, person: 0, logo: 0, background: 0 };
    for (const asset of mediaAssets) next[resolveRole(asset)] += 1;
    return next;
  }, [mediaAssets]);

  const visibleAssets =
    filter === "all" ? mediaAssets : mediaAssets.filter((asset) => resolveRole(asset) === filter);

  const presentRoles = ROLE_ORDER.filter((role) => counts[role] > 0);

  function selectLibraryView(nextView: LibraryView) {
    setLibraryView(nextView);
    if (nextView === "ads") onClearSelection();
  }

  return (
    <>
      <PanelHeader title="Library" detail="Use your uploaded assets or open an ad you have generated." />

      <div className="studio-current-media" aria-label="Current image">
        <img src={primaryImage} alt="" />
        <span>
          <strong>Current image</strong>
          <small>{currentLabel}</small>
        </span>
        <small className="studio-current-media-state">In ad</small>
      </div>

      <div className="studio-library-tabs" role="tablist" aria-label="Library content">
        <button
          id="studio-library-assets-tab"
          type="button"
          role="tab"
          aria-controls="studio-library-assets-panel"
          aria-selected={libraryView === "assets"}
          className={libraryView === "assets" ? "active" : ""}
          onClick={() => selectLibraryView("assets")}
        >
          <Images aria-hidden size={16} />
          Assets <span>{mediaAssets.length}</span>
        </button>
        <button
          id="studio-library-ads-tab"
          type="button"
          role="tab"
          aria-controls="studio-library-ads-panel"
          aria-selected={libraryView === "ads"}
          className={libraryView === "ads" ? "active" : ""}
          onClick={() => selectLibraryView("ads")}
        >
          <Megaphone aria-hidden size={16} />
          Ads <span>{generatedAds.length}</span>
        </button>
      </div>

      {libraryView === "assets" ? (
        <section id="studio-library-assets-panel" role="tabpanel" aria-labelledby="studio-library-assets-tab" className="studio-library-panel">
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
        </section>
      ) : (
        <section id="studio-library-ads-panel" role="tabpanel" aria-labelledby="studio-library-ads-tab" className="studio-library-panel">
          {generatedAds.length > 0 ? (
            <div className="studio-media-grid studio-generated-ad-grid">
              {generatedAds.map((ad) => {
                const active = ad.creativeId === activeGeneratedAdId;
                return (
                  <button
                    className={active ? "active" : ""}
                    key={ad.creativeId}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelectGeneratedAd?.(ad.creativeId)}
                  >
                    <img src={ad.src} alt="" />
                    <span>{ad.label}</span>
                    <small>{active ? `${ad.formatLabel} / open` : `${ad.formatLabel} / generated ad`}</small>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="studio-library-empty">
              <Megaphone aria-hidden size={22} />
              <strong>No generated ads yet</strong>
              <p>Ads will appear here after you generate them from a template.</p>
            </div>
          )}
        </section>
      )}

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
          <button ref={confirmTriggerRef} className="studio-btn accent" type="button" onClick={() => setConfirmOpen(true)}>
            Replace image
          </button>
        </section>
      ) : null}

      {confirmOpen && replacementAsset ? (
        <div
          className="studio-media-confirm-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeConfirmation();
          }}
        >
          <section ref={confirmRef} className="studio-media-confirm" role="dialog" aria-modal="true" aria-labelledby="studio-media-confirm-title" tabIndex={-1}>
            <div className="studio-media-confirm-icon"><ImageIcon aria-hidden size={20} /></div>
            <div>
              <h3 id="studio-media-confirm-title">Generate a new ad with this image?</h3>
              <p>Blockwise will replace the photo in your current ad and keep its text, layout, colours and logos unchanged.</p>
            </div>
            <div className="studio-media-confirm-preview">
              <span><small>Current</small><img src={primaryImage} alt="Current image" /></span>
              <span><small>Replacement</small><img src={replacementAsset.src} alt="Selected replacement" /></span>
            </div>
            <div className="studio-media-confirm-actions">
              <button className="studio-btn secondary" type="button" disabled={replacing} onClick={closeConfirmation}>Cancel</button>
              <button className="studio-btn accent" type="button" disabled={replacing} onClick={() => void onConfirmReplace()}>
                {replacing ? "Generating new ad" : "Generate new ad"}
                {!replacing ? <Check aria-hidden size={16} /> : null}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
