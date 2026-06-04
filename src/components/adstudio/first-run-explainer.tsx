"use client";

import { Info, X } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "blockwise:first-run-explainer-dismissed";

export function FirstRunExplainer() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(window.localStorage.getItem(STORAGE_KEY) !== "1");
  }, []);

  function dismiss() {
    window.localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="studio-hint" role="note" style={{ alignItems: "flex-start" }}>
      <Info aria-hidden size={17} />
      <span style={{ flex: 1 }}>
        <b>First ad trial pack.</b> Generating uses 1 of 10 free ad packs. No Meta account is needed until publish.
      </span>
      <button className="studio-icon-btn" type="button" aria-label="Dismiss first ad note" onClick={dismiss} style={{ width: 28, height: 28 }}>
        <X aria-hidden size={14} />
      </button>
    </div>
  );
}
