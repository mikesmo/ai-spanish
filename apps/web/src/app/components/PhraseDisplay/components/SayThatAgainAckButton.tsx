"use client";

import { FEEDBACK_AUTO_ADVANCE_MS } from "@ai-spanish/logic";
import { useEffect, useRef } from "react";

const DEFAULT_LABEL = "Say that again";

const pillShellClassName =
  "relative w-full overflow-hidden rounded-full h-[54px] flex items-center justify-center shadow-sm";

const pillSecondaryClassName = `${pillShellClassName} bg-pill-secondary border border-pill-border`;

export interface SayThatAgainAckButtonProps {
  isReplayPlaying: boolean;
  onSayAgain: () => void;
  onAckOkay: () => void;
  /** Visible label; default "Say that again". */
  label?: string;
  /** Progress + timeout duration in ms; default 2000 (recording screen). */
  autoAdvanceMs?: number;
}

/**
 * Full-width pill: progress fill then `onAckOkay`; tap clears timer and runs `onSayAgain`.
 * When `isReplayPlaying`, shows a disabled pill (explain replay in flight).
 */
export const SayThatAgainAckButton = ({
  isReplayPlaying,
  onSayAgain,
  onAckOkay,
  label = DEFAULT_LABEL,
  autoAdvanceMs = FEEDBACK_AUTO_ADVANCE_MS,
}: SayThatAgainAckButtonProps): JSX.Element => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAckOkayRef = useRef(onAckOkay);
  const onSayAgainRef = useRef(onSayAgain);
  onAckOkayRef.current = onAckOkay;
  onSayAgainRef.current = onSayAgain;

  const shouldRunTimer = !isReplayPlaying;

  useEffect(() => {
    if (!shouldRunTimer) return;
    timerRef.current = setTimeout(() => onAckOkayRef.current(), autoAdvanceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [shouldRunTimer, autoAdvanceMs]);

  const handleClick = () => {
    if (isReplayPlaying) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    onSayAgainRef.current();
  };

  if (isReplayPlaying) {
    return (
      <button type="button" disabled className={pillSecondaryClassName}>
        <span className="relative z-10 text-[16px] font-medium text-pill-secondary-foreground opacity-50">
          {label}
        </span>
      </button>
    );
  }

  return (
    <button type="button" onClick={handleClick} className={pillSecondaryClassName}>
      <span
        key={`${shouldRunTimer}-${autoAdvanceMs}`}
        className="absolute inset-y-0 left-0 bg-[#A8DDD0]"
        style={{
          animation: `progress-fill ${autoAdvanceMs}ms linear forwards`,
        }}
      />
      <span className="relative z-10 text-[16px] font-medium text-pill-secondary-foreground">{label}</span>
    </button>
  );
};
