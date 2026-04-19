"use client";

import { useEffect, useRef } from "react";
import { FEEDBACK_AUTO_ADVANCE_MS } from "@ai-spanish/logic";
import type {
  DiffWordResult,
  UserFeedbackProps,
} from "../PhraseDisplay.types";
import { diffWords } from "../utils/diff-words";

interface AutoNextButtonProps {
  label: string;
  onPress: () => void;
  onTimeout: () => void;
}

const NEXT_PHRASE_LABEL = "Next phrase";

const pillShellClassName =
  "relative w-full overflow-hidden rounded-full h-[54px] flex items-center justify-center shadow-sm";

const pillSecondaryClassName = `${pillShellClassName} bg-pill-secondary border border-pill-border`;
const pillPrimaryClassName = `${pillShellClassName} bg-primary border border-primary`;

interface PillNavButtonProps {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
}

/** Same shell as Continue / Next; no progress layer or timer. */
const PillNavButton = ({
  label,
  onClick,
  variant = "secondary",
}: PillNavButtonProps): JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    className={variant === "primary" ? pillPrimaryClassName : pillSecondaryClassName}
  >
    <span
      className={`relative z-10 text-[16px] font-medium ${
        variant === "primary" ? "text-primary-foreground" : "text-pill-secondary-foreground"
      }`}
    >
      {label}
    </span>
  </button>
);

const AutoNextButton = ({ label, onPress, onTimeout }: AutoNextButtonProps): JSX.Element => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPressRef = useRef(onPress);
  const onTimeoutRef = useRef(onTimeout);
  onPressRef.current = onPress;
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    timerRef.current = setTimeout(() => onTimeoutRef.current(), FEEDBACK_AUTO_ADVANCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    onPressRef.current();
  };

  return (
    <button type="button" onClick={handleClick} className={pillSecondaryClassName}>
      <span className="absolute inset-y-0 left-0 bg-[#A8DDD0] animate-progress-fill" />
      <span className="relative z-10 text-[16px] font-medium text-pill-secondary-foreground">
        {label}
      </span>
    </button>
  );
};

interface ContinueAfterAudioButtonProps {
  isAudioPlaying: boolean;
  onNext: () => void;
}

/** Auto-advance + progress bar only after Spanish TTS has finished; replay restarts this gate. */
const NextPhraseAfterAudioButton = ({
  isAudioPlaying,
  onNext,
}: ContinueAfterAudioButtonProps): JSX.Element => {
  if (isAudioPlaying) {
    return <PillNavButton label={NEXT_PHRASE_LABEL} onClick={onNext} />;
  }

  return <AutoNextButton label={NEXT_PHRASE_LABEL} onPress={onNext} onTimeout={onNext} />;
};

interface AudioControlsProps {
  isAudioPlaying: boolean;
  speed: "1x" | "slow";
  onSpeedChange: (speed: "1x" | "slow") => void;
  onReplay: () => void;
}

const AudioControls = ({
  isAudioPlaying,
  speed,
  onSpeedChange,
  onReplay,
}: AudioControlsProps): JSX.Element => (
  <div className="flex items-center gap-3">
    <button
      onClick={onReplay}
      disabled={isAudioPlaying}
      className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
        isAudioPlaying
          ? "border border-[#1D9E75] bg-[#E1F5EE]"
          : "border-[0.5px] border-gray-300 hover:border-[#1D9E75]"
      }`}
      title={isAudioPlaying ? "Playing..." : "Play pronunciation"}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke={isAudioPlaying ? "#1D9E75" : "#6b7280"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
    </button>

    <div className="h-[30px] rounded-[20px] border-[0.5px] border-gray-300 flex items-center overflow-hidden">
      <button
        onClick={() => onSpeedChange("1x")}
        className={`h-full px-3 text-[12px] font-medium transition-all ${
          speed === "1x" ? "bg-[#E1F5EE] text-[#085041]" : "text-gray-500"
        }`}
      >
        1x
      </button>
      <div className="w-[0.5px] h-4 bg-gray-300" />
      <button
        onClick={() => onSpeedChange("slow")}
        className={`h-full px-3 text-[12px] font-medium transition-all ${
          speed === "slow" ? "bg-[#E1F5EE] text-[#085041]" : "text-gray-500"
        }`}
      >
        slow
      </button>
    </div>
  </div>
);

const renderSpokenWords = (diff: DiffWordResult[] | null): JSX.Element => {
  if (!diff) {
    return <span className="text-gray-400">No answer recorded</span>;
  }

  return (
    <>
      {diff
        .filter(({ type }) => type !== "missing")
        .map(({ word, type }, index) => (
          <span key={`${word}-${index}`}>
            {index > 0 ? " " : ""}
            <span className={type === "wrong" ? "text-[#D85A30]" : "text-gray-800"}>
              {word}
            </span>
          </span>
        ))}
    </>
  );
};

const renderCorrectWords = (
  diff: DiffWordResult[] | null,
  fallbackPhrase: string,
): JSX.Element => {
  if (!diff) {
    return <>{fallbackPhrase}</>;
  }

  return (
    <>
      {diff
        .filter(({ type }) => type !== "wrong")
        .map(({ spanishWord, type }, index) => (
          <span key={`${spanishWord ?? "empty"}-${index}`}>
            {index > 0 ? " " : ""}
            {type === "missing" ? (
              <span className="relative inline-block pb-[3px]">
                {spanishWord}
                <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-[#1D9E75]" />
              </span>
            ) : (
              <span>{spanishWord}</span>
            )}
          </span>
        ))}
    </>
  );
};

export const UserFeedback = ({
  transcription,
  spanishPhrase,
  isCorrect,
  isAudioPlaying,
  speed,
  onSpeedChange,
  onReplay,
  onTryAgain,
  onNext,
}: UserFeedbackProps): JSX.Element => {
  const diff = transcription.trim() ? diffWords(transcription, spanishPhrase) : null;

  return (
    <div className="flex-1 flex flex-col items-center min-h-0 w-full animate-screen-fade-in">
      {isCorrect ? (
        <div className="flex flex-col items-center flex-1 justify-center">
          <p className="text-[18px] text-[#1D9E75] text-center leading-relaxed">{spanishPhrase}</p>
          <div className="mt-4">
            <AudioControls
              isAudioPlaying={isAudioPlaying}
              speed={speed}
              onSpeedChange={onSpeedChange}
              onReplay={onReplay}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-8 flex-1 justify-center">
          <div className="flex flex-col items-center gap-2">
            <p className="text-[11px] text-gray-400 uppercase tracking-wide">You said</p>
            <p className="text-[18px] text-center leading-relaxed">{renderSpokenWords(diff)}</p>
          </div>

          <div className="w-[40px] h-[1px] bg-gray-300" />

          <div className="flex flex-col items-center gap-2">
            <p className="text-[11px] text-gray-400 uppercase tracking-wide">Correct</p>
            <p className="text-[18px] text-gray-800 text-center leading-relaxed">
              {renderCorrectWords(diff, spanishPhrase)}
            </p>
          </div>

          <AudioControls
            isAudioPlaying={isAudioPlaying}
            speed={speed}
            onSpeedChange={onSpeedChange}
            onReplay={onReplay}
          />
        </div>
      )}

      <div className="mt-auto w-full pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {isCorrect ? (
          <NextPhraseAfterAudioButton isAudioPlaying={isAudioPlaying} onNext={onNext} />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <PillNavButton label={NEXT_PHRASE_LABEL} onClick={onNext} variant="secondary" />
            <PillNavButton label="Try again" onClick={onTryAgain} variant="primary" />
       
          </div>
     
        )}
      </div>
    </div>
  );
};
