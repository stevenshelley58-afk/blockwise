export const STUDY_AD_SCALE = 0.78;
export const STUDY_PANEL_GAP = 56;
export const STUDY_PANEL_MAX_WIDTH = 410;
const DESKTOP_SIDE_PAD = 24;
const MOBILE_STACK_GAP = 48;

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
