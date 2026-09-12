export const STUDY_AD_SCALE = 0.78;
const DESKTOP_SIDE_PAD = 72;
const PANEL_GAP = 28;
const PANEL_MAX_WIDTH = 330;

export type StudyAdMotion = { x: number; y: number; scale: number };

type StudyAdMotionInput = {
  stageWidth: number;
  stageHeight: number;
  adWidth: number;
  adHeight: number;
  narrow: boolean;
  customise: boolean;
};

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

  const scaledWidth = adWidth * STUDY_AD_SCALE;
  const panelWidth = Math.min(stageWidth * 0.36, PANEL_MAX_WIDTH);
  const targetX = narrow
    ? 16
    : Math.max(
        24,
        Math.min(
          stageWidth * 0.08,
          stageWidth - DESKTOP_SIDE_PAD - panelWidth - PANEL_GAP - scaledWidth,
        ),
      );
  const targetY = narrow
    ? 24
    : Math.max(24, (stageHeight - adHeight * STUDY_AD_SCALE) / 2);

  return { x: targetX, y: targetY, scale: STUDY_AD_SCALE };
}
