// Composition library: each builder returns a fully-placed Scene for one
// structurally distinct layout. Lead-gen forward — the offer + CTA are the
// hero; the listing photo is supporting credibility.
//
// Distinct STRUCTURES (not recolours of one layout):
//   split        — vertical photo | colour-panel split
//   bannerArch   — arched photo over an overlapping paper card
//   typeLed      — oversized headline on paper, small framed photo
//   valueForm    — "what's your home worth" estimate / faux input + CTA
//   marketStat   — big stat number, report style, side photo strip
//   checklist    — numbered checklist card (downloadable lead magnet)

import {
  alpha,
  darken,
  lighten,
  type Element,
  type FontStacks,
  type Palette,
  type Scene,
} from "./preview-engine.ts";

export type CompositionCopy = {
  brand: string;
  eyebrow: string;
  headline: string;
  subhead: string;
  cta: string;
  stat?: string;
  statLabel?: string;
  features?: string[];
};

export type CompositionContext = {
  width: number;
  height: number;
  palette: Palette;
  stacks: FontStacks;
  copy: CompositionCopy;
  photo?: string | null;
};

export type CompositionId =
  | "split"
  | "bannerArch"
  | "typeLed"
  | "valueForm"
  | "marketStat"
  | "checklist"
  | "framedPolaroid"
  | "bottomBar"
  | "posterGradient"
  | "magazineCover"
  | "statTriple"
  | "gridFour"
  | "quoteProof"
  | "appraisalSeal"
  | "ribbonSold"
  | "sidebarIndex"
  | "eventCard"
  | "splitHorizon";

type Builder = (ctx: CompositionContext) => Scene;

// --- small shared helpers -------------------------------------------------

function softShadow(color = "rgba(15,23,42,0.28)") {
  return { dx: 0, dy: 14, blur: 26, color };
}

function ctaButton(
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  fill: string,
  textColor: string,
  stacks: FontStacks,
  withArrow = true,
): Element[] {
  const els: Element[] = [
    { kind: "rect", x, y, w, h, radius: h / 2, fill, shadow: softShadow(alpha(fill, 0.45)) },
    {
      kind: "text",
      x: x + 30,
      y: y + h / 2 - 18,
      w: w - (withArrow ? 86 : 60),
      h: 36,
      text: label,
      font: "sans",
      size: 30,
      weight: 800,
      fill: textColor,
      align: "left",
      maxLines: 1,
    },
  ];
  if (withArrow) {
    els.push({ kind: "icon", name: "arrow", x: x + w - 56, y: y + h / 2 - 16, w: 32, h: 32, stroke: textColor, strokeWidth: 2.6 });
  }
  return els;
}

function eyebrow(x: number, y: number, text: string, color: string, stacks: FontStacks, align: "left" | "center" = "left"): Element[] {
  return [
    { kind: "rect", x: align === "center" ? x - 28 : x, y: y + 6, w: 56, h: 5, radius: 3, fill: color },
    {
      kind: "text",
      x: align === "center" ? x - 200 : x + 72,
      y,
      w: 400,
      h: 30,
      text,
      font: "sans",
      size: 24,
      weight: 800,
      fill: color,
      align: align === "center" ? "center" : "left",
      tracking: 3,
      upper: true,
      maxLines: 1,
    },
  ];
}

function brandRow(x: number, y: number, brand: string, color: string, stacks: FontStacks): Element {
  return {
    kind: "text",
    x,
    y,
    w: 520,
    h: 30,
    text: brand,
    font: "sans",
    size: 26,
    weight: 800,
    fill: color,
    tracking: 1,
    maxLines: 1,
  };
}

// --- 1. SPLIT -------------------------------------------------------------

const split: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const splitX = Math.round(W * 0.5);
  const pad = 70;
  const els: Element[] = [
    { kind: "rect", x: 0, y: 0, w: W, h: H, fill: p.paper },
    // photo column
    { kind: "photo", x: 0, y: 0, w: splitX, h: H, src: photo ?? null, label: photo ? undefined : "Your listing photo", overlay: { from: alpha(p.deep, 0.0), to: alpha(p.deep, 0.18), angle: 90 } },
    // colour panel
    { kind: "rect", x: splitX, y: 0, w: W - splitX, h: H, gradient: { from: p.primary, to: p.deep, angle: 135 } },
    { kind: "rect", x: splitX, y: 0, w: 8, h: H, fill: p.accent },
  ];
  const cx = splitX + pad;
  els.push(brandRow(cx, 96, copy.brand, alpha(p.onPrimary, 0.85), stacks));
  els.push(...eyebrow(cx, 188, copy.eyebrow, p.accent, stacks));
  els.push({ kind: "text", x: cx, y: 250, w: W - splitX - pad * 2, h: 360, text: copy.headline, font: "serif", size: 76, weight: 800, fill: p.onPrimary, lineHeight: 1.06, maxLines: 4 });
  els.push({ kind: "text", x: cx, y: 600, w: W - splitX - pad * 2, h: 160, text: copy.subhead, font: "sans", size: 30, weight: 500, fill: alpha(p.onPrimary, 0.86), lineHeight: 1.32, maxLines: 4 });
  els.push(...ctaButton(cx, H - 250, W - splitX - pad * 2, 92, copy.cta, p.accent, p.onAccent, stacks));
  els.push({ kind: "text", x: cx, y: H - 110, w: W - splitX - pad * 2, h: 28, text: "Local agents · written for your suburb", font: "sans", size: 21, weight: 500, fill: alpha(p.onPrimary, 0.6), maxLines: 1 });
  return { width: W, height: H, elements: els };
};

// --- 2. BANNER + ARCH -----------------------------------------------------

const bannerArch: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const pad = 64;
  const photoH = Math.round(H * 0.52);
  const els: Element[] = [
    { kind: "rect", x: 0, y: 0, w: W, h: H, gradient: { from: lighten(p.primary, 0.9), to: p.tint, angle: 160 } },
    { kind: "photo", x: pad, y: pad, w: W - pad * 2, h: photoH, src: photo ?? null, clip: "arch", label: photo ? undefined : "Your listing photo", shadow: softShadow(), overlay: { from: alpha(p.deep, 0.05), to: alpha(p.deep, 0.32), angle: 90 } },
    // floating eyebrow badge on the photo
    { kind: "rect", x: pad + 28, y: pad + 28, w: 22 + copy.eyebrow.length * 15 + 36, h: 52, radius: 26, fill: p.accent, shadow: softShadow(alpha(p.accent, 0.5)) },
    { kind: "text", x: pad + 28, y: pad + 41, w: 22 + copy.eyebrow.length * 15 + 36, h: 30, text: copy.eyebrow, font: "sans", size: 24, weight: 800, fill: p.onAccent, align: "center", tracking: 1, upper: true, maxLines: 1 },
  ];
  // overlapping paper card
  const cardY = pad + photoH - 36;
  els.push({ kind: "rect", x: pad + 36, y: cardY, w: W - (pad + 36) * 2, h: H - cardY - pad, radius: 28, fill: "#ffffff", shadow: softShadow() });
  const cx = pad + 36 + 48;
  const cw = W - (pad + 36) * 2 - 96;
  els.push({ kind: "text", x: cx, y: cardY + 48, w: cw, h: 220, text: copy.headline, font: "display", size: 58, weight: 800, fill: p.ink, lineHeight: 1.05, maxLines: 3 });
  els.push({ kind: "text", x: cx, y: cardY + 240, w: cw, h: 110, text: copy.subhead, font: "sans", size: 28, weight: 500, fill: p.mute, lineHeight: 1.3, maxLines: 3 });
  els.push(...ctaButton(cx, H - pad - 132, Math.min(cw, 520), 90, copy.cta, p.primary, p.onPrimary, stacks));
  els.push(brandRow(W - pad - 36 - 48 - 260, cardY + 48 + 6, copy.brand, p.accent, stacks));
  return { width: W, height: H, elements: els };
};

// --- 3. TYPE-LED ----------------------------------------------------------

const typeLed: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const pad = 76;
  const els: Element[] = [
    { kind: "rect", x: 0, y: 0, w: W, h: H, fill: p.paper },
    { kind: "rect", x: 0, y: 0, w: W, h: 14, fill: p.accent },
  ];
  els.push(brandRow(pad, 96, copy.brand, p.primary, stacks));
  els.push(...eyebrow(pad, 184, copy.eyebrow, p.accent, stacks));
  // oversized headline
  els.push({ kind: "text", x: pad, y: 250, w: W - pad * 2, h: 560, text: copy.headline, font: "display", size: 120, weight: 900, fill: p.ink, lineHeight: 0.98, maxLines: 4 });
  // accent underline
  els.push({ kind: "rect", x: pad, y: 250 + 470, w: 220, h: 12, radius: 6, fill: p.accent });
  // framed photo bottom-right
  const pw = Math.round(W * 0.46);
  const ph = Math.round(H * 0.3);
  els.push({ kind: "photo", x: W - pad - pw, y: H - pad - ph - 150, w: pw, h: ph, src: photo ?? null, radius: 20, label: photo ? undefined : "Your photo", shadow: softShadow(), stroke: "#ffffff", strokeWidth: 8 });
  // subhead + CTA bottom-left
  els.push({ kind: "text", x: pad, y: H - pad - ph - 150 + 6, w: W - pad * 2 - pw - 48, h: 160, text: copy.subhead, font: "serif", size: 32, italic: true, weight: 500, fill: p.mute, lineHeight: 1.3, maxLines: 4 });
  els.push(...ctaButton(pad, H - pad - 96, 480, 90, copy.cta, p.primary, p.onPrimary, stacks));
  return { width: W, height: H, elements: els };
};

// --- 4. VALUE / ESTIMATE FORM --------------------------------------------

const valueForm: Builder = ({ width: W, height: H, palette: p, stacks, copy }) => {
  const pad = 72;
  const els: Element[] = [
    { kind: "rect", x: 0, y: 0, w: W, h: H, gradient: { from: p.primary, to: p.deep, angle: 145 } },
    // decorative soft circles
    { kind: "ellipse", x: W - 360, y: -180, w: 520, h: 520, fill: alpha(p.accent, 0.16) },
    { kind: "ellipse", x: -200, y: H - 260, w: 460, h: 460, fill: alpha("#ffffff", 0.05) },
  ];
  els.push(brandRow(pad, 100, copy.brand, alpha(p.onPrimary, 0.85), stacks));
  // little home badge
  els.push({ kind: "ellipse", x: W - pad - 96, y: 76, w: 96, h: 96, fill: alpha("#ffffff", 0.12) });
  els.push({ kind: "icon", name: "home", x: W - pad - 72, y: 100, w: 48, h: 48, stroke: p.accent, strokeWidth: 2.4 });
  els.push(...eyebrow(pad, 230, copy.eyebrow, p.accent, stacks));
  els.push({ kind: "text", x: pad, y: 296, w: W - pad * 2, h: 360, text: copy.headline, font: "serif", size: 92, weight: 800, fill: p.onPrimary, lineHeight: 1.04, maxLines: 4 });
  els.push({ kind: "text", x: pad, y: 660, w: W - pad * 2, h: 110, text: copy.subhead, font: "sans", size: 30, weight: 500, fill: alpha(p.onPrimary, 0.85), lineHeight: 1.3, maxLines: 3 });
  // faux input field
  const fieldY = 850;
  els.push({ kind: "rect", x: pad, y: fieldY, w: W - pad * 2, h: 96, radius: 18, fill: "#ffffff" });
  els.push({ kind: "icon", name: "pin", x: pad + 28, y: fieldY + 26, w: 44, h: 44, stroke: p.primary, strokeWidth: 2.2 });
  els.push({ kind: "text", x: pad + 92, y: fieldY + 30, w: W - pad * 2 - 120, h: 40, text: "Enter your street address", font: "sans", size: 30, weight: 500, fill: "#9aa7b5", align: "left", maxLines: 1 });
  // CTA full width
  els.push(...ctaButton(pad, fieldY + 124, W - pad * 2, 100, copy.cta, p.accent, p.onAccent, stacks));
  els.push({ kind: "text", x: pad, y: H - 92, w: W - pad * 2, h: 28, text: "Free · no obligation · local sales data", font: "sans", size: 22, weight: 500, fill: alpha(p.onPrimary, 0.7), align: "center", maxLines: 1 });
  return { width: W, height: H, elements: els };
};

// --- 5. MARKET STAT -------------------------------------------------------

const marketStat: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const els: Element[] = [
    { kind: "rect", x: 0, y: 0, w: W, h: H, gradient: { from: darken(p.primary, 0.2), to: p.deep, angle: 160 } },
  ];
  const pad = 72;
  // side photo strip
  const stripW = Math.round(W * 0.34);
  els.push({ kind: "photo", x: W - stripW, y: 0, w: stripW, h: H, src: photo ?? null, label: photo ? undefined : "Your area", overlay: { from: alpha(p.deep, 0.55), to: alpha(p.deep, 0.2), angle: 0 } });
  els.push({ kind: "rect", x: W - stripW - 6, y: 0, w: 6, h: H, fill: p.accent });
  const cw = W - stripW - pad * 2;
  els.push(brandRow(pad, 100, copy.brand, alpha(p.onPrimary, 0.85), stacks));
  els.push(...eyebrow(pad, 200, copy.eyebrow, p.accent, stacks));
  // big stat
  els.push({ kind: "text", x: pad, y: 280, w: cw, h: 220, text: copy.stat ?? "+12.4%", font: "display", size: 180, weight: 900, fill: p.accent, lineHeight: 0.9, maxLines: 1 });
  els.push({ kind: "text", x: pad, y: 470, w: cw, h: 60, text: copy.statLabel ?? "median price growth this year", font: "sans", size: 30, weight: 700, fill: p.onPrimary, lineHeight: 1.15, maxLines: 2 });
  els.push({ kind: "line", x: pad, y: 560, x2: pad + cw, y2: 560, stroke: alpha(p.onPrimary, 0.25), strokeWidth: 2 });
  els.push({ kind: "text", x: pad, y: 600, w: cw, h: 200, text: copy.headline, font: "serif", size: 52, weight: 800, fill: p.onPrimary, lineHeight: 1.08, maxLines: 3 });
  els.push({ kind: "text", x: pad, y: 820, w: cw, h: 120, text: copy.subhead, font: "sans", size: 27, weight: 500, fill: alpha(p.onPrimary, 0.8), lineHeight: 1.3, maxLines: 3 });
  els.push(...ctaButton(pad, H - 220, Math.min(cw, 520), 92, copy.cta, p.accent, p.onAccent, stacks));
  return { width: W, height: H, elements: els };
};

// --- 6. CHECKLIST ---------------------------------------------------------

const checklist: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const pad = 64;
  const els: Element[] = [
    { kind: "rect", x: 0, y: 0, w: W, h: H, fill: p.tint },
  ];
  // header band
  els.push({ kind: "rect", x: 0, y: 0, w: W, h: 300, gradient: { from: p.primary, to: p.deep, angle: 120 } });
  els.push(brandRow(pad, 84, copy.brand, alpha(p.onPrimary, 0.85), stacks));
  els.push(...eyebrow(pad, 156, copy.eyebrow, p.accent, stacks));
  els.push({ kind: "text", x: pad, y: 196, w: W - pad * 2 - 240, h: 120, text: copy.headline, font: "display", size: 54, weight: 900, fill: p.onPrimary, lineHeight: 1.02, maxLines: 2 });
  // thumbnail photo top-right
  els.push({ kind: "photo", x: W - pad - 220, y: 96, w: 220, h: 150, src: photo ?? null, radius: 16, label: photo ? undefined : "Photo", stroke: "#ffffff", strokeWidth: 6, shadow: softShadow() });
  // checklist card
  const cardY = 360;
  els.push({ kind: "rect", x: pad, y: cardY, w: W - pad * 2, h: H - cardY - 200, radius: 26, fill: "#ffffff", shadow: softShadow() });
  const items = (copy.features && copy.features.length ? copy.features : ["Declutter and depersonalise", "Fix the small stuff buyers notice", "Get a pre-list price guide"]).slice(0, 4);
  const rowH = 150;
  items.forEach((item, i) => {
    const ry = cardY + 60 + i * rowH;
    els.push({ kind: "ellipse", x: pad + 48, y: ry, w: 64, h: 64, fill: p.accent });
    els.push({ kind: "icon", name: "check", x: pad + 48 + 16, y: ry + 18, w: 32, h: 32, stroke: p.onAccent, strokeWidth: 3 });
    els.push({ kind: "text", x: pad + 144, y: ry + 4, w: W - pad * 2 - 220, h: 80, text: item, font: "sans", size: 34, weight: 700, fill: p.ink, lineHeight: 1.15, maxLines: 2 });
    if (i < items.length - 1) els.push({ kind: "line", x: pad + 144, y: ry + rowH - 38, x2: W - pad - 64, y2: ry + rowH - 38, stroke: "#e7e9ee", strokeWidth: 2 });
  });
  // CTA
  els.push(...ctaButton(pad, H - 150, W - pad * 2, 96, copy.cta, p.primary, p.onPrimary, stacks));
  return { width: W, height: H, elements: els };
};

// --- 7. FRAMED POLAROID ---------------------------------------------------

const framedPolaroid: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const pad = 70;
  const els: Element[] = [
    { kind: "rect", x: 0, y: 0, w: W, h: H, gradient: { from: p.tint, to: lighten(p.primary, 0.78), angle: 160 } },
  ];
  els.push(brandRow(pad, 92, copy.brand, p.primary, stacks));
  els.push(...eyebrow(W / 2, 168, copy.eyebrow, p.accent, stacks, "center"));
  const pw = Math.round(W * 0.66);
  const ph = Math.round(pw * 0.86);
  const px = (W - pw) / 2;
  const py = 250;
  els.push({ kind: "rect", x: px, y: py, w: pw, h: ph + 84, radius: 10, fill: "#ffffff", rotate: -2.5, shadow: softShadow() });
  els.push({ kind: "photo", x: px + 26, y: py + 26, w: pw - 52, h: ph - 52, src: photo ?? null, label: photo ? undefined : "Your listing photo", radius: 4 });
  els.push({ kind: "text", x: px, y: py + ph + 18, w: pw, h: 40, text: "your suburb · this week", font: "script", size: 40, fill: p.primary, align: "center", maxLines: 1 });
  els.push({ kind: "text", x: pad, y: py + ph + 150, w: W - pad * 2, h: 180, text: copy.headline, font: "serif", size: 64, weight: 800, fill: p.ink, align: "center", lineHeight: 1.05, maxLines: 3 });
  els.push(...ctaButton((W - 460) / 2, H - 190, 460, 92, copy.cta, p.primary, p.onPrimary, stacks));
  return { width: W, height: H, elements: els };
};

// --- 8. BOTTOM BAR --------------------------------------------------------

const bottomBar: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const barH = Math.round(H * 0.4);
  const pad = 70;
  const els: Element[] = [
    { kind: "photo", x: 0, y: 0, w: W, h: H - barH + 60, src: photo ?? null, label: photo ? undefined : "Your listing photo", overlay: { from: alpha(p.deep, 0.1), to: alpha(p.deep, 0.4), angle: 90 } },
    { kind: "rect", x: pad, y: 64, w: 22 + copy.eyebrow.length * 15 + 36, h: 54, radius: 27, fill: p.accent, shadow: softShadow(alpha(p.accent, 0.5)) },
    { kind: "text", x: pad, y: 78, w: 22 + copy.eyebrow.length * 15 + 36, h: 30, text: copy.eyebrow, font: "sans", size: 24, weight: 800, fill: p.onAccent, align: "center", upper: true, tracking: 1, maxLines: 1 },
    { kind: "rect", x: 0, y: H - barH, w: W, h: barH, gradient: { from: p.primary, to: p.deep, angle: 120 } },
    { kind: "rect", x: 0, y: H - barH, w: W, h: 8, fill: p.accent },
  ];
  els.push({ kind: "text", x: W - pad - 360, y: 70, w: 360, h: 30, text: copy.brand, font: "sans", size: 26, weight: 800, fill: "#ffffff", align: "right", tracking: 1, maxLines: 1 });
  els.push({ kind: "text", x: pad, y: H - barH + 56, w: W - pad * 2, h: 180, text: copy.headline, font: "display", size: 62, weight: 800, fill: p.onPrimary, lineHeight: 1.04, maxLines: 2 });
  els.push({ kind: "text", x: pad, y: H - barH + 56 + 150, w: W - pad * 2 - 360, h: 100, text: copy.subhead, font: "sans", size: 27, weight: 500, fill: alpha(p.onPrimary, 0.82), lineHeight: 1.3, maxLines: 2 });
  els.push(...ctaButton(W - pad - 420, H - 150, 420, 92, copy.cta, p.accent, p.onAccent, stacks));
  return { width: W, height: H, elements: els };
};

// --- 9. POSTER GRADIENT ---------------------------------------------------

const posterGradient: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const pad = 72;
  const els: Element[] = [
    { kind: "photo", x: 0, y: 0, w: W, h: H, src: photo ?? null, label: photo ? undefined : "Your listing photo", overlay: { from: alpha("#06101c", 0.05), to: alpha("#06101c", 0.86), angle: 90 } },
    { kind: "rect", x: 0, y: 0, w: W, h: 10, fill: p.accent },
  ];
  els.push(brandRow(pad, 96, copy.brand, "#ffffff", stacks));
  els.push(...eyebrow(pad, H - 560, copy.eyebrow, p.accent, stacks));
  els.push({ kind: "text", x: pad, y: H - 500, w: W - pad * 2, h: 340, text: copy.headline, font: "display", size: 96, weight: 900, fill: "#ffffff", lineHeight: 1.0, maxLines: 3 });
  els.push({ kind: "text", x: pad, y: H - 250, w: W - pad * 2 - 380, h: 110, text: copy.subhead, font: "sans", size: 28, weight: 500, fill: alpha("#ffffff", 0.85), lineHeight: 1.3, maxLines: 3 });
  els.push(...ctaButton(W - pad - 420, H - 240, 420, 92, copy.cta, p.accent, p.onAccent, stacks));
  return { width: W, height: H, elements: els };
};

// --- 10. MAGAZINE COVER ---------------------------------------------------

const magazineCover: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const pad = 64;
  const els: Element[] = [
    { kind: "photo", x: 0, y: 0, w: W, h: H, src: photo ?? null, label: photo ? undefined : "Your listing photo", overlay: { from: alpha(p.deep, 0.3), to: alpha(p.deep, 0.5), angle: 90 } },
  ];
  els.push({ kind: "line", x: pad, y: 150, x2: W - pad, y2: 150, stroke: "#ffffff", strokeWidth: 3 });
  els.push({ kind: "text", x: pad, y: 96, w: W - pad * 2, h: 60, text: copy.brand, font: "serif", size: 56, weight: 800, fill: "#ffffff", maxLines: 1 });
  els.push({ kind: "text", x: W - pad - 360, y: 110, w: 360, h: 30, text: copy.eyebrow.toUpperCase(), font: "sans", size: 22, weight: 700, fill: p.accent, align: "right", tracking: 3, maxLines: 1 });
  els.push({ kind: "text", x: pad, y: H - 470, w: W - pad * 2, h: 320, text: copy.headline, font: "serif", size: 104, weight: 900, fill: "#ffffff", lineHeight: 0.98, maxLines: 3 });
  els.push({ kind: "line", x: pad, y: H - 150, x2: W - pad, y2: H - 150, stroke: alpha("#ffffff", 0.6), strokeWidth: 2 });
  els.push({ kind: "text", x: pad, y: H - 128, w: W - pad * 2 - 320, h: 40, text: copy.subhead, font: "sans", size: 26, weight: 500, fill: alpha("#ffffff", 0.85), maxLines: 1 });
  els.push(...ctaButton(W - pad - 300, H - 132, 300, 74, copy.cta, p.accent, p.onAccent, stacks, false));
  return { width: W, height: H, elements: els };
};

// --- 11. STAT TRIPLE ------------------------------------------------------

const statTriple: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const pad = 64;
  const photoH = Math.round(H * 0.5);
  const els: Element[] = [
    { kind: "rect", x: 0, y: 0, w: W, h: H, fill: p.paper },
    { kind: "photo", x: 0, y: 0, w: W, h: photoH, src: photo ?? null, label: photo ? undefined : "Your listing photo", overlay: { from: alpha(p.deep, 0.05), to: alpha(p.deep, 0.3), angle: 90 } },
    { kind: "rect", x: pad, y: 64, w: 22 + copy.eyebrow.length * 15 + 36, h: 54, radius: 27, fill: p.accent },
    { kind: "text", x: pad, y: 78, w: 22 + copy.eyebrow.length * 15 + 36, h: 30, text: copy.eyebrow, font: "sans", size: 24, weight: 800, fill: p.onAccent, align: "center", upper: true, tracking: 1, maxLines: 1 },
  ];
  els.push({ kind: "text", x: W - pad - 360, y: 70, w: 360, h: 30, text: copy.brand, font: "sans", size: 26, weight: 800, fill: "#ffffff", align: "right", tracking: 1, maxLines: 1 });
  const specs = (copy.features && copy.features.length >= 3 ? copy.features : ["4 Bed", "2 Bath", "2 Car"]).slice(0, 3);
  const icons: ("bed" | "bath" | "car")[] = ["bed", "bath", "car"];
  const tileW = (W - pad * 2 - 40) / 3;
  const tileY = photoH - 60;
  specs.forEach((s, i) => {
    const tx = pad + i * (tileW + 20);
    els.push({ kind: "rect", x: tx, y: tileY, w: tileW, h: 130, radius: 18, fill: "#ffffff", shadow: softShadow() });
    els.push({ kind: "icon", name: icons[i], x: tx + tileW / 2 - 22, y: tileY + 22, w: 44, h: 44, stroke: p.primary, strokeWidth: 2.2 });
    els.push({ kind: "text", x: tx, y: tileY + 78, w: tileW, h: 40, text: s, font: "sans", size: 30, weight: 800, fill: p.ink, align: "center", maxLines: 1 });
  });
  els.push({ kind: "text", x: pad, y: tileY + 190, w: W - pad * 2, h: 200, text: copy.headline, font: "display", size: 56, weight: 800, fill: p.ink, lineHeight: 1.04, maxLines: 3 });
  els.push({ kind: "text", x: pad, y: tileY + 190 + 160, w: W - pad * 2, h: 90, text: copy.subhead, font: "sans", size: 27, weight: 500, fill: p.mute, lineHeight: 1.3, maxLines: 2 });
  els.push(...ctaButton(pad, H - 150, W - pad * 2, 92, copy.cta, p.primary, p.onPrimary, stacks));
  return { width: W, height: H, elements: els };
};

// --- 12. GRID FOUR --------------------------------------------------------

const gridFour: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const pad = 64;
  const els: Element[] = [{ kind: "rect", x: 0, y: 0, w: W, h: H, fill: p.primary }];
  els.push(brandRow(pad, 92, copy.brand, alpha(p.onPrimary, 0.85), stacks));
  els.push(...eyebrow(pad, 168, copy.eyebrow, p.accent, stacks));
  els.push({ kind: "text", x: pad, y: 210, w: W - pad * 2, h: 130, text: copy.headline, font: "display", size: 58, weight: 800, fill: p.onPrimary, lineHeight: 1.02, maxLines: 2 });
  const gx = pad;
  const gy = 380;
  const gw = (W - pad * 2 - 24) / 2;
  const gh = 320;
  const labels = ["Sold", "Sold", "Sold", "Sold"];
  for (let i = 0; i < 4; i += 1) {
    const cxp = gx + (i % 2) * (gw + 24);
    const cyp = gy + Math.floor(i / 2) * (gh + 24);
    els.push({ kind: "photo", x: cxp, y: cyp, w: gw, h: gh, src: photo ?? null, label: photo ? undefined : "Recent sale", radius: 16 });
    els.push({ kind: "rect", x: cxp + 16, y: cyp + 16, w: 110, h: 44, radius: 22, fill: p.accent });
    els.push({ kind: "text", x: cxp + 16, y: cyp + 26, w: 110, h: 26, text: labels[i], font: "sans", size: 22, weight: 800, fill: p.onAccent, align: "center", upper: true, maxLines: 1 });
  }
  els.push(...ctaButton(pad, H - 150, W - pad * 2, 92, copy.cta, p.accent, p.onAccent, stacks));
  return { width: W, height: H, elements: els };
};

// --- 13. QUOTE / SOCIAL PROOF ---------------------------------------------

const quoteProof: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const pad = 80;
  const els: Element[] = [
    { kind: "rect", x: 0, y: 0, w: W, h: H, gradient: { from: p.primary, to: p.deep, angle: 150 } },
    { kind: "ellipse", x: W - 320, y: -160, w: 480, h: 480, fill: alpha(p.accent, 0.14) },
  ];
  els.push(brandRow(pad, 96, copy.brand, alpha(p.onPrimary, 0.85), stacks));
  els.push(...eyebrow(pad, 186, copy.eyebrow, p.accent, stacks));
  els.push({ kind: "text", x: pad - 8, y: 230, w: 240, h: 200, text: "“", font: "serif", size: 280, weight: 900, fill: alpha(p.accent, 0.5), maxLines: 1 });
  els.push({ kind: "text", x: pad, y: 420, w: W - pad * 2, h: 460, text: copy.headline, font: "serif", size: 66, weight: 700, fill: p.onPrimary, lineHeight: 1.18, maxLines: 6 });
  els.push({ kind: "photo", x: pad, y: H - 300, w: 96, h: 96, src: photo ?? null, clip: "circle", label: photo ? undefined : "", stroke: p.accent, strokeWidth: 3 });
  els.push({ kind: "text", x: pad + 124, y: H - 290, w: 500, h: 36, text: copy.subhead || "A recent local seller", font: "sans", size: 30, weight: 800, fill: p.onPrimary, maxLines: 1 });
  els.push({ kind: "text", x: pad + 124, y: H - 248, w: 500, h: 30, text: "sold with " + copy.brand, font: "sans", size: 24, weight: 500, fill: alpha(p.onPrimary, 0.7), maxLines: 1 });
  els.push(...ctaButton(pad, H - 150, W - pad * 2, 92, copy.cta, p.accent, p.onAccent, stacks));
  return { width: W, height: H, elements: els };
};

// --- 14. APPRAISAL SEAL ---------------------------------------------------

const appraisalSeal: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const pad = 72;
  const halfH = Math.round(H * 0.46);
  const els: Element[] = [
    { kind: "rect", x: 0, y: 0, w: W, h: H, fill: p.paper },
    { kind: "photo", x: 0, y: 0, w: W, h: halfH, src: photo ?? null, label: photo ? undefined : "Your listing photo", overlay: { from: alpha(p.deep, 0.1), to: alpha(p.deep, 0.34), angle: 90 } },
  ];
  els.push(brandRow(pad, 80, copy.brand, "#ffffff", stacks));
  const sx = W - pad - 220;
  const sy = halfH - 130;
  els.push({ kind: "ellipse", x: sx, y: sy, w: 220, h: 220, fill: p.accent, shadow: softShadow() });
  els.push({ kind: "ellipse", x: sx + 14, y: sy + 14, w: 192, h: 192, stroke: alpha(p.onAccent, 0.5), strokeWidth: 2, fill: "none" });
  els.push({ kind: "icon", name: "star", x: sx + 110 - 22, y: sy + 36, w: 44, h: 44, stroke: p.onAccent, fill: p.onAccent });
  els.push({ kind: "text", x: sx, y: sy + 96, w: 220, h: 90, text: "FREE APPRAISAL", font: "sans", size: 30, weight: 900, fill: p.onAccent, align: "center", lineHeight: 1.05, maxLines: 2 });
  els.push(...eyebrow(pad, halfH + 70, copy.eyebrow, p.accent, stacks));
  els.push({ kind: "text", x: pad, y: halfH + 120, w: W - pad * 2, h: 240, text: copy.headline, font: "serif", size: 72, weight: 800, fill: p.ink, lineHeight: 1.04, maxLines: 3 });
  els.push({ kind: "text", x: pad, y: halfH + 350, w: W - pad * 2, h: 100, text: copy.subhead, font: "sans", size: 28, weight: 500, fill: p.mute, lineHeight: 1.3, maxLines: 2 });
  els.push(...ctaButton(pad, H - 160, W - pad * 2, 96, copy.cta, p.primary, p.onPrimary, stacks));
  return { width: W, height: H, elements: els };
};

// --- 15. RIBBON SOLD ------------------------------------------------------

const ribbonSold: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const pad = 70;
  const barH = Math.round(H * 0.32);
  const els: Element[] = [
    { kind: "photo", x: 0, y: 0, w: W, h: H - barH + 50, src: photo ?? null, label: photo ? undefined : "Your listing photo", overlay: { from: alpha(p.deep, 0.12), to: alpha(p.deep, 0.34), angle: 90 } },
  ];
  els.push({ kind: "text", x: W - pad - 360, y: 70, w: 360, h: 30, text: copy.brand, font: "sans", size: 26, weight: 800, fill: "#ffffff", align: "right", tracking: 1, maxLines: 1 });
  els.push({ kind: "rect", x: -70, y: 120, w: 460, h: 84, fill: p.accent, rotate: -45, shadow: softShadow() });
  els.push({ kind: "text", x: 38, y: 150, w: 240, h: 50, text: "SOLD", font: "display", size: 46, weight: 900, fill: p.onAccent, align: "center", rotate: -45, tracking: 4, maxLines: 1 });
  els.push({ kind: "rect", x: 0, y: H - barH, w: W, h: barH, gradient: { from: p.primary, to: p.deep, angle: 120 } });
  els.push({ kind: "text", x: pad, y: H - barH + 50, w: W - pad * 2, h: 150, text: copy.headline, font: "display", size: 58, weight: 800, fill: p.onPrimary, lineHeight: 1.04, maxLines: 2 });
  els.push({ kind: "text", x: pad, y: H - barH + 50 + 130, w: W - pad * 2 - 380, h: 80, text: copy.subhead, font: "sans", size: 27, weight: 500, fill: alpha(p.onPrimary, 0.82), maxLines: 2 });
  els.push(...ctaButton(W - pad - 420, H - 150, 420, 92, copy.cta, p.accent, p.onAccent, stacks));
  return { width: W, height: H, elements: els };
};

// --- 16. SIDEBAR INDEX ----------------------------------------------------

const sidebarIndex: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const barW = Math.round(W * 0.2);
  const pad = 56;
  const els: Element[] = [
    { kind: "rect", x: 0, y: 0, w: W, h: H, fill: p.paper },
    { kind: "rect", x: 0, y: 0, w: barW, h: H, gradient: { from: p.primary, to: p.deep, angle: 200 } },
    { kind: "photo", x: barW + 40, y: 40, w: W - barW - 80, h: Math.round(H * 0.5), src: photo ?? null, label: photo ? undefined : "Your listing photo", radius: 20, shadow: softShadow() },
  ];
  els.push({ kind: "text", x: barW / 2, y: H - 80, w: H - 160, h: 34, text: copy.brand, font: "sans", size: 28, weight: 800, fill: alpha(p.onPrimary, 0.9), align: "left", rotate: -90, tracking: 2, maxLines: 1 });
  els.push({ kind: "text", x: barW / 2 + 40, y: H - 80, w: H - 160, h: 30, text: copy.eyebrow.toUpperCase(), font: "sans", size: 22, weight: 800, fill: p.accent, align: "left", rotate: -90, tracking: 4, maxLines: 1 });
  const hx = barW + 40;
  const hw = W - barW - 80;
  els.push({ kind: "text", x: hx, y: Math.round(H * 0.5) + 80, w: hw, h: 280, text: copy.headline, font: "display", size: 70, weight: 900, fill: p.ink, lineHeight: 1.0, maxLines: 4 });
  els.push({ kind: "text", x: hx, y: H - 270, w: hw, h: 90, text: copy.subhead, font: "sans", size: 27, weight: 500, fill: p.mute, lineHeight: 1.3, maxLines: 2 });
  els.push(...ctaButton(hx, H - 160, hw, 92, copy.cta, p.primary, p.onPrimary, stacks));
  return { width: W, height: H, elements: els };
};

// --- 17. EVENT CARD (OPEN HOME) -------------------------------------------

const eventCard: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const pad = 64;
  const halfH = Math.round(H * 0.44);
  const els: Element[] = [
    { kind: "rect", x: 0, y: 0, w: W, h: H, fill: p.paper },
    { kind: "photo", x: 0, y: 0, w: W, h: halfH, src: photo ?? null, label: photo ? undefined : "Your listing photo", overlay: { from: alpha(p.deep, 0.08), to: alpha(p.deep, 0.32), angle: 90 } },
  ];
  els.push(brandRow(pad, 80, copy.brand, "#ffffff", stacks));
  const dy = halfH - 80;
  els.push({ kind: "rect", x: pad, y: dy, w: 200, h: 200, radius: 22, fill: p.accent, shadow: softShadow() });
  els.push({ kind: "text", x: pad, y: dy + 28, w: 200, h: 90, text: "SAT", font: "sans", size: 30, weight: 800, fill: p.onAccent, align: "center", upper: true, maxLines: 1 });
  els.push({ kind: "text", x: pad, y: dy + 64, w: 200, h: 110, text: "12", font: "display", size: 110, weight: 900, fill: p.onAccent, align: "center", maxLines: 1 });
  const tx = pad + 240;
  els.push({ kind: "text", x: tx, y: dy + 24, w: W - tx - pad, h: 30, text: copy.eyebrow.toUpperCase(), font: "sans", size: 24, weight: 800, fill: p.primary, tracking: 3, maxLines: 1 });
  els.push({ kind: "text", x: tx, y: dy + 64, w: W - tx - pad, h: 160, text: copy.headline, font: "serif", size: 50, weight: 800, fill: p.ink, lineHeight: 1.05, maxLines: 3 });
  els.push({ kind: "icon", name: "pin", x: pad, y: dy + 250, w: 40, h: 40, stroke: p.primary, strokeWidth: 2.2 });
  els.push({ kind: "text", x: pad + 56, y: dy + 256, w: W - pad * 2 - 56, h: 40, text: copy.subhead || "11:00am – 11:30am · your suburb", font: "sans", size: 30, weight: 600, fill: p.ink, maxLines: 1 });
  els.push({ kind: "line", x: pad, y: dy + 320, x2: W - pad, y2: dy + 320, stroke: "#e3e0d8", strokeWidth: 2 });
  els.push(...ctaButton(pad, H - 160, W - pad * 2, 96, copy.cta, p.primary, p.onPrimary, stacks));
  return { width: W, height: H, elements: els };
};

// --- 18. SPLIT HORIZON ----------------------------------------------------

const splitHorizon: Builder = ({ width: W, height: H, palette: p, stacks, copy, photo }) => {
  const topH = Math.round(H * 0.46);
  const pad = 72;
  const els: Element[] = [
    { kind: "rect", x: 0, y: 0, w: W, h: topH, gradient: { from: p.primary, to: p.deep, angle: 135 } },
    { kind: "photo", x: 0, y: topH, w: W, h: H - topH, src: photo ?? null, label: photo ? undefined : "Your listing photo", overlay: { from: alpha(p.deep, 0.0), to: alpha(p.deep, 0.18), angle: 90 } },
  ];
  els.push(brandRow(pad, 92, copy.brand, alpha(p.onPrimary, 0.85), stacks));
  els.push(...eyebrow(pad, 170, copy.eyebrow, p.accent, stacks));
  els.push({ kind: "text", x: pad, y: 220, w: W - pad * 2, h: 220, text: copy.headline, font: "serif", size: 78, weight: 800, fill: p.onPrimary, lineHeight: 1.04, maxLines: 3 });
  els.push(...ctaButton(pad, topH - 46, Math.min(W - pad * 2, 520), 92, copy.cta, p.accent, p.onAccent, stacks));
  els.push({ kind: "rect", x: pad, y: H - 150, w: W - pad * 2, h: 86, radius: 18, fill: alpha("#0a1422", 0.55) });
  els.push({ kind: "text", x: pad + 28, y: H - 128, w: W - pad * 2 - 56, h: 60, text: copy.subhead, font: "sans", size: 27, weight: 500, fill: "#ffffff", lineHeight: 1.25, maxLines: 2 });
  return { width: W, height: H, elements: els };
};

export const COMPOSITIONS: Record<CompositionId, Builder> = {
  split,
  bannerArch,
  typeLed,
  valueForm,
  marketStat,
  checklist,
  framedPolaroid,
  bottomBar,
  posterGradient,
  magazineCover,
  statTriple,
  gridFour,
  quoteProof,
  appraisalSeal,
  ribbonSold,
  sidebarIndex,
  eventCard,
  splitHorizon,
};

export const COMPOSITION_IDS = Object.keys(COMPOSITIONS) as CompositionId[];

export function buildComposition(id: CompositionId, ctx: CompositionContext): Scene {
  return (COMPOSITIONS[id] ?? split)(ctx);
}
