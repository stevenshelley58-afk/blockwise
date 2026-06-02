"use client";

import { useEffect, useRef } from "react";
import {
  Archive,
  BadgeCheck,
  ChevronRight,
  Cloud,
  Copy,
  Download,
  MoreHorizontal,
  Send,
  Share2,
  Trash2,
} from "lucide-react";

import { BlockwiseLogo } from "@/components/blockwise-logo";

type TopBarProps = {
  campaignId?: string;
  campaignName: string;
  showMore: boolean;
  setShowMore: (value: boolean | ((prev: boolean) => boolean)) => void;
  /** @deprecated H7: removed from top bar — preview is accessible via the main canvas */
  onPreview?: () => void;
  onSave: () => void;
  onPublish: () => void;
  onExport: () => void;
  showToast?: (message: string) => void;
};

export function TopBar({ campaignId = "", campaignName, showMore, setShowMore, onSave, onPublish, onExport, showToast = () => {} }: TopBarProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // C2: close on outside click
  useEffect(() => {
    if (!showMore) return;
    function handleClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMore(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMore, setShowMore]);

  // C2: close on Escape
  useEffect(() => {
    if (!showMore) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setShowMore(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [showMore, setShowMore]);

  // H9: duplicate campaign
  async function handleDuplicate() {
    setShowMore(false);
    try {
      const res = await fetch(`/api/adstudio/campaigns/${campaignId}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      showToast("Campaign duplicated");
    } catch {
      showToast("Could not duplicate campaign");
    }
  }

  // H9: archive campaign
  async function handleArchive() {
    setShowMore(false);
    try {
      const res = await fetch(`/api/adstudio/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      if (!res.ok) throw new Error("Failed");
      showToast("Campaign archived");
    } catch {
      showToast("Could not archive campaign");
    }
  }

  return (
    <header className="studio-topbar">
      <div className="studio-titlebar">
        <BlockwiseLogo />
        <span className="studio-divider" />
        {/* L2: removed misleading <ChevronDown> from breadcrumb */}
        <span className="studio-breadcrumb">Ad Studio / {campaignName}</span>
      </div>
      <div className="studio-mobile-title">
        <BlockwiseLogo />
        <span className="studio-divider" />
        <strong>Ad Studio</strong>
      </div>
      <div className="studio-actions">
        {/* H7: Preview button removed — preview is accessible via the main canvas */}
        <button className="studio-btn secondary" type="button" onClick={onSave}>
          <Cloud aria-hidden size={17} />
          Save
        </button>
        <button className="studio-btn publish" type="button" onClick={onPublish}>
          <Send aria-hidden size={17} />
          Publish
        </button>
        <button className="studio-icon-btn" type="button" aria-label="More actions" onClick={() => setShowMore((value) => !value)}>
          <MoreHorizontal aria-hidden size={20} />
        </button>
      </div>

      {showMore && (
        <div className="studio-more-menu" ref={menuRef}>
          {/* H9: Duplicate — wired to POST /api/adstudio/campaigns/{id}/duplicate */}
          <button type="button" onClick={handleDuplicate}>
            <Copy aria-hidden size={16} />
            Duplicate campaign
          </button>
          <button type="button" onClick={() => { setShowMore(false); onExport(); }}>
            <Download aria-hidden size={16} />
            Export creatives
            <ChevronRight aria-hidden size={15} />
          </button>
          {/* Wave 2 owns Share and Send for approval */}
          <button type="button">
            <Share2 aria-hidden size={16} />
            Share for review
          </button>
          <button type="button">
            <BadgeCheck aria-hidden size={16} />
            Send for approval
          </button>
          <span className="studio-menu-line" />
          {/* H9: Archive — wired to PATCH /api/adstudio/campaigns/{id} */}
          <button type="button" onClick={handleArchive}>
            <Archive aria-hidden size={16} />
            Archive campaign
          </button>
          {/* Wave 2 owns Delete */}
          <button className="danger" type="button">
            <Trash2 aria-hidden size={16} />
            Delete campaign
          </button>
        </div>
      )}
    </header>
  );
}
