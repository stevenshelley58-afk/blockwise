"use client";

import { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* colour helpers                                                      */
/* ------------------------------------------------------------------ */

type Hsv = { h: number; s: number; v: number };

function hexToHsv(hex: string): Hsv {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#888888";
  const r = parseInt(clean.slice(1, 3), 16) / 255;
  const g = parseInt(clean.slice(3, 5), 16) / 255;
  const b = parseInt(clean.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx ? d / mx : 0, v: mx };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const f = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`.toUpperCase();
}

/* ------------------------------------------------------------------ */
/* swatch + in-app picker                                              */
/* ------------------------------------------------------------------ */

type SwatchProps = {
  label: string;
  value: string;
  sitePalette: string[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (hex: string) => void;
};

export function ColorSwatch({ label, value, sitePalette, open, onOpen, onClose, onChange }: SwatchProps) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexText, setHexText] = useState(value.replace("#", ""));
  const svRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setHsv(hexToHsv(value));
      setHexText(value.replace("#", ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function commit(next: Hsv) {
    setHsv(next);
    const hex = hsvToHex(next);
    setHexText(hex.replace("#", ""));
    onChange(hex);
  }

  function pickFromField(event: React.PointerEvent<HTMLDivElement>) {
    const rect = svRef.current?.getBoundingClientRect();
    if (!rect) return;
    const s = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const v = Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height));
    commit({ ...hsv, s, v });
  }

  return (
    <div className={`bs-swatch${open ? " open" : ""}`}>
      <button
        type="button"
        className="well"
        style={{ background: value }}
        aria-label={`Edit ${label} colour`}
        onClick={(event) => {
          event.stopPropagation();
          open ? onClose() : onOpen();
        }}
      />
      <b>{label}</b>
      <small>{value.toUpperCase()}</small>

      {open && (
        <div className="bs-picker" onClick={(event) => event.stopPropagation()}>
          <div
            ref={svRef}
            className="sv"
            style={{ ["--h" as string]: `hsl(${hsv.h},100%,50%)` }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              pickFromField(event);
            }}
            onPointerMove={(event) => {
              if (event.buttons === 1) pickFromField(event);
            }}
          >
            <span className="cur" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
          </div>
          <input
            className="hue"
            type="range"
            min={0}
            max={360}
            value={hsv.h}
            onChange={(event) => commit({ ...hsv, h: Number(event.target.value) })}
          />
          {sitePalette.length > 0 && (
            <div className="from-site">
              <small>From your site</small>
              <div className="dots">
                {sitePalette.map((colour) => (
                  <button
                    key={colour}
                    type="button"
                    style={{ background: colour }}
                    aria-label={`Use ${colour}`}
                    onClick={() => commit(hexToHsv(colour))}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="pick-foot">
            <span className="hexwrap">
              #
              <input
                value={hexText}
                maxLength={6}
                onChange={(event) => {
                  setHexText(event.target.value);
                  if (/^[0-9a-f]{6}$/i.test(event.target.value)) {
                    const next = hexToHsv(`#${event.target.value}`);
                    setHsv(next);
                    onChange(`#${event.target.value.toUpperCase()}`);
                  }
                }}
              />
            </span>
            <button type="button" className="ok" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
