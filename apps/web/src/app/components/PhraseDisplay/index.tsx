"use client";

import { useMemo, useState } from "react";
import { runPhraseFeedbackNext, usePhraseDisplay } from "@ai-spanish/logic";
import { useS3TTS, useSTT } from "@ai-spanish/ai";
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

  /**
   * Map each phrase id to its original deck index so we can tell
   * `usePhraseDisplay` (and therefore the S3 TTS adapter) which audio clips
   * to request. Without this, the queue-driven 1-element `session.phrases`
   * array always resolves to `currentIndex === 0` and every prompt would
   * replay the first phrase's audio. See `ttsPhraseIndex` in
   * `UsePhraseDisplayOptions`.
   */
  const deckIndexById = useMemo(() => {
    const m = new Map<string, number>();
    phrases.forEach((p, i) => m.set(p.id, i));
    return m;
  }, [phrases]);
  const ttsPhraseIndex = deckIndexById.get(session.currentPhrase.id) ?? 0;

  const display = usePhraseDisplay(session.phrases, stt, tts, {
    playSuccessChime,
    onPhraseEvent: session.onPhraseEvent,
    onPresentationStart: session.onPresentationStart,
    presentationVersion: session.presentationVersion,
    ttsPhraseIndex,
  });

  // Keep the session-history phrase pointer in sync with whichever phrase is
  // currently on screen. Ref writes during render are safe — no state updates.
  session.bindCurrentPhrase(display.currentPhrase);

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
          isLoading={display.status === "loading"}
          isAudioPlaying={display.isAudioPlaying}
          englishQuestion={
            display.status === "pronunciationExample"
              ? display.currentPhrase.English.question
              : undefined
          }
          spanishLine={
            display.status === "pronunciationExample"
              ? display.spanishText
              : undefined
          }
        />
      )}

      {(display.status === "recording" || display.status === "tryAgain") && (
        <UserRecording
          englishText={display.currentPhrase.English.question}
          spanishLine={
            display.currentPhrase.type === "new" &&
            !display.hasUsedTryAgainOnCurrentCard
              ? display.spanishText
              : undefined
          }
          transcription={display.caption}
          isRecording={stt.isRecording}
          isCorrect={display.isCorrect}
          onShowAnswer={display.handleShowAnswer}
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
