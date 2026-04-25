"use client";

import type { AISpeakingProps } from "../PhraseDisplay.types";

export const AISpeaking = ({
  isLoading,
  isAudioPlaying,
  englishQuestion,
  spanishLine,
}: AISpeakingProps): JSX.Element => (
  <div className="flex-1 flex flex-col items-center justify-center animate-screen-fade-in">
    <div className="relative flex items-center justify-center">
      <div
        className={`absolute w-[120px] h-[120px] rounded-full border-2 border-[#7F77DD] ${
          isAudioPlaying ? "animate-pulse-ring" : "opacity-0"
        }`}
      />
      <div
        className={`absolute w-[120px] h-[120px] rounded-full border-2 border-[#7F77DD] ${
          isAudioPlaying ? "animate-pulse-ring-delayed" : "opacity-0"
        }`}
      />

      <div
        className={`relative w-[120px] h-[120px] rounded-full flex items-center justify-center ${
          isLoading ? "bg-[#7F77DD]/40" : "bg-[#7F77DD]"
        } ${isAudioPlaying ? "animate-breathe" : ""}`}
      >
        {isLoading ? (
          <svg
            className="animate-spin h-6 w-6 text-white/70"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        ) : (
          <span className="text-white text-xs font-medium tracking-wider uppercase">AI</span>
        )}
      </div>
    </div>
    {englishQuestion || spanishLine ? (
      <div className="mt-10 flex flex-col items-center gap-2 max-w-[90%]">
        {englishQuestion ? (
          <p className="text-center text-[15px] text-gray-500 leading-snug">
            {englishQuestion}
          </p>
        ) : null}
        {spanishLine ? (
          <p className="text-center text-[20px] font-medium text-[#1D1D1D] leading-snug">
            {spanishLine}
          </p>
        ) : null}
      </div>
    ) : null}
  </div>
);
