"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

const PHASES = [
  "Preparing your ad copy",
  "Creating Feed and Story ads",
  "Running final checks",
] as const;

export function GenerationProgress({ quality, titleId }: { quality: "fast" | "high"; titleId: string }) {
  const [phaseIndex, setPhaseIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setPhaseIndex((value) => (value + 1) % PHASES.length), 14_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="studio-generation" aria-labelledby={titleId} aria-busy="true">
      <header className="studio-generation-head">
        <h2 id={titleId}>Your ad is being generated</h2>
        <p>{quality === "fast" ? "Usually ready in about a minute." : "High-quality ads usually take 2–3 minutes."}</p>
        <div className="studio-generation-phase" role="status" aria-live="polite">
          <LoaderCircle aria-hidden size={17} />
          <span>{PHASES[phaseIndex]}</span>
        </div>
      </header>
    </section>
  );
}
