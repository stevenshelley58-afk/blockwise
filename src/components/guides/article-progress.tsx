"use client";

import { useEffect, useState } from "react";

export function ArticleProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;

    /* The old handler measured the document on every scroll event, so a fast
       scroll forced a synchronous reflow per tick. Coalesce the burst into one
       layout read per frame; the handler now only schedules. */
    function updateProgress() {
      frame = 0;
      const root = document.documentElement;
      const remaining = root.scrollHeight - root.clientHeight;
      setProgress(remaining > 0 ? Math.min(window.scrollY / remaining, 1) : 0);
    }

    function schedule() {
      if (frame) return;
      frame = window.requestAnimationFrame(updateProgress);
    }

    updateProgress();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="bw-article-progress" aria-hidden>
      <span style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}
