"use client";

import { LoaderCircle } from "lucide-react";

import type { AdStudioTemplate } from "@/lib/adstudio";
import { templateDisplaySrc } from "@/lib/adstudio/template-display.ts";

const SHOWCASE_LIMIT = 16;

export function GenerationProgress({
  quality,
  templates,
  titleId,
}: {
  quality: "fast" | "high";
  templates: AdStudioTemplate[];
  titleId: string;
}) {
  const showcaseTemplates = templates.slice(0, SHOWCASE_LIMIT);

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
        <div className="studio-generation-showcase-track">
          {[0, 1].map((copy) => (
            <div className="studio-generation-showcase-set" key={copy}>
              {showcaseTemplates.map((template, index) => (
                <figure
                  className="studio-generation-showcase-card"
                  data-format={template.format}
                  key={`${copy}-${template.id}`}
                >
                  <img
                    src={templateDisplaySrc(template, "320")}
                    srcSet={`${templateDisplaySrc(template, "320")} 320w, ${templateDisplaySrc(template, "640")} 640w`}
                    sizes="(max-width: 900px) 78vw, 360px"
                    alt=""
                    draggable={false}
                    loading={copy === 0 && index < 4 ? "eager" : "lazy"}
                    decoding="async"
                    fetchPriority={copy === 0 && index < 2 ? "high" : "low"}
                  />
                </figure>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
