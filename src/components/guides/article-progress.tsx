"use client";

import { useEffect, useState } from "react";

export function ArticleProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    function updateProgress() {
      const root = document.documentElement;
      const remaining = root.scrollHeight - root.clientHeight;
      setProgress(remaining > 0 ? Math.min(window.scrollY / remaining, 1) : 0);
    }

    updateProgress();
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);
    return () => {
      window.removeEventListener("scroll", updateProgress);
      window.removeEventListener("resize", updateProgress);
    };
  }, []);

  return (
    <div className="bw-article-progress" aria-hidden>
      <span style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}
