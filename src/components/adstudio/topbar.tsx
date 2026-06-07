"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Archive, Cloud, Copy, MoreHorizontal, Share2, Trash2 } from "lucide-react";

import { BlockwiseLogo } from "@/components/blockwise-logo";

type TopBarProps = {
  campaignId?: string;
  campaignName: string;
  showMore: boolean;
  setShowMore: (value: boolean | ((prev: boolean) => boolean)) => void;
  onSave: () => void;
  onDelete?: () => void;
  showToast?: (message: string) => void;
};

export function TopBar({
  campaignId = "",
  campaignName,
  showMore,
  setShowMore,
  onSave,
  onDelete,
  showToast = () => {},
}: TopBarProps) {
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!showMore) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setShowMore(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [showMore, setShowMore]);

  async function handleDuplicate() {
    setShowMore(false);
    try {
      const res = await fetch(`/api/adstudio/campaigns/${campaignId}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      showToast("Ad duplicated");
    } catch {
      showToast("Could not duplicate campaign");
    }
  }

  function handleSaveFromMenu() {
    setShowMore(false);
    onSave();
  }

  async function handleShare() {
    setShowMore(false);
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Link copied to clipboard");
    } catch {
      showToast("Could not copy link");
    }
  }

  async function handleArchive() {
    setShowMore(false);
    try {
      const res = await fetch(`/api/adstudio/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      if (!res.ok) throw new Error("Failed");
      showToast("Ad archived");
    } catch {
      showToast("Could not archive campaign");
    }
  }

  return (
    <header className="studio-topbar">
      <div className="studio-titlebar">
        <Link className="studio-home-link" href="/home" aria-label="Go to Blockwise home">
          <BlockwiseLogo />
        </Link>
        <span className="studio-divider" />
        <span className="studio-breadcrumb">Ad Studio / {campaignName}</span>
      </div>
      <div className="studio-mobile-title">
        <Link className="studio-home-link" href="/home" aria-label="Go to Blockwise home">
          <BlockwiseLogo />
        </Link>
        <span className="studio-divider" />
        <strong>Ad Studio</strong>
      </div>
      <div className="studio-actions">
        <button className="studio-btn secondary" type="button" onClick={onSave}>
          <Cloud aria-hidden size={17} />
          Save
        </button>
        <button
          className="studio-icon-btn"
          type="button"
          aria-label="More actions"
          aria-expanded={showMore}
          aria-haspopup="menu"
          onClick={() => setShowMore((value) => !value)}
        >
          <MoreHorizontal aria-hidden size={20} />
        </button>
      </div>

      {showMore && (
        <div className="studio-more-menu" ref={menuRef} role="menu" aria-label="Ad actions">
          <button className="studio-mobile-menu-save" type="button" role="menuitem" onClick={handleSaveFromMenu}>
            <Cloud aria-hidden size={16} />
            Save draft
          </button>
          <button type="button" role="menuitem" onClick={handleDuplicate}>
            <Copy aria-hidden size={16} />
            Duplicate campaign
          </button>
          <button type="button" role="menuitem" onClick={handleShare}>
            <Share2 aria-hidden size={16} />
            Copy link
          </button>
          <span className="studio-menu-line" />
          <button type="button" role="menuitem" onClick={handleArchive}>
            <Archive aria-hidden size={16} />
            Archive campaign
          </button>
          <button
            className="danger"
            type="button"
            role="menuitem"
            onClick={() => {
              setShowMore(false);
              onDelete?.();
            }}
          >
            <Trash2 aria-hidden size={16} />
            Delete campaign
          </button>
        </div>
      )}
    </header>
  );
}
