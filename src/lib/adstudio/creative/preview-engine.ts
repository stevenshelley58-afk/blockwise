// Shared creative composition engine.
//
// One element model + one SVG renderer that drives BOTH the template-picker
// preview (placeholder photo + sample copy) and, via to-canvas mapping, the
// real editable ad. Keeping a single renderer means "what you pick is what you
// get to edit" — no preview/engine drift.
//
// Pure, dependency-free TypeScript so it runs in the browser, in Node, and in
// the test harness alike.

export type Align = "left" | "center" | "right";
export type FontKind = "display" | "serif" | "script" | "sans" | "mono";
export type ClipShape = "rect" | "circle" | "arch";

export type Shadow = { dx: number; dy: number; blur: number; color: string };
export type Gradient = { from: string; to: string; angle?: number };

type Box = { x: number; y: number; w: number; h: number };

export type RectEl = Box & {
  kind: "rect";
  fill?: string;
  gradient?: Gradient;
  radius?: number;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  shadow?: Shadow;
  rotate?: number;
};

export type EllipseEl = Box & {
  kind: "ellipse";
  fill?: string;
  gradient?: Gradient;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  shadow?: Shadow;
};

export type LineEl = {
  kind: "line";
  x: number;
  y: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  opacity?: number;
  dash?: string;
};

export type TextEl = Box & {
  kind: "text";
  text: string;
  font: FontKind;
  size: number;
  weight?: number;
  italic?: boolean;
  fill: string;
  align?: Align;
  tracking?: number; // letter-spacing px
  lineHeight?: number;
  maxLines?: number;
  upper?: boolean;
  shadow?: Shadow;
  rotate?: number;
  role?: "headline" | "subheadline" | "eyebrow" | "cta" | "stat" | "body" | "brand";
};

export type PhotoEl = Box & {
  kind: "photo";
  src?: string | null;
  radius?: number;
  clip?: ClipShape;
  label?: string;
  overlay?: Gradient | null; // gradient scrim on top of the photo
  stroke?: string;
  strokeWidth?: number;
  shadow?: Shadow;
  role?: "primary_image";
};

export type IconName = "bed" | "bath" | "car" | "area" | "check" | "pin" | "star" | "phone" | "arrow" | "key" | "home";
export type IconEl = Box & {
  kind: "icon";
  name: IconName;
  stroke: string;
  strokeWidth?: number;
  fill?: string;
  opacity?: number;
};

export type Element = RectEl | EllipseEl | LineEl | TextEl | PhotoEl | IconEl;

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export type Palette = {
  primary: string;
  accent: string;
  deep: string; // darkened primary
  ink: string; // near-black text
  paper: string; // light surface
  tint: string; // very light primary tint
  mute: string; // muted grey text
  onPrimary: string; // text colour on primary
  onAccent: string; // text colour on accent
};

const HEX6 = /^#?[0-9a-fA-F]{6}$/u;

export function normHex(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const v = value.trim();
  if (HEX6.test(v)) return v.startsWith("#") ? v.toLowerCase() : `#${v.toLowerCase()}`;
  return fallback;
}

function toRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}
function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("")}`;
}
export function mix(a: string, b: string, t: number): string {
  const ca = toRgb(a);
  const cb = toRgb(b);
  return toHex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
}
export function darken(hex: string, t: number): string {
  return mix(hex, "#000000", t);
}
export function lighten(hex: string, t: number): string {
  return mix(hex, "#ffffff", t);
}
export function alpha(hex: string, a: number): string {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => c / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function readableOn(bg: string): string {
  return luminance(bg) > 0.55 ? "#10151f" : "#ffffff";
}

export function buildPalette(primaryRaw: string | null | undefined, accentRaw: string | null | undefined): Palette {
  const primary = normHex(primaryRaw, "#14314f");
  let accent = normHex(accentRaw, "#e7b24b");
  // Ensure the accent is distinct from the primary; if too close, shift towards warm gold.
  if (Math.abs(luminance(accent) - luminance(primary)) < 0.12) {
    accent = luminance(primary) > 0.5 ? darken(accent, 0.25) : lighten(accent, 0.1);
  }
  return {
    primary,
    accent,
    deep: darken(primary, 0.45),
    ink: "#10151f",
    paper: "#f6f3ec",
    tint: lighten(primary, 0.86),
    mute: "#6b7280",
    onPrimary: readableOn(primary),
    onAccent: readableOn(accent),
  };
}

// ---------------------------------------------------------------------------
// Fonts + text measurement
// ---------------------------------------------------------------------------

export type FontStacks = { display: string; serif: string; script: string; sans: string; mono: string };

export function fontStacks(headingFont?: string | null, bodyFont?: string | null): FontStacks {
  const h = headingFont && headingFont.trim() ? `'${headingFont.trim()}', ` : "";
  const b = bodyFont && bodyFont.trim() ? `'${bodyFont.trim()}', ` : "";
  return {
    display: `${h}'Archivo Black', 'Poppins', 'Helvetica Neue', Arial, sans-serif`,
    serif: `${h}'Playfair Display', Georgia, 'Times New Roman', serif`,
    script: `'Pinyon Script', 'Brush Script MT', 'Segoe Script', cursive`,
    sans: `${b}'Inter', 'Helvetica Neue', Arial, sans-serif`,
    mono: `'IBM Plex Mono', 'Courier New', monospace`,
  };
}

// Average glyph-width factors (relative to font size) used for wrapping.
const WIDTH_FACTOR: Record<FontKind, number> = {
  display: 0.62,
  serif: 0.5,
  script: 0.42,
  sans: 0.53,
  mono: 0.6,
};

export function wrapText(text: string, maxWidth: number, size: number, font: FontKind, maxLines: number): string[] {
  const factor = WIDTH_FACTOR[font];
  const words = text.replace(/\s+/gu, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const cand = cur ? `${cur} ${word}` : word;
    if (cand.length * size * factor <= maxWidth || !cur) {
      cur = cand;
    } else {
      lines.push(cur);
      cur = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // ellipsise overflow
  const used = lines.join(" ").split(" ").length;
  if (used < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length && (last.length + 1) * size * factor > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.replace(/[\s.,;:]+$/u, "")}…`;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export type Scene = { width: number; height: number; background?: string; elements: Element[] };

function esc(s: string): string {
  return String(s)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

let defCounter = 0;
function uid(prefix: string): string {
  defCounter += 1;
  return `${prefix}${defCounter}`;
}

function gradStop(g: Gradient, id: string): string {
  const angle = ((g.angle ?? 90) % 360) * (Math.PI / 180);
  const x2 = Math.round(50 + 50 * Math.cos(angle));
  const y2 = Math.round(50 + 50 * Math.sin(angle));
  const x1 = 100 - x2;
  const y1 = 100 - y2;
  return `<linearGradient id="${id}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%"><stop offset="0" stop-color="${g.from}"/><stop offset="1" stop-color="${g.to}"/></linearGradient>`;
}

function shadowFilter(s: Shadow, id: string): string {
  return `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="${s.dx}" dy="${s.dy}" stdDeviation="${s.blur}" flood-color="${s.color}"/></filter>`;
}

function fontFamily(stacks: FontStacks, font: FontKind): string {
  return stacks[font];
}

const ICON_PATHS: Record<IconName, string> = {
  bed: "M3 12 V7 a1 1 0 0 1 1-1 h7 a3 3 0 0 1 3 3 v3 M3 12 h18 v5 M3 17 v2 M21 17 v2 M3 12 v-2",
  bath: "M4 12 h16 v3 a3 3 0 0 1-3 3 H7 a3 3 0 0 1-3-3 z M6 12 V6 a2 2 0 0 1 4 0",
  car: "M4 14 l2-5 a2 2 0 0 1 2-1 h8 a2 2 0 0 1 2 1 l2 5 M4 14 h16 v3 H4 z M7 17 v2 M17 17 v2",
  area: "M4 4 h16 v16 H4 z M4 9 h16 M9 4 v16",
  check: "M4 12 l5 5 L20 6",
  pin: "M12 22 s7-7 7-12 a7 7 0 0 0-14 0 c0 5 7 12 7 12 z M12 8 a2.5 2.5 0 1 0 0 5 a2.5 2.5 0 0 0 0-5",
  star: "M12 3 l2.7 6 6.3.6 -4.8 4.2 1.5 6.2 L12 16.8 6.3 20 7.8 13.8 3 9.6 9.3 9 z",
  phone: "M5 4 h4 l2 5 -2.5 1.5 a11 11 0 0 0 5 5 L20 14 l5 2 v4 a2 2 0 0 1-2 2 A17 17 0 0 1 3 6 a2 2 0 0 1 2-2",
  arrow: "M4 12 h15 M13 6 l6 6 -6 6",
  key: "M14 7 a4 4 0 1 0 0 8 a4 4 0 0 0 0-8 M14 11 H4 M7 11 v3 M10 11 v2",
  home: "M3 11 L12 4 l9 7 M5 10 v9 h14 v-9",
};

function renderElement(el: Element, stacks: FontStacks, defs: string[]): string {
  switch (el.kind) {
    case "rect": {
      let fill = el.fill ?? "none";
      if (el.gradient) {
        const id = uid("g");
        defs.push(gradStop(el.gradient, id));
        fill = `url(#${id})`;
      }
      let filter = "";
      if (el.shadow) {
        const id = uid("s");
        defs.push(shadowFilter(el.shadow, id));
        filter = ` filter="url(#${id})"`;
      }
      const stroke = el.stroke ? ` stroke="${el.stroke}" stroke-width="${el.strokeWidth ?? 2}"` : "";
      const op = el.opacity != null ? ` opacity="${el.opacity}"` : "";
      const r = el.radius ? ` rx="${el.radius}" ry="${el.radius}"` : "";
      const transform = el.rotate ? ` transform="rotate(${el.rotate} ${el.x + el.w / 2} ${el.y + el.h / 2})"` : "";
      return `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}"${r} fill="${fill}"${stroke}${op}${filter}${transform}/>`;
    }
    case "ellipse": {
      let fill = el.fill ?? "none";
      if (el.gradient) {
        const id = uid("g");
        defs.push(gradStop(el.gradient, id));
        fill = `url(#${id})`;
      }
      let filter = "";
      if (el.shadow) {
        const id = uid("s");
        defs.push(shadowFilter(el.shadow, id));
        filter = ` filter="url(#${id})"`;
      }
      const stroke = el.stroke ? ` stroke="${el.stroke}" stroke-width="${el.strokeWidth ?? 2}"` : "";
      const op = el.opacity != null ? ` opacity="${el.opacity}"` : "";
      return `<ellipse cx="${el.x + el.w / 2}" cy="${el.y + el.h / 2}" rx="${el.w / 2}" ry="${el.h / 2}" fill="${fill}"${stroke}${op}${filter}/>`;
    }
    case "line": {
      const op = el.opacity != null ? ` opacity="${el.opacity}"` : "";
      const dash = el.dash ? ` stroke-dasharray="${el.dash}"` : "";
      return `<line x1="${el.x}" y1="${el.y}" x2="${el.x2}" y2="${el.y2}" stroke="${el.stroke}" stroke-width="${el.strokeWidth}" stroke-linecap="round"${dash}${op}/>`;
    }
    case "icon": {
      const op = el.opacity != null ? ` opacity="${el.opacity}"` : "";
      const scale = el.w / 24;
      const path = ICON_PATHS[el.name];
      return `<g transform="translate(${el.x} ${el.y}) scale(${scale})" fill="${el.fill ?? "none"}" stroke="${el.stroke}" stroke-width="${(el.strokeWidth ?? 2) / scale}" stroke-linecap="round" stroke-linejoin="round"${op}><path d="${path}"/></g>`;
    }
    case "photo": {
      const radius = el.radius ?? 0;
      const out: string[] = [];
      let filter = "";
      if (el.shadow) {
        const id = uid("s");
        defs.push(shadowFilter(el.shadow, id));
        filter = ` filter="url(#${id})"`;
      }
      const clipId = uid("c");
      if (el.clip === "circle") {
        defs.push(`<clipPath id="${clipId}"><circle cx="${el.x + el.w / 2}" cy="${el.y + el.h / 2}" r="${Math.min(el.w, el.h) / 2}"/></clipPath>`);
      } else if (el.clip === "arch") {
        const r = el.w / 2;
        defs.push(`<clipPath id="${clipId}"><path d="M${el.x} ${el.y + el.h} V${el.y + r} A${r} ${r} 0 0 1 ${el.x + el.w} ${el.y + r} V${el.y + el.h} Z"/></clipPath>`);
      } else {
        defs.push(`<clipPath id="${clipId}"><rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="${radius}" ry="${radius}"/></clipPath>`);
      }

      if (el.src) {
        out.push(`<image x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" href="${esc(el.src)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"${filter}/>`);
      } else {
        // Placeholder: soft tinted panel + house glyph + label.
        const gid = uid("g");
        defs.push(gradStop({ from: "#e9edf2", to: "#d7dee7", angle: 120 }, gid));
        out.push(`<g clip-path="url(#${clipId})"${filter}><rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" fill="url(#${gid})"/>`);
        const cx = el.x + el.w / 2;
        const cy = el.y + el.h / 2 - (el.label ? 14 : 0);
        const s = Math.min(el.w, el.h) * 0.22;
        out.push(`<g transform="translate(${cx - s / 2} ${cy - s / 2}) scale(${s / 24})" fill="none" stroke="#9aa7b5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON_PATHS.home}"/></g>`);
        if (el.label) {
          out.push(`<text x="${cx}" y="${el.y + el.h - 26}" font-family="${stacks.sans}" font-size="26" fill="#8b97a4" text-anchor="middle">${esc(el.label)}</text>`);
        }
        out.push(`</g>`);
      }
      if (el.overlay) {
        const gid = uid("g");
        defs.push(gradStop(el.overlay, gid));
        out.push(`<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="${radius}" ry="${radius}" fill="url(#${gid})" clip-path="url(#${clipId})"/>`);
      }
      if (el.stroke) {
        out.push(`<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="${radius}" ry="${radius}" fill="none" stroke="${el.stroke}" stroke-width="${el.strokeWidth ?? 3}"/>`);
      }
      return out.join("");
    }
    case "text": {
      const family = fontFamily(stacks, el.font);
      const weight = el.weight ?? (el.role === "headline" ? 800 : 600);
      const italic = el.italic ? ` font-style="italic"` : "";
      const tracking = el.tracking != null ? ` letter-spacing="${el.tracking}"` : "";
      const anchor = el.align === "center" ? "middle" : el.align === "right" ? "end" : "start";
      const ax = el.align === "center" ? el.x + el.w / 2 : el.align === "right" ? el.x + el.w : el.x;
      const lineHeight = el.lineHeight ?? 1.12;
      const lines = wrapText(el.upper ? el.text.toUpperCase() : el.text, el.w, el.size, el.font, el.maxLines ?? 3);
      let filter = "";
      if (el.shadow) {
        const id = uid("s");
        defs.push(shadowFilter(el.shadow, id));
        filter = ` filter="url(#${id})"`;
      }
      const lh = Math.round(el.size * lineHeight);
      // baseline of first line
      const y0 = el.y + Math.round(el.size * 0.82);
      const transform = el.rotate ? ` transform="rotate(${el.rotate} ${ax} ${y0})"` : "";
      return `<text font-family="${family}" font-size="${el.size}" font-weight="${weight}" fill="${el.fill}" text-anchor="${anchor}"${italic}${tracking}${filter}${transform}>${lines
        .map((line, i) => `<tspan x="${ax}" y="${y0 + i * lh}">${esc(line)}</tspan>`)
        .join("")}</text>`;
    }
    default:
      return "";
  }
}

export function renderScene(scene: Scene, stacks: FontStacks): string {
  defCounter = 0;
  const defs: string[] = [];
  const body = scene.elements.map((el) => renderElement(el, stacks, defs)).join("");
  const bg = scene.background ? `<rect width="${scene.width}" height="${scene.height}" fill="${scene.background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}"><defs>${defs.join("")}</defs>${bg}${body}</svg>`;
}
