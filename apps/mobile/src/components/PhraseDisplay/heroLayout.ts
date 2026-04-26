/** @see `LayoutChangeEvent` `nativeEvent.layout` */
export type PhraseStageLayout = { width: number; height: number; x: number; y: number };

/** Matches web `h-[120px] w-[120px]` hero. */
export const HERO_CIRCLE_SIZE = 120;

/** 1.5rem at default scale; matches `UserRecording` / `AISpeaking` web gap. */
export const HERO_GAP_PX = 24;

/** Center of the hero circle at 40% of the stage height (matches `top-[40%]` on web). */
const HERO_FRACTION = 0.4;

export type PhraseHeroLayout = {
  stageWidth: number;
  stageHeight: number;
  centerY: number;
  circleLeft: number;
  circleTop: number;
  /** Top edge of the “Now you try” / “bien hecho” row (approx. one line, aligned with web `translateY(-100%)`). */
  aboveCircleLabelTop: number;
  /** Top edge of English/Spanish (and below) text block, same as web `top-[calc(40%+60px+1.5rem)]`. */
  textBelowTop: number;
};

/**
 * @param size From `onLayout` on the phrase stage (same box web uses for `%` positioning).
 */
export function getPhraseHeroLayout(size: PhraseStageLayout | undefined): PhraseHeroLayout | null {
  if (!size || size.width <= 0 || size.height <= 0) return null;
  const { width, height } = size;
  const r = HERO_CIRCLE_SIZE / 2;
  const centerY = height * HERO_FRACTION;
  /** Reserve ~1 line (11px label / single row) so it sits just above the circle, matching web. */
  const oneLine = 22;
  return {
    stageWidth: width,
    stageHeight: height,
    centerY,
    circleLeft: (width - HERO_CIRCLE_SIZE) / 2,
    circleTop: centerY - r,
    aboveCircleLabelTop: centerY - r - HERO_GAP_PX - oneLine,
    textBelowTop: centerY + r + HERO_GAP_PX,
  };
}
