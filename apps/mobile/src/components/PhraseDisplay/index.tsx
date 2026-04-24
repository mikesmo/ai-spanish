import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  runPhraseFeedbackNext,
  useLessonSession,
  usePhraseDisplay,
} from "@ai-spanish/logic";
import { useSTT, useS3TTS } from "@ai-spanish/ai";
import { playSuccessChime } from "../../lib/playSuccessChime";
import type { PhraseDisplayProps } from "./PhraseDisplay.types";
import { AISpeaking } from "./components/AISpeaking";
import { UserFeedback } from "./components/UserFeedback";
import { UserRecording } from "./components/UserRecording";

export const PhraseDisplay = ({ phrases }: PhraseDisplayProps): JSX.Element => {
  const tts = useS3TTS();
  const stt = useSTT();
  const session = useLessonSession(phrases);

  /**
   * Map each phrase id to its original deck index so `usePhraseDisplay`
   * (and therefore the S3 TTS adapter) requests the right audio clip.
   * Without this, the queue-driven 1-element `session.phrases` array
   * always resolves to `currentIndex === 0` and every prompt would replay
   * the first phrase's audio.
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

  return (
    <View style={styles.container}>
      <Text style={styles.counter}>
        {session.isComplete ? "session complete" : `${session.remaining} left`}
      </Text>

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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 24,
    backgroundColor: "#ffffff",
  },
  counter: {
    fontSize: 13,
    color: "#9ca3af",
    alignSelf: "flex-end",
    marginBottom: 16,
  },
});
