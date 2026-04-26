"use client";

import type { AISpeakingProps } from "../PhraseDisplay.types";

export const AISpeaking = ({
  isLoading,
  isAudioPlaying,
  englishQuestion,
  spanishLine,
}: AISpeakingProps): JSX.Element => (
  <div className="relative flex-1 w-full min-h-0 flex flex-col items-center animate-screen-fade-in">
    <div className="absolute left-1/2 top-[40%] z-[1] w-[120px] h-[120px] -translate-x-1/2 -translate-y-1/2">
      <div className="relative flex h-full w-full items-center justify-center">
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
    </div>
    {englishQuestion || spanishLine ? (
      <div className="absolute left-1/2 top-[calc(40%_+_60px_+_1.5rem)] w-full max-w-[90%] -translate-x-1/2 flex flex-col items-center gap-2 px-0">
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
