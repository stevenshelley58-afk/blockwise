"use client";

import { LoaderCircle } from "lucide-react";

export function GenerationProgress({ quality, titleId }: { quality: "fast" | "high"; titleId: string }) {
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
    </section>
  );
}
