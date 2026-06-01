"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type SidebarTheme = "dark" | "light";

const STORAGE_KEY = "bw-sidebar";

export function SidebarThemeToggle() {
  const [theme, setTheme] = useState<SidebarTheme>("dark");

  // Sync from the attribute set by the pre-paint inline script.
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-sidebar-theme");
    if (current === "light" || current === "dark") {
      setTheme(current);
    }
  }, []);

  function toggle() {
    const next: SidebarTheme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-sidebar-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  }

  const nextLabel = theme === "dark" ? "Switch to light sidebar" : "Switch to dark sidebar";

  return (
    <button className="icon-button" type="button" onClick={toggle} aria-label={nextLabel} title={nextLabel}>
      {theme === "dark" ? <Sun aria-hidden size={18} /> : <Moon aria-hidden size={18} />}
    </button>
  );
}
