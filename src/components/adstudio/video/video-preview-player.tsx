"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import type { VideoScene } from "@/lib/adstudio/video/types";

export function VideoPreviewPlayer({ scenes, renderUrl, posterUrl }: { scenes: VideoScene[]; renderUrl?: string | null; posterUrl?: string | null }) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const scene = scenes[sceneIndex] ?? scenes[0];

  useEffect(() => {
    if (!playing || scenes.length < 2) return;
    const timer = window.setInterval(() => setSceneIndex((current) => (current + 1) % scenes.length), 2600);
    return () => window.clearInterval(timer);
  }, [playing, scenes.length]);

  if (renderUrl) {
    return (
      <div className="overflow-hidden rounded-(--r-panel) border border-border bg-(--ink) p-3 shadow-float">
        <video className="mx-auto aspect-[9/16] max-h-[min(68dvh,660px)] w-full rounded-(--r-card) object-cover" controls playsInline poster={posterUrl ?? undefined} src={renderUrl} />
        <p className="px-1 pt-2 text-xs text-white/65">Rendered preview · captions and CTA end card included</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-(--r-panel) border border-border bg-(--ink) p-3 shadow-float">
      <div className="relative mx-auto flex aspect-[9/16] max-h-[min(68dvh,660px)] w-full max-w-[360px] flex-col justify-between overflow-hidden rounded-(--r-card) bg-(--surface-subtle) text-foreground">
        {posterUrl ? <img src={posterUrl} alt="Video poster preview" className="absolute inset-0 size-full object-cover opacity-70" /> : null}
        <div className="relative flex items-center justify-between p-4 text-xs font-semibold"><span className="rounded-full bg-background/90 px-2.5 py-1">Draft preview</span><span>{sceneIndex + 1}/{scenes.length}</span></div>
        <div className="relative space-y-3 p-5">
          <span className="inline-flex rounded-full bg-(--ink) px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white">{scene?.title ?? "Hook"}</span>
          <p className="max-w-[18ch] font-display text-2xl font-extrabold leading-tight tracking-tight">{scene?.caption ?? "Your story starts here."}</p>
          {scene?.kind === "cta" ? <div className="inline-flex min-h-11 items-center rounded-full bg-(--ink) px-4 text-sm font-semibold text-white">Book a conversation</div> : <p className="text-sm text-muted-foreground">Scene copy will be generated from your brief.</p>}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" aria-label={playing ? "Pause preview" : "Play preview"} onClick={() => setPlaying((value) => !value)} className="grid min-h-11 min-w-11 place-items-center rounded-full bg-white text-(--ink) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">{playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}</button>
        <div className="flex min-w-0 flex-1 gap-1.5" aria-label="Hook, Proof, Value, and CTA preview scenes">
          {scenes.map((item, index) => <button key={item.id} type="button" aria-label={`Show ${item.title} scene`} aria-pressed={index === sceneIndex} onClick={() => { setSceneIndex(index); setPlaying(false); }} className={`min-h-11 min-w-0 flex-1 rounded-(--r-control) px-2 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${index === sceneIndex ? "bg-white text-(--ink)" : "bg-white/10 text-white/70 hover:bg-white/15"}`}>{item.title}</button>)}
        </div>
        <button type="button" aria-label="Restart preview" onClick={() => { setSceneIndex(0); setPlaying(false); }} className="grid min-h-11 min-w-11 place-items-center rounded-full bg-white/10 text-white/75 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"><RotateCcw aria-hidden className="size-4" /></button>
      </div>
      <p className="px-1 pt-2 text-xs text-white/65">Not rendered yet · this is a deterministic scene preview</p>
    </div>
  );
}
