import { Images, LayoutTemplate, Palette } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export type StudioSection = "create" | "ads" | "assets" | "brand" | "templates" | "library";

export const STUDIO_ITEMS = [
  { key: "create" as const, href: "/ad-studio", label: "Create", icon: LayoutTemplate },
  { key: "ads" as const, href: "/ad-studio/library?tab=ads", label: "Ads", icon: Images },
  { key: "assets" as const, href: "/ad-studio/library?tab=assets", label: "Assets", icon: Images },
  { key: "brand" as const, href: "/ad-studio/brand", label: "Brand Pack", icon: Palette },
];

export function StudioNavigation({ active, mobile = false }: { active: StudioSection; mobile?: boolean }) {
  const current = active === "templates" ? "create" : active === "library" ? "ads" : active;
  return (
    <nav
      aria-label="Ad Studio"
      className={cn(
        mobile
          ? "grid grid-cols-4 gap-1 border-t border-white/10 bg-(--ink) px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
          : "grid gap-1",
      )}
    >
      {STUDIO_ITEMS.map(({ key, href, label, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={current === key ? "page" : undefined}
          className={cn(
            "inline-flex min-h-11 items-center gap-3 rounded-(--r-control) px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
            mobile ? "min-w-0 justify-center gap-1.5 px-1 text-[11px] text-white/65" : "text-white/65 hover:bg-white/10 hover:text-white",
            current === key ? "bg-white text-(--ink)" : "",
          )}
        >
          <Icon aria-hidden className="size-4 shrink-0" />
          <span className="truncate">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
