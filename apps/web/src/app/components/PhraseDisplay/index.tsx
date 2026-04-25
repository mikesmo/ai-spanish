"use client";

import { useState } from "react";
import {
  getAisSpeakingViewModel,
  getUserRecordingViewModel,
  runPhraseFeedbackNext,
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

export const PhraseDisplay = ({ phrases }: PhraseDisplayProps): JSX.Element => {
  const tts = useS3TTS();
  const stt = useSTT();
  const session = useLessonSession(phrases);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const { display } = usePhraseDisplayWithDeck(phrases, session, stt, tts, {
    playSuccessChime,
    playRecordingPrimingAudio,
  });

  session.bindCurrentPhrase(display.currentPhrase);

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
  });

  return (
    <div className="w-full max-w-[390px] mx-auto bg-white flex flex-col min-h-[100dvh] py-16 px-8">
      <p className="text-[13px] text-gray-400 self-end mb-8 shrink-0">
        {session.isComplete
          ? "session complete"
          : `${session.remaining} left`}
      </p>

      <div className="flex-1 flex flex-col min-h-0 w-full">
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
