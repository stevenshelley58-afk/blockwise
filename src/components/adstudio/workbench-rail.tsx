"use client";

import {
  Check,
  ChevronDown,
  CircleAlert,
  Image as ImageIcon,
  LayoutGrid,
  Send,
  Settings2,
  ShieldCheck,
  Target,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import type { ReadinessItem } from "@/lib/adstudio/readiness";

import type { MobileTab, StudioSection } from "./use-ad-studio";

type NavItem = { id: StudioSection; label: string; icon: LucideIcon };

// B3 (simplification): three top-level destinations. Media and Copy open as
// contextual inspectors when the matching layer is selected on the canvas (or
// via the variant strip actions); Templates and Settings sit behind Advanced.
const NAV_ITEMS: NavItem[] = [
  { id: "campaign", label: "Ad", icon: Target },
  { id: "brand", label: "Brand", icon: ShieldCheck },
  { id: "publish", label: "Publish", icon: Send },
];

const ADVANCED_NAV_ITEMS: NavItem[] = [
  { id: "templates", label: "Templates", icon: LayoutGrid },
  { id: "settings", label: "Settings", icon: Settings2 },
];

export const MOBILE_NAV: Array<{ id: MobileTab; label: string; icon: LucideIcon }> = [
  { id: "campaign", label: "Ad", icon: Target },
  { id: "media", label: "Media", icon: ImageIcon },
  { id: "copy", label: "Copy", icon: Type },
  { id: "publish", label: "Publish", icon: Send },
];

type WorkbenchRailProps = {
  section: StudioSection;
  setSection: (section: StudioSection) => void;
  brandApproved: boolean;
  readinessItems: ReadinessItem[];
  onOpenTemplates: () => void;
};

export function WorkbenchRail({ section, setSection, brandApproved, readinessItems, onOpenTemplates }: WorkbenchRailProps) {
  const [advancedNavOpen, setAdvancedNavOpen] = useState(false);

  return (
    <aside className="studio-rail" aria-label="Ad Studio sections">
      <span className="studio-rail-label">Create</span>
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;

        // M6: derive dot state per section from readiness items.
        // Media/Copy readiness ("Primary media", "Ad copy", "Call to action")
        // rolls up into the Publish dot, which covers all items.
        let railState: "done" | "warn" | "todo" | null = null;
        if (item.id === "brand") {
          railState = brandApproved ? "done" : "warn";
        } else if (item.id === "publish") {
          const allDone = readinessItems.every((ri) => ri.state === "done");
          railState = allDone ? "done" : readinessItems.some((ri) => ri.state === "warn") ? "warn" : "todo";
        } else if (item.id === "campaign") {
          const labels = ["Goal & offer", "Location", "Property type"];
          const relevant = readinessItems.filter((ri) => labels.includes(ri.label));
          if (relevant.length > 0) {
            if (relevant.every((ri) => ri.state === "done")) railState = "done";
            else if (relevant.some((ri) => ri.state === "warn")) railState = "warn";
            else railState = "todo";
          }
        }

        return (
          <button
            className={section === item.id ? "active" : ""}
            key={item.id}
            type="button"
            onClick={() => setSection(item.id)}
          >
            <Icon aria-hidden size={18} />
            <span>{item.label}</span>
            {railState === "done" && <Check aria-hidden size={13} style={{ color: "#006d38", marginLeft: "auto", flexShrink: 0 }} />}
            {railState === "warn" && <CircleAlert aria-hidden size={13} style={{ color: "#8a5a00", marginLeft: "auto", flexShrink: 0 }} />}
            {railState === "todo" && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#dfe6f0", marginLeft: "auto", flexShrink: 0 }} />}
          </button>
        );
      })}

      <button
        type="button"
        aria-expanded={advancedNavOpen}
        onClick={() => setAdvancedNavOpen((open) => !open)}
      >
        <ChevronDown
          aria-hidden
          size={18}
          style={{ transform: advancedNavOpen ? "rotate(180deg)" : undefined, transition: "transform .15s" }}
        />
        <span>Advanced</span>
      </button>
      {advancedNavOpen &&
        ADVANCED_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={section === item.id ? "active" : ""}
              key={item.id}
              type="button"
              onClick={() => (item.id === "templates" ? onOpenTemplates() : setSection(item.id))}
            >
              <Icon aria-hidden size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
    </aside>
  );
}
