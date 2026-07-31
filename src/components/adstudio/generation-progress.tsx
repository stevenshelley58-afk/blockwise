"use client";

import { LoaderCircle } from "lucide-react";

import type { AdStudioTemplate } from "@/lib/adstudio";
import { templateDisplaySrc } from "@/lib/adstudio/template-display.ts";

export function GenerationProgress({
  quality,
  template,
  titleId,
}: {
  quality: "fast" | "high";
  template: AdStudioTemplate;
  titleId: string;
}) {
  return (
    <section className="studio-generation" aria-labelledby={titleId} aria-busy="true">
      <header className="studio-generation-head">
        <h2 id={titleId}>Your ad is being generated</h2>
        <p>{quality === "fast" ? "Usually ready in about a minute." : "High-quality ads usually take 2–3 minutes."}</p>
        <div className="studio-generation-phase" role="status" aria-live="polite">
          <LoaderCircle aria-hidden size={17} />
          <span>Creating your Feed and Story ads</span>
        </div>
      </header>

      <div className="studio-generation-showcase" aria-hidden="true">
        <figure className="studio-generation-showcase-card" data-format={template.format}>
          <img
            src={templateDisplaySrc(template, "320")}
            srcSet={`${templateDisplaySrc(template, "320")} 320w, ${templateDisplaySrc(template, "640")} 640w`}
            sizes="(max-width: 900px) calc(100vw - 72px), 416px"
            alt=""
            draggable={false}
            loading="eager"
            decoding="async"
            fetchPriority="high"
          />
        </figure>
      </div>
    </section>
  );
}
