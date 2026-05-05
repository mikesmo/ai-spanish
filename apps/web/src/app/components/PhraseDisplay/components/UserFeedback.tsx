"use client";

import { useEffect, useRef, useState } from "react";
import {
  FEEDBACK_AUTO_ADVANCE_MS,
  diffWords,
  type DiffEntry,
} from "@ai-spanish/logic";
import type { UserFeedbackProps } from "../PhraseDisplay.types";


interface AutoNextButtonProps {
  label: string;
  onPress: () => void;
  onTimeout: () => void;
  isPaused?: boolean;
}

const NEXT_PHRASE_LABEL = "Next phrase";
const QUESTION_PLACEHOLDER_LABEL = "I have a question";

const pillShellClassName =
  "relative w-full overflow-hidden rounded-full h-[54px] flex items-center justify-center shadow-sm";

const pillSecondaryClassName = `${pillShellClassName} bg-pill-secondary border border-pill-border`;
const pillPrimaryClassName = `${pillShellClassName} bg-primary border border-primary`;

interface PillNavButtonProps {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}

/** Same shell as Continue / Next; no progress layer or timer. */
const PillNavButton = ({
  label,
  onClick,
  variant = "secondary",
  disabled = false,
}: PillNavButtonProps): JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`${variant === "primary" ? pillPrimaryClassName : pillSecondaryClassName} disabled:opacity-50`}
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

const AutoNextButton = ({
  label,
  onPress,
  onTimeout,
  isPaused = false,
}: AutoNextButtonProps): JSX.Element => {
  const [progressKey, setProgressKey] = useState(0);
  const wasPausedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPressRef = useRef(onPress);
  const onTimeoutRef = useRef(onTimeout);
  onPressRef.current = onPress;
  onTimeoutRef.current = onTimeout;

  /** When pause is released, remount the progress fill so the animation restarts from zero. */
  useEffect(() => {
    if (!isPaused && wasPausedRef.current) {
      setProgressKey((k) => k + 1);
    }
    wasPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    if (isPaused) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setTimeout(() => onTimeoutRef.current(), FEEDBACK_AUTO_ADVANCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPaused]);

  const handleClick = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    onPressRef.current();
  };

  return (
    <button type="button" onClick={handleClick} className={pillSecondaryClassName}>
      <span
        key={progressKey}
        className="absolute inset-y-0 left-0 bg-[#A8DDD0] animate-progress-fill"
        style={{ animationPlayState: isPaused ? "paused" : "running" }}
      />
      <span className="relative z-10 text-[16px] font-medium text-pill-secondary-foreground">
        {label}
      </span>
    </button>
  );
};

interface ContinueAfterAudioButtonProps {
  isAudioPlaying: boolean;
  onNext: () => void;
  isPaused?: boolean;
}

/** Auto-advance + progress bar only after Spanish TTS is idle. */
const NextPhraseAfterAudioButton = ({
  isAudioPlaying,
  onNext,
  isPaused = false,
}: ContinueAfterAudioButtonProps): JSX.Element => {
  if (isAudioPlaying) {
    return <PillNavButton label={NEXT_PHRASE_LABEL} onClick={onNext} />;
  }

  return (
    <AutoNextButton
      label={NEXT_PHRASE_LABEL}
      onPress={onNext}
      onTimeout={onNext}
      isPaused={isPaused}
    />
  );
};

interface AudioControlsProps {
  isAudioPlaying: boolean;
  /** When true, Spanish replay control stays visually idle — English explain dominates. */
  isEnglishExplainDominatingLessonControls: boolean;
  speed: "1x" | "slow";
  onSpeedChange: (speed: "1x" | "slow") => void;
  onReplay: () => void;
}

const AudioControls = ({
  isAudioPlaying,
  isEnglishExplainDominatingLessonControls,
  speed,
  onSpeedChange,
  onReplay,
}: AudioControlsProps): JSX.Element => {
  const isPlayButtonActive = isAudioPlaying && !isEnglishExplainDominatingLessonControls;
  const playTitle = isPlayButtonActive
    ? "Playing..."
    : isAudioPlaying && isEnglishExplainDominatingLessonControls
      ? "Explanation playing"
      : "Play pronunciation";

  return (
  <div className="flex items-center gap-3">
    <button
      onClick={onReplay}
      disabled={isAudioPlaying}
      className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
        isPlayButtonActive
          ? "border border-[#1D9E75] bg-[#E1F5EE]"
          : "border-[0.5px] border-gray-300 hover:border-[#1D9E75]"
      }`}
      title={playTitle}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke={isPlayButtonActive ? "#1D9E75" : "#6b7280"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="8 5 19 12 8 19 8 5" />
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
};

const renderSpokenWords = (diff: DiffEntry[] | null): JSX.Element => {
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
  diff: DiffEntry[] | null,
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
  isEnglishExplainDominatingLessonControls,
  speed,
  onSpeedChange,
  onReplay,
  onStopAnswerAudio,
  onExplainInterrupted,
  onTryAgain,
  onNext,
  isExplainAckOpen,
  isExplainAckReplayPlaying,
  handleExplainSayAgain,
  learnerQuestionPause,
}: UserFeedbackProps): JSX.Element => {
  const diff = transcription.trim() ? diffWords(transcription, spanishPhrase) : null;
  const explainAckDisabled = isAudioPlaying || isExplainAckReplayPlaying;

  const isQuestionActive = learnerQuestionPause?.isActive ?? false;
  const handleQuestionToggle = learnerQuestionPause?.toggle ?? (() => {});

  const explainAckActions = isExplainAckOpen ? (
    <div className="flex w-full flex-col gap-4">
      <PillNavButton
        label="Explain that again"
        onClick={() => {
          void handleExplainSayAgain();
        }}
        disabled={explainAckDisabled}
      />
    </div>
  ) : null;

  return (
    <div className="flex-1 flex flex-col items-center min-h-0 w-full animate-screen-fade-in">
      <div
        className={`flex flex-1 min-h-0 w-full flex-col items-center ${
          isCorrect ? "justify-center" : "justify-start pt-[120px]"
        }`}
      >
        {isCorrect ? (
          <div className="flex flex-col items-center w-full">
            <p className="text-[18px] text-[#1D9E75] text-center leading-relaxed">{spanishPhrase}</p>
            <div className="mt-6 flex w-full flex-col gap-4">
              <PillNavButton
                label={QUESTION_PLACEHOLDER_LABEL}
                onClick={handleQuestionToggle}
                variant="secondary"
              />
            </div>
            {explainAckActions != null ? (
              <div className="mt-8 flex w-full flex-col items-center">{explainAckActions}</div>
            ) : null}
          </div>
        ) : (
          <div className="flex w-full flex-col items-center">
            <div className="flex flex-col items-center gap-8 w-full">
              <div className="flex flex-col items-center gap-2">
                <p className="text-[18px] text-center leading-relaxed">{renderSpokenWords(diff)}</p>
              </div>

              <div className="w-[40px] h-[1px] bg-gray-300" />

              <div className="flex flex-col items-center gap-2">
                <p className="text-[11px] text-gray-400 uppercase tracking-wide">Correct</p>
                <p className="text-[18px] text-gray-800 text-center leading-relaxed">
                  {renderCorrectWords(diff, spanishPhrase)}
                </p>
              </div>
            </div>

            <div className="pt-4 flex w-full flex-col items-center gap-8">
              <AudioControls
                isAudioPlaying={isAudioPlaying}
                isEnglishExplainDominatingLessonControls={isEnglishExplainDominatingLessonControls}
                speed={speed}
                onSpeedChange={onSpeedChange}
                onReplay={onReplay}
              />

              <div className="flex w-full flex-col gap-4">
                <PillNavButton
                  label={QUESTION_PLACEHOLDER_LABEL}
                  onClick={handleQuestionToggle}
                  variant="secondary"
                />
              </div>

              {explainAckActions}
            </div>
          </div>
        )}
      </div>

      <div
        className={`mt-auto flex w-full flex-col gap-4 pb-[max(1rem,env(safe-area-inset-bottom))] ${
          isExplainAckOpen ? "pt-12" : "pt-6"
        }`}
      >
        {isCorrect ? (
          <NextPhraseAfterAudioButton
            isAudioPlaying={isAudioPlaying}
            onNext={onNext}
            isPaused={isQuestionActive}
          />
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
