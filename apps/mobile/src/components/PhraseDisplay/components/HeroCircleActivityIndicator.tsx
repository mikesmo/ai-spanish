import { ActivityIndicator } from "react-native";

/**
 * Recording hero while waiting (priming / mic connect). Solid mint-green between
 * web priming `#A8DDD0` and active mic `#1D9E75` — not the washed-out 40% overlay.
 */
export const HERO_CIRCLE_WAITING_BACKGROUND = "#8CCBB8";

/** Matches `AISpeaking` loading state — use on every hero-circle wait spinner. */
export const HERO_CIRCLE_SPINNER_PROPS = {
  color: "rgba(255,255,255,0.7)",
  size: "small" as const,
};

export const HeroCircleActivityIndicator = (): JSX.Element => (
  <ActivityIndicator {...HERO_CIRCLE_SPINNER_PROPS} />
);
