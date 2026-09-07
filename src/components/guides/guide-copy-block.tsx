"use client";

import { useId, useState } from "react";

type GuideCopyBlockProps = {
  title: string;
  text: string;
};

type CopyState = "idle" | "copied" | "failed";

export function GuideCopyBlock({ title, text }: GuideCopyBlockProps) {
  const [state, setState] = useState<CopyState>("idle");
  const titleId = useId();

  async function copyText() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }

      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  const statusMessage =
    state === "copied"
      ? "Copied to clipboard."
      : state === "failed"
        ? "Copy failed. Select the text above to copy it manually."
        : "";

  return (
    <section className="bw-copy-block" aria-labelledby={titleId}>
      <div className="bw-copy-block-head">
        <h3 id={titleId}>{title}</h3>
        <button type="button" className="bw-copy-block-button" onClick={copyText}>
          Copy
        </button>
      </div>
      <p className="bw-copy-block-text" tabIndex={0}>
        {text}
      </p>
      <p className="bw-copy-block-status" role="status" aria-live="polite">
        {statusMessage}
      </p>
    </section>
  );
}

export type { GuideCopyBlockProps };
