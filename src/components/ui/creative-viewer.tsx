"use client";

import { ChevronLeft, ChevronRight, Volume2, VolumeX, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Fullscreen creative viewer.
 *
 * One overlay shared by Ad Radar results and the Ad Studio template gallery.
 * It fills the viewport, fits the creative inside it with no cropping, and
 * never scrolls the page: the stage is a flex child with min-h-0 and the whole
 * surface is position:fixed with overscroll containment. Radix supplies the
 * portal, focus trap, body scroll lock and focus restoration.
 */

export type CreativeViewerItem = {
  id: string;
  media: { kind: "image" | "video"; url: string; posterUrl?: string | null } | null;
  title: string;
  subtitle?: string | null;
  body?: string | null;
  footnote?: string | null;
};

export type CreativeViewerAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
};

const SWIPE_THRESHOLD_PX = 48;

export function CreativeViewer({
  open,
  onOpenChange,
  items,
  index,
  onIndexChange,
  primaryAction,
  secondaryAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CreativeViewerItem[];
  index: number;
  onIndexChange: (index: number) => void;
  primaryAction?: CreativeViewerAction;
  secondaryAction?: CreativeViewerAction;
}) {
  const item = items[index];
  const [muted, setMuted] = useState(true);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const pushedHistory = useRef(false);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next > items.length - 1) return;
      onIndexChange(next);
    },
    [items.length, onIndexChange],
  );

  // Android hardware back dismisses the viewer instead of leaving the page.
  useEffect(() => {
    if (!open) return;

    window.history.pushState({ creativeViewer: true }, "");
    pushedHistory.current = true;

    function onPopState() {
      pushedHistory.current = false;
      onOpenChange(false);
    }

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (pushedHistory.current) {
        pushedHistory.current = false;
        window.history.back();
      }
    };
  }, [open, onOpenChange]);

  // Reset audio state between openings so a muted default always holds.
  useEffect(() => {
    if (!open) setMuted(true);
  }, [open]);

  if (!item) return null;

  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-(--ink)/92 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          data-slot="creative-viewer"
          aria-describedby={undefined}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              goTo(index - 1);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              goTo(index + 1);
            }
          }}
          className="fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col overflow-hidden overscroll-contain bg-transparent text-white outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
        >
          <DialogPrimitive.Title className="sr-only">{item.title}</DialogPrimitive.Title>

          <header className="flex shrink-0 items-center gap-3 px-3.5 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3">
            <DialogPrimitive.Close
              className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-white/12 text-white transition-colors duration-150 hover:bg-white/20"
              aria-label="Close"
            >
              <X size={18} aria-hidden />
            </DialogPrimitive.Close>

            <div className="grid min-w-0 flex-1">
              <strong className="truncate text-[13.5px] font-extrabold">{item.title}</strong>
              {item.subtitle ? (
                <span className="truncate text-[11.5px] text-white/60">{item.subtitle}</span>
              ) : null}
            </div>

            {items.length > 1 ? (
              <span className="shrink-0 font-mono text-[10.5px] tracking-[0.1em] text-white/55 tabular-nums">
                {index + 1} / {items.length}
              </span>
            ) : null}
          </header>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-3.5"
            onTouchStart={(event) => {
              const touch = event.touches[0];
              touchStart.current = { x: touch.clientX, y: touch.clientY };
            }}
            onTouchEnd={(event) => {
              const start = touchStart.current;
              touchStart.current = null;
              if (!start) return;
              const touch = event.changedTouches[0];
              const dx = touch.clientX - start.x;
              const dy = touch.clientY - start.y;

              if (Math.abs(dy) > Math.abs(dx) && dy > SWIPE_THRESHOLD_PX) {
                onOpenChange(false);
                return;
              }
              if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
              goTo(dx < 0 ? index + 1 : index - 1);
            }}
          >
            <Stage item={item} muted={muted} />

            {hasPrev ? (
              <PageButton side="left" onClick={() => goTo(index - 1)} />
            ) : null}
            {hasNext ? <PageButton side="right" onClick={() => goTo(index + 1)} /> : null}

            {item.media?.kind === "video" ? (
              <button
                type="button"
                onClick={() => setMuted((current) => !current)}
                aria-label={muted ? "Unmute video" : "Mute video"}
                className="absolute right-5 bottom-3 grid size-9 cursor-pointer place-items-center rounded-full bg-(--ink)/70 text-white transition-colors duration-150 hover:bg-(--ink)/85"
              >
                {muted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}
              </button>
            ) : null}
          </div>

          {item.body || item.footnote ? (
            <div className="shrink-0 px-3.5 pt-2.5">
              {item.body ? (
                <p className="line-clamp-3 text-[12.5px] leading-[1.5] whitespace-pre-wrap text-white/80">
                  {item.body}
                </p>
              ) : null}
              {item.footnote ? (
                <p className="mt-1 truncate text-[11px] text-white/50">{item.footnote}</p>
              ) : null}
            </div>
          ) : null}

          {primaryAction || secondaryAction ? (
            <div className="flex shrink-0 gap-2.5 px-3.5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              {secondaryAction ? <ActionButton action={secondaryAction} tone="secondary" /> : null}
              {primaryAction ? <ActionButton action={primaryAction} tone="primary" /> : null}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Stage({ item, muted }: { item: CreativeViewerItem; muted: boolean }) {
  const stageClass = "max-h-full max-w-full rounded-(--r-card) object-contain";

  if (!item.media) {
    return (
      <div className="grid max-h-full w-full max-w-sm place-items-center rounded-(--r-card) border border-white/15 px-6 py-16 text-center text-[12.5px] font-bold text-white/60">
        Text-only ad
      </div>
    );
  }

  if (item.media.kind === "video") {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        key={item.id}
        className={stageClass}
        src={item.media.url}
        poster={item.media.posterUrl ?? undefined}
        autoPlay
        loop
        muted={muted}
        playsInline
        preload="none"
      />
    );
  }

  return (
    // Meta CDN URLs are short-lived signed links; next/image would break them.
    // eslint-disable-next-line @next/next/no-img-element
    <img key={item.id} className={stageClass} src={item.media.url} alt={item.title} />
  );
}

function PageButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous" : "Next"}
      className={`absolute top-1/2 hidden size-9 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/12 text-white transition-colors duration-150 hover:bg-white/20 sm:grid ${
        side === "left" ? "left-2" : "right-2"
      }`}
    >
      {side === "left" ? <ChevronLeft size={18} aria-hidden /> : <ChevronRight size={18} aria-hidden />}
    </button>
  );
}

function ActionButton({ action, tone }: { action: CreativeViewerAction; tone: "primary" | "secondary" }) {
  const className = `inline-flex h-11 flex-1 cursor-pointer items-center justify-center rounded-full px-4 text-[13.5px] font-extrabold transition-opacity duration-150 hover:opacity-90 disabled:cursor-default disabled:opacity-50 ${
    tone === "primary" ? "bg-white text-(--ink)" : "bg-white/14 text-white"
  }`;

  if (action.href) {
    return (
      <a className={className} href={action.href} target="_blank" rel="noreferrer">
        {action.label}
      </a>
    );
  }

  return (
    <button type="button" className={className} onClick={action.onClick} disabled={action.disabled}>
      {action.label}
    </button>
  );
}
