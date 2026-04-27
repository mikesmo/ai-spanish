import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  getAisSpeakingViewModel,
  getLessonTitle,
  getUserRecordingViewModel,
  runPhraseFeedbackNext,
  s3LessonFolderForTranscriptLessonId,
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

export const PhraseDisplay = ({
  phrases,
  lessonId,
  onExit,
}: PhraseDisplayProps): JSX.Element => {
  const tts = useS3TTS();
  const stt = useSTT();
  const session = useLessonSession(phrases);
  const lessonTitle = getLessonTitle(lessonId);

  const { display } = usePhraseDisplayWithDeck(phrases, session, stt, tts, {
    playSuccessChime,
    playRecordingPrimingAudio,
    s3LessonSegment: s3LessonFolderForTranscriptLessonId(lessonId),
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
    lessonDeck: phrases,
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={onExit}
          style={({ pressed }) => [styles.headerClose, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Exit lesson"
        >
          <Text style={styles.closeGlyph}>×</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {lessonTitle}
        </Text>
        <Text style={styles.headerCounter} numberOfLines={1}>
          {session.isComplete ? "session complete" : `${session.remaining} left`}
        </Text>
      </View>

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
  header: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    minHeight: 40,
    marginBottom: 16,
  },
  headerClose: {
    position: "absolute",
    left: 0,
    zIndex: 1,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  closeGlyph: {
    fontSize: 28,
    lineHeight: 32,
    color: "#6b7280",
  },
  pressed: {
    backgroundColor: "#f3f4f6",
  },
  headerTitle: {
    flex: 1,
    paddingHorizontal: 48,
    fontSize: 15,
    fontWeight: "500",
    color: "#111827",
    textAlign: "center",
  },
  headerCounter: {
    position: "absolute",
    right: 0,
    zIndex: 1,
    maxWidth: "40%",
    fontSize: 13,
    color: "#9ca3af",
    textAlign: "right",
  },
  contentStage: {
    flex: 1,
    width: "100%",
    minHeight: 0,
  },
});
