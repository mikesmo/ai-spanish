"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getAisSpeakingViewModel,
  getUserRecordingViewModel,
  getLessonTitle,
  runPhraseFeedbackNext,
  s3LessonFolderForTranscriptLessonId,
  usePhraseDisplayWithDeck,
} from "@ai-spanish/logic";
import { useS3TTS, useSTT } from "@ai-spanish/ai";
import { playRecordingPrimingAudio } from "@/lib/playRecordingPrimingAudio";
import { playSuccessChime } from "@/lib/playSuccessChime";
import { useLessonSession } from "@/app/hooks/useLessonSession";
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
  const session = useLessonSession(phrases);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const lessonTitle = getLessonTitle(lessonId);

  const { display } = usePhraseDisplayWithDeck(phrases, session, stt, tts, {
    playSuccessChime,
    playRecordingPrimingAudio,
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
          speed={display.speed}
          onSpeedChange={display.setSpeed}
          onReplay={display.handleReplay}
          onTryAgain={display.handleTryAgain}
          onNext={() => {
            runPhraseFeedbackNext(display, session);
          }}
        />
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
