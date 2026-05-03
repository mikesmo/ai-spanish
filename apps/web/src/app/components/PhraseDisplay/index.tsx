"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getAisSpeakingViewModel,
  getUserRecordingViewModel,
  getLessonTitle,
  runPhraseFeedbackNext,
  s3LessonFolderForTranscriptLessonId,
  useLessonSessionWithHistory,
  usePhraseDisplayWithDeck,
} from "@ai-spanish/logic";
import { useS3TTS, useSTT } from "@ai-spanish/ai";
import { playSuccessChime } from "@/lib/playSuccessChime";
import { AISpeaking } from "./components/AISpeaking";
import { UserFeedback } from "./components/UserFeedback";
import { UserRecording } from "./components/UserRecording";
import { HistorySidebar, HistoryToggle } from "../HistorySidebar";
import type { PhraseDisplayProps } from "./PhraseDisplay.types";

export const PhraseDisplay = ({
  phrases,
  lessonId,
}: PhraseDisplayProps): JSX.Element => {
  const tts = useS3TTS();
  const stt = useSTT();
  const session = useLessonSessionWithHistory(phrases);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const lessonTitle = getLessonTitle(lessonId);

  const { display } = usePhraseDisplayWithDeck(phrases, session, stt, tts, {
    playSuccessChime,
    s3LessonSegment: s3LessonFolderForTranscriptLessonId(lessonId),
  });

  const { bindCurrentPhrase } = session;
  useEffect(() => {
    bindCurrentPhrase(display.currentPhrase);
  }, [display.currentPhrase, bindCurrentPhrase]);

  const ais = getAisSpeakingViewModel({
    status: display.status,
    isAudioPlaying: display.isAudioPlaying,
    currentPhrase: display.currentPhrase,
    spanishText: display.spanishText,
    isFirstSessionPresentationOfCurrentPhrase:
      display.isFirstSessionPresentationOfCurrentPhrase,
  });

  const recording = getUserRecordingViewModel({
    currentPhrase: display.currentPhrase,
    spanishText: display.spanishText,
    isFirstSessionPresentationOfCurrentPhrase:
      display.isFirstSessionPresentationOfCurrentPhrase,
    hasUsedTryAgainOnCurrentCard: display.hasUsedTryAgainOnCurrentCard,
    lessonDeck: phrases,
  });

  return (
    <div className="w-full max-w-[390px] mx-auto bg-white flex flex-col min-h-[100dvh] py-16 px-8">
      <header className="relative mb-6 flex min-h-10 w-full shrink-0 items-center">
        <Link
          href="/"
          className="absolute left-0 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
          aria-label="Exit lesson"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </Link>
        <h1 className="w-full truncate px-12 text-center text-sm font-medium text-gray-900">
          {lessonTitle}
        </h1>
        <p className="absolute right-0 top-1/2 z-10 max-w-[40%] -translate-y-1/2 text-right text-[13px] whitespace-nowrap text-gray-400">
          {session.isComplete
            ? "session complete"
            : `${session.remaining} left`}
        </p>
      </header>

      <div className="relative flex-1 flex flex-col min-h-0 w-full">
      {(display.status === "loading" ||
        display.status === "idle" ||
        display.status === "pronunciationExample") && (
        <AISpeaking
          isLoading={ais.isLoading}
          isAudioPlaying={ais.isAudioPlaying}
          englishQuestion={ais.englishQuestion}
          spanishLine={ais.spanishLine}
        />
      )}

      {(display.status === "recording" ||
        display.status === "recordingPriming" ||
        display.status === "tryAgain") && (
        <UserRecording
          englishText={recording.englishText}
          spanishLine={recording.spanishLine}
          showSpanishTranslation={recording.showSpanishTranslation}
          showEnglishInHint={recording.showEnglishInHint}
          transcription={display.caption}
          isRecording={stt.isRecording}
          isCorrect={display.isCorrect}
          onShowAnswer={display.handleShowAnswer}
          showMicChrome={display.status !== "recordingPriming"}
        />
      )}

      {display.status === "answer" && !session.isComplete && (
        <UserFeedback
          transcription={display.caption}
          spanishPhrase={display.spanishText}
          isCorrect={display.isCorrect}
          isAudioPlaying={display.isAudioPlaying}
          isExplainAckPending={display.isExplainAckOpen}
          speed={display.speed}
          onSpeedChange={display.setSpeed}
          onReplay={display.handleReplay}
          onTryAgain={display.handleTryAgain}
          onNext={() => {
            runPhraseFeedbackNext(display, session);
          }}
        />
      )}

      {display.isExplainAckOverlayVisible && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Continue after explanation"
          className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
        >
          <div className="w-full rounded-2xl bg-white px-6 pt-6 pb-6 shadow-xl flex flex-col gap-3">
              <button
                type="button"
                disabled={display.isAudioPlaying}
                onClick={() => void display.handleExplainSayAgain()}
                className="w-full rounded-full h-[54px] bg-pill-secondary border border-pill-border flex items-center justify-center shadow-sm transition hover:opacity-90 disabled:opacity-50"
              >
                <span className="text-[16px] font-medium text-pill-secondary-foreground">
                  Say that again
                </span>
              </button>
              <button
                type="button"
                autoFocus
                onClick={display.handleExplainAckOkay}
                className="w-full rounded-full h-[54px] bg-primary border border-primary flex items-center justify-center shadow-sm transition hover:opacity-90"
              >
                <span className="text-[16px] font-medium text-primary-foreground">
                  Okay
                </span>
              </button>
          </div>
        </div>
      )}
      </div>

      <HistoryToggle
        count={session.history.length}
        onClick={() => setIsHistoryOpen(true)}
      />
      <HistorySidebar
        history={session.history}
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onClear={session.clearHistory}
        getLiveSlotsAhead={session.getLiveSlotsAhead}
        queueVersion={session.presentationVersion}
        remainingInSession={session.remaining}
        completedLessonCount={session.completedLessonCount}
      />
    </div>
  );
};
