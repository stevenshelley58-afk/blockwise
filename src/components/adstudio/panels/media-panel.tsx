"use client";

import { Check, Image as ImageIcon, X } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

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
  onUploadImage: (file: File) => void | Promise<void>;
  onUploadRejected: (message: string) => void;
  selectedImageSrc?: string;
  replacing?: boolean;
  onSelectImage: (src: string) => void;
  onClearSelection: () => void;
  onConfirmReplace: () => void | Promise<void>;
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
  onUploadImage,
  onUploadRejected,
  selectedImageSrc,
  replacing = false,
  onSelectImage,
  onClearSelection,
  onConfirmReplace,
}: MediaPanelProps) {
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
              className={`${inUse ? "active" : ""}${selectedImageSrc === asset.src ? " selected" : ""}`}
              key={asset.src}
              type="button"
              style={{ position: "relative" }}
              aria-pressed={selectedImageSrc === asset.src}
              onClick={() => inUse ? onClearSelection() : onSelectImage(asset.src)}
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
