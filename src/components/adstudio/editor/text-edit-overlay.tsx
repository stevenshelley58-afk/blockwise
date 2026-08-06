"use client";

// §7 text-edit-overlay: double-click/Enter on a text layer opens a DOM
// textarea positioned over the layer (react-konva-utils Html), live char
// counter vs maxLength, Esc cancels, Cmd/Ctrl+Enter commits.

import { useEffect, useRef, useState } from "react";
import { Html } from "react-konva-utils";

export function TextEditOverlay({
  x,
  y,
  width,
  height,
  value,
  maxLength,
  align,
  fontSize,
  fontFamily,
  onCommit,
  onCancel,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  value: string;
  maxLength: number;
  align: "left" | "center" | "right";
  fontSize: number;
  fontFamily: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => onCommit(draft.slice(0, maxLength));

  return (
    <Html>
      <div
        className="absolute z-30 -translate-x-1/2 -translate-y-1/2"
        style={{ left: x + width / 2, top: y + height / 2 }}
      >
        <textarea
          ref={ref}
          value={draft}
          rows={Math.max(2, Math.round(height / Math.max(12, fontSize)))}
          maxLength={maxLength}
          className="w-72 resize-none rounded-md border-2 border-[#2f7cf6] bg-white/95 p-2 text-[#050505] shadow-lg focus:outline-none"
          style={{ fontFamily, fontSize: Math.max(12, fontSize / 4), textAlign: align }}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
        />
        <div className="mt-1 text-right text-[11px] font-semibold text-[#8a94a3]">
          {draft.length}/{maxLength}
        </div>
      </div>
    </Html>
  );
}
