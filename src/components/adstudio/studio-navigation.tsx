import { Images, LayoutTemplate, Palette } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export type StudioSection = "templates" | "library" | "brand";

const ITEMS = [
  { key: "templates" as const, href: "/ad-studio", label: "Templates", icon: LayoutTemplate },
  { key: "library" as const, href: "/ad-studio/library", label: "Library", icon: Images },
  { key: "brand" as const, href: "/ad-studio/brand", label: "Brand Pack", icon: Palette },
];

export function StudioNavigation({ active }: { active: StudioSection }) {
  return (
    <nav aria-label="Ad Studio" className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-border bg-muted/55 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {ITEMS.map(({ key, href, label, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={active === key ? "page" : undefined}
          className={cn(
            "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active === key
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
          )}
        >
          <Icon aria-hidden className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
