"use client";

import { Lightbulb, Sparkles, Zap } from "lucide-react";
import { useEffect, useState } from "react";

import type { AuditSuggestions } from "@/lib/research/audit-suggestions";

const READY_EVENT = "blockwise:audit-suggestions-ready";

type SuggestionsState =
  | { status: "loading" }
  | { status: "ready"; suggestions: AuditSuggestions }
  | { status: "error" };

export function AuditSuggestionsPanel({ location }: { location: string }) {
  const [state, setState] = useState<SuggestionsState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function load() {
      try {
        const params = new URLSearchParams({ location });
        const response = await fetch(`/api/research/audit/suggestions?${params.toString()}`, { signal: controller.signal });
        const payload = await response.json();
        if (!active) return;
        if (!response.ok || !payload?.suggestions) {
          setState({ status: "error" });
        } else {
          setState({ status: "ready", suggestions: payload.suggestions });
        }
      } catch {
        if (!active || controller.signal.aborted) return;
        setState({ status: "error" });
      } finally {
        if (active) window.dispatchEvent(new CustomEvent(READY_EVENT));
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [location]);

  if (state.status === "loading") {
    return (
      <div className="audit-ai-loading" aria-live="polite">
        <Sparkles size={18} aria-hidden />
        <span>Writing your campaign plan...</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="audit-ai-loading">
        <span>The plan is temporarily unavailable - the data above still tells the story.</span>
      </div>
    );
  }

  const { suggestions } = state;

  return (
    <div className="audit-ai">
      <p className="audit-ai-summary">{suggestions.summary}</p>

      <h4 className="audit-ai-subhead"><Lightbulb size={16} aria-hidden /> 3 ads to run in {location}</h4>
      <div className="audit-angle-grid">
        {suggestions.recommendedAngles.map((angle, index) => (
          <article className="audit-angle-card" key={index}>
            <h5>{angle.title}</h5>
            <p>{angle.why}</p>
            <p className="audit-angle-example">&ldquo;{angle.example}&rdquo;</p>
          </article>
        ))}
      </div>

      <h4 className="audit-ai-subhead"><Zap size={16} aria-hidden /> Do this first</h4>
      <ul className="audit-ai-quickwins">
        {suggestions.quickWins.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
