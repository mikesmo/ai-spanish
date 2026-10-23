"use client";

interface AutoAdvancePauseToggleProps {
  isPaused: boolean;
  onToggle: () => void;
}

const pillShellClassName =
  "relative w-full overflow-hidden rounded-full h-[54px] flex items-center justify-center shadow-sm";

/** Full-width pause control for an auto-advance timer (green when paused). */
export const AutoAdvancePauseToggle = ({
  isPaused,
  onToggle,
}: AutoAdvancePauseToggleProps): JSX.Element => (
  <button
    type="button"
    onClick={onToggle}
    aria-label={isPaused ? "Resume auto-advance" : "Pause auto-advance"}
    title={isPaused ? "Resume auto-advance" : "Pause auto-advance"}
    className={`${pillShellClassName} transition-all ${
      isPaused
        ? "border border-[#1D9E75] bg-[#E1F5EE]"
        : "border border-pill-border bg-pill-secondary hover:border-[#1D9E75]"
    }`}
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={isPaused ? "#1D9E75" : "#6b7280"}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  </button>
);
