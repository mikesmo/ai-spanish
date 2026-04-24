"use client";

import type { UserRecordingProps } from "../PhraseDisplay.types";

const showAnswerPillClassName =
  "relative w-full overflow-hidden rounded-full bg-white border border-gray-200 h-[54px] flex items-center justify-center shadow-sm";

export const UserRecording = ({
  englishText,
  spanishLine,
  showEnglishInHint = true,
  transcription,
  isRecording,
  isCorrect,
  onShowAnswer,
}: UserRecordingProps): JSX.Element => {
  const showRecordingIndicator = isRecording && !isCorrect;

  return (
  <div className="relative flex-1 flex flex-col items-center justify-between w-full animate-screen-fade-in">
    {showRecordingIndicator ? (
      <div className="absolute top-0 right-0 z-10 flex items-center gap-2">
        <div className="w-[10px] h-[10px] rounded-full bg-[#1D9E75] animate-recording-blink" />
        <p className="text-[12px] text-gray-400">Recording</p>
      </div>
    ) : null}

    <div className="relative flex-1 w-full min-h-0">
      <div className="absolute left-1/2 top-1/2 w-full -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
      {isCorrect ? (
        <div className="flex items-center justify-center gap-2 mb-6 shrink-0">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="#1D9E75"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points="7.5 12 10.5 15.5 16.5 8.5"
              stroke="#1D9E75"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p className="text-[18px] text-[#1D9E75]">bien hecho!</p>
        </div>
      ) : null}

      <div
        className={`w-[120px] h-[120px] rounded-full flex items-center justify-center animate-breathe-fast shrink-0 ${
          isCorrect ? "bg-[#1D9E75]/70" : "bg-[#1D9E75]"
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <line x1="8" y1="22" x2="16" y2="22" />
        </svg>
      </div>

      {spanishLine ? (
        <div className="mt-6 flex max-w-[280px] flex-col items-center gap-1">
          {showEnglishInHint ? (
            <p className="text-center text-[15px] leading-snug text-gray-500">{englishText}</p>
          ) : null}
          <p className="text-center text-[18px] font-medium leading-relaxed text-[#1D1D1D]">
            {spanishLine}
          </p>
        </div>
      ) : (
        <p
          className="mt-6 max-w-[280px] text-center text-[15px] text-gray-400"
          style={{ opacity: 0.45 }}
        >
          {englishText}
        </p>
      )}

      <div className="mt-6 min-h-[28px] flex items-center justify-center px-4">
        <p className={`text-[18px] text-center ${isCorrect ? "text-[#1D9E75]" : "text-gray-500"}`}>
          {transcription}
        </p>
      </div>
      </div>
    </div>

    <div className="flex flex-col items-center w-full">
      <button type="button" onClick={onShowAnswer} className={showAnswerPillClassName}>
        <span className="relative z-10 text-[16px] font-medium text-gray-900">show answer</span>
      </button>
    </div>
  </div>
  );
};
