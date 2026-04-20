"use client";

import { useState } from "react";
import { usePhraseDisplay } from "@ai-spanish/logic";
import { useS3TTS, useSTT } from "@ai-spanish/ai";
import { playSuccessChime } from "@/lib/playSuccessChime";
import { useSessionHistory } from "@/app/hooks/useSessionHistory";
import { AISpeaking } from "./components/AISpeaking";
import { UserFeedback } from "./components/UserFeedback";
import { UserRecording } from "./components/UserRecording";
import { HistorySidebar, HistoryToggle } from "../HistorySidebar";
import type { PhraseDisplayProps } from "./PhraseDisplay.types";

export const PhraseDisplay = ({ phrases }: PhraseDisplayProps): JSX.Element => {
  const tts = useS3TTS();
  const stt = useSTT();
  const { history, onPhraseEvent, bindCurrentPhrase, clearHistory } =
    useSessionHistory();
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const display = usePhraseDisplay(phrases, stt, tts, {
    playSuccessChime,
    onPhraseEvent,
  });

  // Keep the session-history phrase pointer in sync with whichever phrase is
  // currently on screen. Ref writes during render are safe — no state updates.
  bindCurrentPhrase(display.currentPhrase);

  return (
    <div className="w-full max-w-[390px] mx-auto bg-white flex flex-col min-h-[100dvh] py-16 px-8">
      <p className="text-[13px] text-gray-400 self-end mb-8 shrink-0">
        {display.currentIndex + 1} / {display.totalPhrases}
      </p>

      <div className="flex-1 flex flex-col min-h-0 w-full">
      {(display.status === "loading" || display.status === "idle") && (
        <AISpeaking
          isLoading={display.status === "loading"}
          isAudioPlaying={display.isAudioPlaying}
        />
      )}

      {(display.status === "recording" || display.status === "tryAgain") && (
        <UserRecording
          englishText={display.currentPhrase.English.question}
          transcription={display.caption}
          isRecording={stt.isRecording}
          isCorrect={display.isCorrect}
          onShowAnswer={display.handleShowAnswer}
        />
      )}

      {display.status === "answer" && (
        <UserFeedback
          transcription={display.caption}
          spanishPhrase={display.spanishText}
          isCorrect={display.isCorrect}
          isAudioPlaying={display.isAudioPlaying}
          speed={display.speed}
          onSpeedChange={display.setSpeed}
          onReplay={display.handleReplay}
          onTryAgain={display.handleTryAgain}
          onNext={display.handleNext}
        />
      )}
      </div>

      <HistoryToggle
        count={history.length}
        onClick={() => setIsHistoryOpen(true)}
      />
      <HistorySidebar
        history={history}
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onClear={clearHistory}
      />
    </div>
  );
};
