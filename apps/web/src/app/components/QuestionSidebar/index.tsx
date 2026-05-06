"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSTT } from "@ai-spanish/ai";
import {
  DEFAULT_QUESTION_MAX_RECORD_MS,
  getAvailableLearnerQuestionPresets,
  useLearnerQuestion,
  useQuestionInput,
  type LearnerLastAttempt,
} from "@ai-spanish/logic";
import { postLearnerQuestion } from "@/lib/learnerQuestion";
import { LearnerQuestionAnswerMarkdown } from "./LearnerQuestionAnswerMarkdown";

export interface QuestionSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  phraseId: string;
  englishText: string;
  spanishText: string;
  grammar: string;
  newGrammar?: string;
  newWords?: string;
  lastAttempt?: LearnerLastAttempt | null;
}

/** Full-bleed overlay within PhraseDisplay; below lesson when closed, above when open. History stays z-50 on top. */
export const QuestionSidebar = ({
  isOpen,
  onClose,
  phraseId,
  englishText,
  spanishText,
  grammar,
  newGrammar,
  newWords,
  lastAttempt,
}: QuestionSidebarProps): JSX.Element => {
  const stt = useSTT({ language: "multi" });
  const {
    text: question,
    setText: setQuestion,
    isRecording,
    startRecording,
    stopRecording,
    error: sttError,
  } = useQuestionInput(stt, {
    maxRecordMs: DEFAULT_QUESTION_MAX_RECORD_MS,
  });

  const chat = useLearnerQuestion({
    context: { spanishText, englishText, grammar, newGrammar, newWords, lastAttempt },
    resetKey: phraseId,
    fetchAnswerStream: postLearnerQuestion,
  });

  const availablePresets = useMemo(
    () => getAvailableLearnerQuestionPresets(chat.turns),
    [chat.turns],
  );

  // Whether the compose row is currently visible.
  const [showCompose, setShowCompose] = useState(true);

  // Reset compose row when thread is cleared (phrase change).
  useEffect(() => {
    if (chat.turns.length === 0) {
      setShowCompose(true);
      setQuestion("");
    }
  }, [chat.turns.length, setQuestion]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom while a turn is streaming.
  const lastTurnAnswer = chat.turns[chat.turns.length - 1]?.answer ?? "";
  useEffect(() => {
    if (!chat.isStreaming) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.isStreaming, lastTurnAnswer]);

  const handlePresetClick = (prompt: string): void => {
    setQuestion(prompt);
  };

  const handleSend = async (): Promise<void> => {
    // If STT is still recording, commit the caption first.
    if (isRecording) {
      stopRecording();
      // Small yield so commitActiveCaption flushes.
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    const q = question.trim();
    if (!q) return;
    setQuestion("");
    setShowCompose(false);
    await chat.sendQuestion(q);
  };

  const handleAskAnother = (): void => {
    setQuestion("");
    setShowCompose(true);
  };

  const lastTurn = chat.turns[chat.turns.length - 1];
  const lastTurnDone = lastTurn && !lastTurn.isStreaming;

  return (
    <div
      aria-hidden={!isOpen}
      className={`absolute inset-0 overflow-hidden ${
        isOpen ? "z-[45] pointer-events-auto" : "z-[30] pointer-events-none"
      }`}
    >
      {/* Opaque backing layer */}
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

        {/* Sticky phrase block */}
        <div className="shrink-0 mx-5 mt-4 rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 flex flex-col gap-1">
          <p className="text-[11px] font-medium uppercase tracking-widest text-gray-400">
            Current phrase
          </p>
          <p className="text-[15px] font-medium text-[#1D9E75] leading-snug">
            {spanishText}
          </p>
          <p className="text-[13px] text-gray-500 leading-snug">{englishText}</p>
        </div>

        {/* Scrollable thread + compose */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto flex flex-col gap-4 px-5 py-4"
        >
          {/* Q&A thread */}
          {chat.turns.map((turn) => (
            <div key={turn.id} className="flex flex-col gap-2">
              {/* User question bubble */}
              <div className="self-end max-w-[85%] rounded-2xl rounded-tr-sm bg-gray-100 px-4 py-2.5">
                <p className="text-[13px] text-gray-800 leading-relaxed">
                  {turn.question}
                </p>
              </div>

              {/* Answer bubble */}
              <div className="self-start max-w-[90%] rounded-2xl rounded-tl-sm bg-[#E8F7F2] border border-[#C2E8D9] px-4 py-3">
                {turn.error ? (
                  <p className="text-[13px] text-red-600 leading-relaxed" role="alert">
                    {turn.error}
                  </p>
                ) : (
                  <div className="relative">
                    <LearnerQuestionAnswerMarkdown>{turn.answer}</LearnerQuestionAnswerMarkdown>
                    {turn.isStreaming ? (
                      <span
                        aria-hidden="true"
                        className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-[#1D9E75] rounded-sm animate-pulse"
                      />
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* "Ask another question" button — shown after last turn finishes */}
          {lastTurnDone && !showCompose && (
            <div className="flex justify-center pt-1 pb-2">
              <button
                type="button"
                onClick={handleAskAnother}
                className="px-5 py-2.5 rounded-full border border-[#1D9E75] text-[#1D9E75] text-[13px] font-medium hover:bg-[#E8F7F2] transition-colors"
              >
                Ask another question
              </button>
            </div>
          )}

          {/* Compose row */}
          {showCompose && (
            <div className="flex flex-col gap-3 pt-1">
              {/* Preset chips — remaining presets whenever compose is open */}
              {availablePresets.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-widest text-gray-400">
                    Quick questions
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {availablePresets.map((prompt) => (
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
              )}

              {/* Text input */}
              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-medium uppercase tracking-widest text-gray-400">
                  {chat.turns.length === 0 ? "Your question" : "Follow-up question"}
                </p>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={3}
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
                {sttError ? (
                  <p className="text-[12px] text-red-600" role="alert">
                    {sttError}
                  </p>
                ) : null}
              </div>

              {/* Send button */}
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={question.trim() === "" || chat.isStreaming}
                className="w-full h-[48px] rounded-full bg-[#1D9E75] text-white text-[15px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#188a65] transition-colors"
              >
                Send question
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
