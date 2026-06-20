"use client";

import { type CSSProperties, useMemo, useState } from "react";

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

type MediaPanelProps = {
  primaryImage: string;
  primaryImageName?: string;
  mediaAssets?: MediaAsset[];
  openFilePicker: () => void;
  onUploadImage: (file: File) => void | Promise<void>;
  onUploadRejected: (message: string) => void;
  onSelectImage?: (src: string) => void;
  onGenerateBackground?: () => void;
  generatingBackground?: boolean;
  onRepairCurrent?: () => void;
  onRepairAll?: () => void;
  repairingImage?: boolean;
};

type RoleFilter = AssetRole | "all";

const ROLE_ORDER: AssetRole[] = ["property", "person", "logo", "background"];

const ROLE_META: Record<AssetRole, { label: string; plural: string; color: string }> = {
  property: { label: "Property", plural: "Property", color: "#123e75" },
  person: { label: "Person", plural: "People", color: "#006d38" },
  logo: { label: "Logo", plural: "Logos", color: "#8a5a00" },
  background: { label: "Background", plural: "Backgrounds", color: "#475569" },
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
  openFilePicker,
  onUploadImage,
  onUploadRejected,
  onSelectImage,
  onGenerateBackground,
  generatingBackground = false,
  onRepairCurrent,
  onRepairAll,
  repairingImage = false,
}: MediaPanelProps) {
  const [filter, setFilter] = useState<RoleFilter>("all");

  const selectedAsset = mediaAssets.find((asset) => asset.src === primaryImage);
  const currentLabel = selectedAsset?.label ?? primaryImageName ?? "Uploaded image";

  const counts = useMemo(() => {
    const next: Record<AssetRole, number> = { property: 0, person: 0, logo: 0, background: 0 };
    for (const asset of mediaAssets) next[resolveRole(asset)] += 1;
    return next;
  }, [mediaAssets]);

  const visibleAssets =
    filter === "all" ? mediaAssets : mediaAssets.filter((asset) => resolveRole(asset) === filter);

  const presentRoles = ROLE_ORDER.filter((role) => counts[role] > 0);

  const subheadStyle: CSSProperties = {
    margin: "18px 0 9px",
    fontSize: 11,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#94a3b8",
    fontWeight: 700,
  };
  const filterRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 };
  const chipStyle = (on: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: `1px solid ${on ? "#123e75" : "#dfe6f0"}`,
    background: on ? "#123e75" : "#fff",
    color: on ? "#fff" : "#475569",
    fontSize: 12,
    fontWeight: 600,
    padding: "5px 11px",
    borderRadius: 9999,
    cursor: "pointer",
  });
  const chipCountStyle = (on: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 700,
    color: on ? "rgba(255,255,255,0.85)" : "#94a3b8",
  });

  return (
    <>
      <PanelHeader title="Media library" detail="Upload, organise and reuse your photos. Each one is tagged by what it is — property, person or logo." />

      <div className="studio-current-media" aria-label="Current image">
        <img src={primaryImage} alt="" />
        <span>
          <strong>Current image</strong>
          <small>{currentLabel}</small>
        </span>
        <button type="button" onClick={openFilePicker}>
          Replace
        </button>
      </div>

      <AssetUploadDropzone
        className="studio-media-upload"
        label="Upload image"
        actionText="Upload image"
        helperText="PNG, JPG or WebP / up to 8 MB"
        previewUrl={primaryImage}
        previewAlt=""
        fileName={currentLabel}
        fileType={selectedAsset?.type ?? "Uploaded image"}
        acceptedTypes={AD_IMAGE_UPLOAD_TYPES}
        maxBytes={AD_IMAGE_MAX_BYTES}
        typeError="Use a JPG, PNG, or WebP image."
        sizeError="Use an image under 8 MB."
        capturePagePaste
        onFileAccepted={onUploadImage}
        onFileRejected={onUploadRejected}
      />

      {(onGenerateBackground || onRepairCurrent || onRepairAll) && (
        <div aria-label="Adjust the selected photo">
          <p style={subheadStyle}>Adjust the selected photo</p>
          {onRepairAll && (
            <button className="studio-btn accent block" type="button" disabled={repairingImage} onClick={onRepairAll}>
              {repairingImage ? "Fitting photo..." : "Auto fit all ad sizes"}
            </button>
          )}
          {onRepairCurrent && (
            <button className="studio-btn secondary block" type="button" disabled={repairingImage} onClick={onRepairCurrent}>
              Auto fit current size
            </button>
          )}
          {onGenerateBackground && (
            <button className="studio-btn secondary block" type="button" disabled={generatingBackground} onClick={onGenerateBackground}>
              {generatingBackground ? "Generating background..." : "Generate background"}
            </button>
          )}
        </div>
      )}

      <p style={subheadStyle}>Your library</p>
      {presentRoles.length > 0 && (
        <div style={filterRowStyle} role="tablist" aria-label="Filter assets by type">
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            style={chipStyle(filter === "all")}
            onClick={() => setFilter("all")}
          >
            All <span style={chipCountStyle(filter === "all")}>{mediaAssets.length}</span>
          </button>
          {presentRoles.map((role) => (
            <button
              key={role}
              type="button"
              role="tab"
              aria-selected={filter === role}
              style={chipStyle(filter === role)}
              onClick={() => setFilter(role)}
            >
              {ROLE_META[role].plural} <span style={chipCountStyle(filter === role)}>{counts[role]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="studio-media-grid">
        {visibleAssets.map((asset) => {
          const role = resolveRole(asset);
          const inUse = primaryImage === asset.src;
          return (
            <button
              className={inUse ? "active" : ""}
              key={asset.src}
              type="button"
              style={{ position: "relative" }}
              onClick={() => onSelectImage?.(asset.src)}
            >
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: 7,
                  left: 7,
                  zIndex: 2,
                  fontSize: 10,
                  fontWeight: 700,
                  lineHeight: 1,
                  letterSpacing: "0.01em",
                  color: "#fff",
                  background: ROLE_META[role].color,
                  padding: "3px 7px",
                  borderRadius: 9999,
                }}
              >
                {ROLE_META[role].label}
              </span>
              <img src={asset.src} alt="" />
              <span>{asset.label}</span>
              <small>{inUse ? "Primary / in use" : `${asset.type ?? "Image"} / ${asset.ratio ?? "Image"}`}</small>
            </button>
          );
        })}
      </div>
    </>
  );
}
