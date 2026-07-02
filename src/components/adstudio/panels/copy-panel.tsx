"use client";

import { FileText, Info, PenLine, Zap } from "lucide-react";

import { CopyFields, PanelHeader } from "../inspector";
import type { CopyAlternates, CopyContext, CopyFeedback, CopyMode, CopyState } from "../use-copy";

const ASSIST_ACTIONS = ["Sharper", "More local", "More premium", "More direct", "Less hype", "5 hook ideas"];

type CopyPanelProps = {
  copy: CopyState;
  updateCopy: (key: keyof CopyState, value: string) => void;
  copyMode: CopyMode;
  setCopyMode: (mode: CopyMode) => void;
  brief: string;
  setBrief: (value: string) => void;
  generating: boolean;
  feedback: CopyFeedback | null;
  alternates: CopyAlternates;
  context: CopyContext;
  onGenerate: (kind: "ai" | "brief", context: CopyContext) => void;
  onAssist: (action: string, context: CopyContext) => void;
  onApplyAlternate: (field: "headline" | "primaryText", value: string) => void;
  /** True when the current creative is an AI-designed clone (text baked into the image). */
  cloneCreative?: boolean;
};

export function CopyPanel({
  copy,
  updateCopy,
  copyMode,
  setCopyMode,
  brief,
  setBrief,
  generating,
  feedback,
  alternates,
  context,
  onGenerate,
  onAssist,
  onApplyAlternate,
  cloneCreative = false,
}: CopyPanelProps) {
  const hasAlternates = alternates.headline.length > 0 || alternates.primaryText.length > 0;
  const feedbackNode = feedback ? (
    <div
      className={`studio-inline-feedback ${feedback.tone}`}
      role={feedback.tone === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <Info aria-hidden size={15} />
      <span>{feedback.message}</span>
    </div>
  ) : null;

  return (
    <>
      <PanelHeader
        title="Text"
        detail={
          cloneCreative
            ? "This edits the feed text shown around the image. Text on the image itself is AI-designed — create a new ad to change it."
            : "Click canvas text to edit that layer, or write and rewrite the ad copy here."
        }
      />

      <div className="studio-mode-seg" role="tablist" aria-label="Copy mode">
        <button
          type="button"
          role="tab"
          aria-selected={copyMode === "ai"}
          className={copyMode === "ai" ? "active" : ""}
          onClick={() => setCopyMode("ai")}
        >
          <Zap aria-hidden size={14} />
          Write for me
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={copyMode === "brief"}
          className={copyMode === "brief" ? "active" : ""}
          onClick={() => setCopyMode("brief")}
        >
          <FileText aria-hidden size={14} />
          From a brief
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={copyMode === "own"}
          className={copyMode === "own" ? "active" : ""}
          onClick={() => setCopyMode("own")}
        >
          <PenLine aria-hidden size={14} />
          Write your own
        </button>
      </div>

      {copyMode === "ai" && (
        <>
          <div className="studio-ctx" aria-label="Copy context">
            <span>Goal · {context.goal}</span>
            <span>Offer · {context.offer}</span>
            <span>Market · {context.market}</span>
          </div>
          <button
            className="studio-btn accent"
            type="button"
            disabled={generating}
            aria-busy={generating || undefined}
            onClick={() => onGenerate("ai", context)}
          >
            <Zap aria-hidden size={15} />
            {generating ? "Writing…" : "Write it for me"}
          </button>
          {generating ? (
            <span className="studio-progress" role="status" aria-live="polite">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
                <path d="M21 12a9 9 0 1 1-9-9" strokeLinecap="round" />
              </svg>
              Writing copy…
            </span>
          ) : null}
          {feedbackNode}
          <CopyFields copy={copy} updateCopy={updateCopy} />
          {hasAlternates && (
            <>
              {alternates.headline.length > 0 && (
                <div className="studio-alts" aria-label="Alternate headlines">
                  {alternates.headline.map((alt) => (
                    <button key={alt} type="button" onClick={() => onApplyAlternate("headline", alt)}>
                      {alt}
                    </button>
                  ))}
                </div>
              )}
              {alternates.primaryText.length > 0 && (
                <div className="studio-alts" aria-label="Alternate primary text">
                  {alternates.primaryText.map((alt) => (
                    <button key={alt} type="button" onClick={() => onApplyAlternate("primaryText", alt)}>
                      {alt}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="studio-hint">
            <Info aria-hidden size={15} />
            <span>
              Drafted from your <b>goal, offer and market</b>, within Meta housing rules. Tap an alternate to swap it in.
            </span>
          </div>
        </>
      )}

      {copyMode === "brief" && (
        <>
          <textarea
            className="studio-brief-box"
            value={brief}
            rows={6}
            onChange={(event) => setBrief(event.target.value)}
            placeholder={'Tell us about this ad in your own words…\n\ne.g. "Open home this Saturday 11am, renovated 3-bed on River St, big backyard. Friendly tone, gentle urgency on the time."'}
          />
          <button
            className="studio-btn accent"
            type="button"
            disabled={generating}
            aria-busy={generating || undefined}
            onClick={() => onGenerate("brief", context)}
          >
            <Zap aria-hidden size={15} />
            {generating ? "Writing…" : "Generate copy from brief"}
          </button>
          {generating ? (
            <span className="studio-progress" role="status" aria-live="polite">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
                <path d="M21 12a9 9 0 1 1-9-9" strokeLinecap="round" />
              </svg>
              Writing copy from your brief…
            </span>
          ) : null}
          {feedbackNode}
          <div className="studio-copy-result" aria-label="Current ad copy">
            <strong>Current ad copy</strong>
            <CopyFields copy={copy} updateCopy={updateCopy} />
          </div>
          <div className="studio-hint">
            <Info aria-hidden size={15} />
            <span>
              Your brief stays here, so you can <b>regenerate or tweak</b> later without retyping it.
            </span>
          </div>
        </>
      )}

      {copyMode === "own" && (
        <>
          <CopyFields copy={copy} updateCopy={updateCopy} />
          <div className="studio-assist-row" aria-label="Copy assist">
            {ASSIST_ACTIONS.map((label) => (
              <button key={label} type="button" disabled={generating} onClick={() => onAssist(label, context)}>
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
