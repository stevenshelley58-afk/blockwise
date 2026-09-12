"use client";

/**
 * Context panel shell.
 *
 * One element serves every width: a full-screen sheet on a phone, a right-hand
 * overlay on a tablet, and a sticky column beside the work list on a wide
 * screen. Responsive classes do it, so the panel and its dialogs are rendered
 * exactly once and selection, filters and scroll all survive opening it.
 */

import { useEffect, useRef } from "react";
import { ArrowLeft, X } from "lucide-react";

import { Button } from "@/components/ui/button";

import { leadsCopy } from "./copy.ts";

export type ContextPanelProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string | null;
  badge?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  label: string;
};

export function ContextPanel({ open, onClose, title, subtitle, badge, children, footer, label }: ContextPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div aria-hidden onClick={onClose} className="fixed inset-0 z-30 bg-black/25 xl:hidden" />
      <div
        ref={panelRef}
        role="region"
        aria-label={label}
        tabIndex={-1}
        className="fixed inset-y-0 right-0 z-40 flex w-[min(420px,100vw)] flex-col bg-(--surface) shadow-float outline-none xl:sticky xl:top-4 xl:z-auto xl:max-h-[calc(100vh-2rem)] xl:w-full xl:rounded-(--r-panel) xl:border xl:border-(--line) xl:shadow-card"
      >
        <header className="flex items-start gap-3 border-b border-(--line) px-4 py-3.5">
          <Button
            type="button"
            variant="ghost-pill"
            size="icon-sm"
            onClick={onClose}
            aria-label={leadsCopy.actions.close}
            className="mt-0.5 shrink-0"
          >
            <ArrowLeft aria-hidden className="size-4 xl:hidden" />
            <X aria-hidden className="hidden size-4 xl:block" />
            <span className="sr-only xl:hidden">{leadsCopy.actions.back}</span>
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[15.5px] font-extrabold tracking-[-0.015em]">{title}</p>
            {subtitle ? <p className="truncate text-[12.5px] text-muted-foreground">{subtitle}</p> : null}
          </div>
          {badge}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {footer ? <div className="border-t border-(--line) px-4 py-3">{footer}</div> : null}
      </div>
    </>
  );
}
