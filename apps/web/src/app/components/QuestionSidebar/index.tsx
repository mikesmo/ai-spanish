"use client";

import { useSTT } from "@ai-spanish/ai";
import {
  DEFAULT_QUESTION_MAX_RECORD_MS,
  LEARNER_QUESTION_PRESET_PROMPTS,
  useQuestionInput,
} from "@ai-spanish/logic";

export interface QuestionSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  englishText: string;
  spanishText: string;
}

/** Full-bleed overlay within PhraseDisplay; below lesson when closed, above when open. History stays z-50 on top. */
export const QuestionSidebar = ({
  isOpen,
  onClose,
  englishText,
  spanishText,
}: QuestionSidebarProps): JSX.Element => {
  const stt = useSTT({ language: "multi" });
  const {
    text: question,
    setText: setQuestion,
    isRecording,
    startRecording,
    stopRecording,
    error,
  } = useQuestionInput(stt, {
    maxRecordMs: DEFAULT_QUESTION_MAX_RECORD_MS,
  });

  const handlePresetClick = (prompt: string): void => {
    setQuestion(prompt);
  };

  return (
    <div
      aria-hidden={!isOpen}
      className={`absolute inset-0 overflow-hidden ${
        isOpen ? "z-[45] pointer-events-auto" : "z-[30] pointer-events-none"
      }`}
    >
      {/* Opaque layer under the sliding panel; behind session history (z-50). Lesson (z-35) covers this when closed. */}
      <div
        className="pointer-events-none absolute inset-0 z-0 bg-white"
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal={isOpen}
        aria-label="Ask about this phrase"
        aria-hidden={!isOpen}
        className={`absolute inset-0 z-[1] flex w-full flex-col bg-white shadow-inner transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <h2 className="text-[14px] font-semibold text-gray-900 tracking-tight">
          Ask about this phrase
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close question panel"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-6 px-5 py-5">
        {/* Phrase block */}
        <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-4 flex flex-col gap-2">
          <p className="text-[11px] font-medium uppercase tracking-widest text-gray-400">
            Current phrase
          </p>
          <p className="text-[16px] font-medium text-[#1D9E75] leading-snug">
            {spanishText}
          </p>
          <p className="text-[13px] text-gray-500 leading-snug">{englishText}</p>
        </div>

        {/* Preset chips */}
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium uppercase tracking-widest text-gray-400">
            Quick questions
          </p>
          <div className="flex flex-wrap gap-2">
            {LEARNER_QUESTION_PRESET_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => handlePresetClick(prompt)}
                className={`px-3 py-1.5 rounded-full border text-[12px] font-medium transition-colors ${
                  question === prompt
                    ? "bg-[#E1F5EE] border-[#1D9E75] text-[#085041]"
                    : "bg-white border-gray-200 text-gray-700 hover:border-[#1D9E75] hover:text-[#085041]"
                }`}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Text input */}
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium uppercase tracking-widest text-gray-400">
            Your question
          </p>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={4}
            placeholder="Type your question here, or use the microphone."
            className="w-full resize-none rounded-xl border border-gray-200 px-3 py-3 text-[14px] text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1D9E75]/40 focus:border-[#1D9E75] transition-colors"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              aria-pressed={isRecording}
              aria-label={isRecording ? "Stop recording question" : "Record question"}
              className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition-colors ${
                isRecording
                  ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                  : "border-gray-200 bg-white text-gray-700 hover:border-[#1D9E75] hover:text-[#085041]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 items-center justify-center rounded-full ${
                  isRecording ? "bg-red-500 text-white animate-pulse" : "bg-[#E1F5EE] text-[#1D9E75]"
                }`}
              >
                {isRecording ? "■" : "●"}
              </span>
              {isRecording ? "Stop" : "Record"}
            </button>
            <span className="text-[12px] text-gray-400">
              {isRecording ? "Listening…" : "Live dictation"}
            </span>
          </div>
          {error ? (
            <p className="text-[12px] text-red-600" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      {/* Footer */}
      <footer className="shrink-0 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 border-t border-gray-100">
        <button
          type="button"
          disabled={question.trim() === ""}
          className="w-full h-[48px] rounded-full bg-[#1D9E75] text-white text-[15px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#188a65] transition-colors"
        >
          Send question
        </button>
      </footer>
    </aside>
    </div>
  );
};
