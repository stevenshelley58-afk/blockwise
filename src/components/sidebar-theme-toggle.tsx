"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type AtlanticTheme = "dark" | "light";

const STORAGE_KEY = "bw-theme";

/**
 * `tokens` renders the control with Tailwind utilities instead of the
 * `.icon-button` class from globals.css, so the customer shell carries no
 * dependency on the legacy stylesheet. Operator and monitor keep the legacy
 * class until their own migration.
 */
export function SidebarThemeToggle({ tokens = false }: { tokens?: boolean } = {}) {
  const [theme, setTheme] = useState<AtlanticTheme>("light");

  // Sync from the attribute set by the pre-paint inline script.
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "light" || current === "dark") {
      setTheme(current);
    }
  }, []);

  function toggle() {
    const next: AtlanticTheme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  }

  const nextLabel = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      className={
        tokens
          ? "inline-grid size-10 cursor-pointer place-items-center rounded-(--r-ctl) border border-border bg-card text-muted-foreground transition-[color,border-color,background-color] duration-[var(--duration-fast)] hover:border-(--line-heavy) hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
          : "icon-button"
      }
      type="button"
      onClick={toggle}
      aria-label={nextLabel}
      title={nextLabel}
    >
      {theme === "dark" ? <Sun aria-hidden size={18} /> : <Moon aria-hidden size={18} />}
    </button>
  );
}
