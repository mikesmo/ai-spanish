import { StyleSheet, Text, View } from "react-native";
import {
  getAisSpeakingViewModel,
  getUserRecordingViewModel,
  runPhraseFeedbackNext,
  useLessonSession,
  usePhraseDisplayWithDeck,
} from "@ai-spanish/logic";
import { useSTT, useS3TTS } from "@ai-spanish/ai";
import { playRecordingPrimingAudio } from "../../lib/playRecordingPrimingAudio";
import { playSuccessChime } from "../../lib/playSuccessChime";
import type { PhraseDisplayProps } from "./PhraseDisplay.types";
import { AISpeaking } from "./components/AISpeaking";
import { UserFeedback } from "./components/UserFeedback";
import { UserRecording } from "./components/UserRecording";

export const PhraseDisplay = ({ phrases }: PhraseDisplayProps): JSX.Element => {
  const tts = useS3TTS();
  const stt = useSTT();
  const session = useLessonSession(phrases);

  const { display } = usePhraseDisplayWithDeck(phrases, session, stt, tts, {
    playSuccessChime,
    playRecordingPrimingAudio,
  });

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
    <View style={styles.container}>
      <Text style={styles.counter}>
        {session.isComplete ? "session complete" : `${session.remaining} left`}
      </Text>

      <View style={styles.contentStage}>
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
      </View>
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
  contentStage: {
    flex: 1,
    width: "100%",
    minHeight: 0,
  },
});
