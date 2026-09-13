export const STUDY_NARROW_BREAKPOINT = 560;
export const STUDY_AD_SCALE = 0.78;
export const STUDY_PANEL_GAP = 24;
export const STUDY_PANEL_MAX_WIDTH = 410;
const DESKTOP_SIDE_PAD = 24;
const MOBILE_STACK_GAP = 16;

export type StudyAdMotion = { x: number; y: number; scale: number };
export type StudyEditLayout = { panelLeft: number; panelTop: number; panelWidth: number; gap: number };

type StudyAdMotionInput = {
  stageWidth: number;
  stageHeight: number;
  adWidth: number;
  adHeight: number;
  narrow: boolean;
  customise: boolean;
};

/** Keep the desktop ad and its editor as one centred group, not two unrelated anchors. */
export function studyEditLayout({ stageWidth, adWidth, adHeight, narrow }: Omit<StudyAdMotionInput, "stageHeight" | "customise">): StudyEditLayout {
  const scaledWidth = adWidth * STUDY_AD_SCALE;
  if (narrow) return { panelLeft: 14, panelTop: 24 + adHeight * STUDY_AD_SCALE + MOBILE_STACK_GAP, panelWidth: Math.max(0, stageWidth - 28), gap: MOBILE_STACK_GAP };
  const available = Math.max(0, stageWidth - DESKTOP_SIDE_PAD * 2);
  const panelWidth = Math.min(STUDY_PANEL_MAX_WIDTH, Math.max(0, available - scaledWidth - STUDY_PANEL_GAP));
  const groupWidth = scaledWidth + STUDY_PANEL_GAP + panelWidth;
  const groupLeft = Math.max(DESKTOP_SIDE_PAD, (stageWidth - groupWidth) / 2);
  return { panelLeft: groupLeft + scaledWidth + STUDY_PANEL_GAP, panelTop: 0, panelWidth, gap: STUDY_PANEL_GAP };
}

/** Return top-left stage coordinates for the one persistent ad in each state. */
export function studyAdMotion({
  stageWidth,
  stageHeight,
  adWidth,
  adHeight,
  narrow,
  customise,
}: StudyAdMotionInput): StudyAdMotion {
  const start = {
    x: Math.max(0, (stageWidth - adWidth) / 2),
    y: Math.max(0, (stageHeight - adHeight) / 2),
    scale: 1,
  };

  if (!customise) return start;

  const layout = studyEditLayout({ stageWidth, adWidth, adHeight, narrow });
  const targetX = narrow ? Math.max(16, (stageWidth - adWidth * STUDY_AD_SCALE) / 2) : layout.panelLeft - layout.gap - adWidth * STUDY_AD_SCALE;
  const targetY = narrow
    ? 24
    : Math.max(24, (stageHeight - adHeight * STUDY_AD_SCALE) / 2);

  return { x: targetX, y: targetY, scale: STUDY_AD_SCALE };
}

/** One reversible choreography, shared by every layer. All outputs stay bounded. */
export function studyFrame(progress: number) {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const ad = clamp(progress);
  const updated = clamp((progress - 0.28) / 0.48);
  return {
    ad,
    browse: clamp((progress + 2) / 2),
    shell: 1,
    shellAlpha: 1,
    gallery: 1 - clamp(progress / 0.32),
    panel: clamp((progress - 0.08) / 0.5),
    edit: 1 - clamp(progress - 1),
    review: clamp(progress - 1),
    original: 1 - updated,
    updated,
    approved: clamp(progress - 2),
  };
}

export type StudyFrame = ReturnType<typeof studyFrame>;
/** Interpolate directly to the requested screen, never through an unwanted intermediate screen. */
export function studyTransition(from: StudyFrame, to: StudyFrame, progress: number): StudyFrame {
  const t = Math.max(0, Math.min(1, progress));
  const ramp = (a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));
  const mix = (a: number, b: number, amount = t) => a + (b - a) * amount;
  const fade = (a: number, b: number) => mix(a, b, b > a ? ramp(.45, 1) : ramp(0, .45));
  const entering = to.panel > from.panel;
  const leaving = to.panel < from.panel;
  const edit = from.panel === 0 ? to.edit : from.edit;
  const review = from.panel === 0 ? to.review : from.review;
  const swapping = from.ad === 1 && to.ad === 1 && (from.edit !== to.edit || from.review !== to.review);
  const soften = (v: number) => v * v * (3 - 2 * v);
  const shell = swapping ? (t < .38 ? mix(from.shell, .94, soften(ramp(0, .38))) : mix(.94, 1, soften(ramp(.38, .78)))) : mix(from.shell, 1);
  const shellAlpha = swapping ? (t < .38 ? mix(from.shellAlpha, 0, ramp(0, .38)) : ramp(.38, .7)) : mix(from.shellAlpha, 1);
  const content = (a: number, b: number) => swapping ? mix(a, b, b > a ? ramp(.78, 1) : ramp(0, .25)) : fade(a, b);
  return {
    browse: mix(from.browse, to.browse),
    shell,
    shellAlpha,
    ad: mix(from.ad, to.ad),
    gallery: mix(from.gallery, to.gallery, to.gallery > from.gallery ? ramp(.6, 1) : ramp(0, .35)),
    panel: mix(from.panel, to.panel, entering ? ramp(.08, .7) : leaving ? ramp(0, .45) : t),
    edit: leaving ? from.edit : content(edit, to.edit),
    review: leaving ? from.review : content(review, to.review),
    original: fade(from.original, to.original),
    updated: fade(from.updated, to.updated),
    approved: mix(from.approved, to.approved),
  };
}

/** One character boundary drives both the field and its matching ad text. */
export function studyText(progress: number, text: string, start: number, end: number, fallback = "") {
  if (progress <= start) return fallback;
  return text.slice(0, Math.floor(Math.min(1, (progress - start) / (end - start)) * text.length));
}


/** Equal time per character, with a short breath before each field. */
export function studyTypingSchedule(texts: readonly string[], characterMs: number, gapMs: number) {
  let cursor = 0;
  const ranges = texts.map(text => {
    const start = cursor + gapMs;
    cursor = start + text.length * characterMs;
    return { start, end: cursor };
  });
  const durationMs = cursor;
  return { durationMs, ranges: ranges.map(({ start, end }) => ({ start: start / durationMs, end: end / durationMs })) };
}
