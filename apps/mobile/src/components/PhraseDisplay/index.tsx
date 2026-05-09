import { AppState, BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, useRef } from "react";
import {
  buildDeckFingerprint,
  buildLessonCompletionPayload,
  createLessonCompletionRunId,
  getAisSpeakingViewModel,
  getLessonTitle,
  getUserRecordingViewModel,
  runPhraseFeedbackNext,
  s3LessonFolderForTranscriptLessonId,
  useLearnerQuestionPause,
  useLessonProgressPersistence,
  useLessonSessionWithHistory,
  usePhraseDisplayWithDeck,
} from "@ai-spanish/logic";
import { useSTT, useS3TTS } from "@ai-spanish/ai";
import { useQueryClient } from "@tanstack/react-query";
import { playSuccessChime } from "../../lib/playSuccessChime";
import { postLessonCompletion } from "../../services/lessonCompletion.service";
import { mobileLessonProgressFetcher } from "../../services/lessonProgressTransport";
import type { PhraseDisplayProps } from "./PhraseDisplay.types";
import { AISpeaking } from "./components/AISpeaking";
import { UserFeedback } from "./components/UserFeedback";
import { UserRecording } from "./components/UserRecording";
import { QuestionSidebar } from "../QuestionSidebar";

export const PhraseDisplay = ({
  phrases,
  lessonId,
  onExit,
  initialSessionCheckpoint,
}: PhraseDisplayProps): JSX.Element => {
  const tts = useS3TTS();
  const stt = useSTT();
  const session = useLessonSessionWithHistory(phrases, {
    initialCheckpoint: initialSessionCheckpoint ?? undefined,
  });
  const lessonTitle = getLessonTitle(lessonId);
  const queryClient = useQueryClient();

  const { display } = usePhraseDisplayWithDeck(phrases, session, stt, tts, {
    playSuccessChime,
    s3LessonSegment: s3LessonFolderForTranscriptLessonId(lessonId),
  });

  const explainAckOkayRef = useRef(display.handleExplainAckOkay);
  explainAckOkayRef.current = display.handleExplainAckOkay;

  const { bindCurrentPhrase } = session;
  useEffect(() => {
    bindCurrentPhrase(display.currentPhrase);
  }, [display.currentPhrase, bindCurrentPhrase]);

  const learnerQuestionPause = useLearnerQuestionPause({
    isCorrect: display.isCorrect,
    isExplainAckOpen: display.isExplainAckOpen,
    isAudioPlaying: display.isAudioPlaying,
    onStopAnswerAudio: display.stopAnswerAudio,
    onExplainInterrupted: display.handleExplainInterrupted,
    resetKey: `${display.currentPhrase.name}-${display.status}`,
  });

  useEffect(() => {
    if (!display.isExplainAckOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      explainAckOkayRef.current();
      return true;
    });
    return () => sub.remove();
  }, [display.isExplainAckOpen]);

  const deckFingerprintRef = useRef(buildDeckFingerprint(phrases));
  const lessonRunIdRef = useRef<string | undefined>(undefined);
  if (lessonRunIdRef.current === undefined) {
    lessonRunIdRef.current = createLessonCompletionRunId();
  }
  const lessonCompletionSavedRef = useRef(false);

  const { flush } = useLessonProgressPersistence({
    session,
    lessonId,
    deckFingerprint: deckFingerprintRef.current,
    fetcher: mobileLessonProgressFetcher,
  });

  // Stable ref so handleExit / AppState listener always see the latest flush.
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const handleExit = (): void => {
    flushRef.current();
    onExit();
  };

  // Flush checkpoint when the app moves to background (equivalent of browser pagehide).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") {
        flush();
      }
    });
    return () => sub.remove();
  }, [flush]);

  /* eslint-disable react-hooks/exhaustive-deps -- useLessonSessionWithHistory returns a new object each render; list stable fields explicitly. */
  useEffect(() => {
    if (!session.isComplete || lessonCompletionSavedRef.current) return;
    lessonCompletionSavedRef.current = true;
    const checkpoint = session.getSessionCheckpoint({
      lessonId,
      deckFingerprint: deckFingerprintRef.current,
    });
    const payload = buildLessonCompletionPayload({
      runId: lessonRunIdRef.current!,
      lessonId,
      lessonTitle,
      entries: session.history,
      checkpoint,
    });
    void postLessonCompletion(payload, lessonId).then((ok) => {
      if (ok) {
        void queryClient.invalidateQueries({
          queryKey: ["lesson-resume-checkpoint", lessonId],
        });
      }
    });
  }, [
    lessonId,
    lessonTitle,
    queryClient,
    session.getSessionCheckpoint,
    session.history,
    session.isComplete,
  ]);
  /* eslint-enable react-hooks/exhaustive-deps */

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

  const showNextPhraseInsteadOfAnswer =
    display.isCorrect &&
    display.currentPhrase.type === "new" &&
    display.currentPhrase.English.explain.trim() !== "" &&
    display.isFirstSessionPresentationOfCurrentPhrase &&
    !display.hasUsedTryAgainOnCurrentCard;

  const isIncorrectAnswerFeedback =
    display.status === "answer" && !display.isCorrect && !session.isComplete;

  return (
    <View style={styles.root}>
      <View style={styles.container}>
        <View style={[styles.header, isIncorrectAnswerFeedback && styles.headerNoMarginBelow]}>
          <Pressable
            onPress={handleExit}
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
            phraseLessonType={display.currentPhrase.type}
            hasRecordingExplainReplay={display.currentPhrase.English.explain.trim() !== ""}
            isAudioPlaying={display.isAudioPlaying}
            onStopAnswerAudio={display.stopAnswerAudio}
            onExplainInterrupted={display.handleExplainInterrupted}
            showNextPhraseInsteadOfAnswer={showNextPhraseInsteadOfAnswer}
            learnerQuestionPause={learnerQuestionPause}
            onNextPhrase={() => {
              display.stopAnswerAudio();
              runPhraseFeedbackNext(display, session);
            }}
            onClearSpokenCaption={
              (display.status === "tryAgain" ||
                display.currentPhrase.type === "new" ||
                !display.hasUsedClearSpokenCaptionOnCurrentCard)
                ? display.handleClearSpokenCaption
                : undefined
            }
            explainAck={
              display.isExplainAckOpen &&
              (display.status === "recording" || display.status === "recordingPriming")
                ? {
                    isOpen: true,
                    isReplayPlaying: display.isExplainAckReplayPlaying,
                    onSayAgain: display.handleExplainSayAgain,
                    onAckOkay: display.handleExplainAckOkay,
                  }
                : undefined
            }
            replaySpanishMedium={
              display.showReplaySpanishMedium
                ? {
                    show: true,
                    isPlaying: display.isReplaySpanishMediumPlaying,
                    onReplay: display.handleReplaySpanishMedium,
                  }
                : undefined
            }
          />
          )}

          {display.status === "answer" && !session.isComplete && (
          <UserFeedback
            transcription={display.caption}
            spanishPhrase={display.spanishText}
            isCorrect={display.isCorrect}
            isAudioPlaying={display.isAudioPlaying}
            isEnglishExplainDominatingLessonControls={
              display.isEnglishExplainDominatingLessonControls
            }
            isExplainAckOpen={display.isExplainAckOpen}
            isExplainAckReplayPlaying={display.isExplainAckReplayPlaying}
            handleExplainSayAgain={display.handleExplainSayAgain}
            speed={display.speed}
            onSpeedChange={display.setSpeed}
            onReplay={display.handleReplay}
            onStopAnswerAudio={display.stopAnswerAudio}
            onExplainInterrupted={display.handleExplainInterrupted}
            onTryAgain={display.handleTryAgain}
            learnerQuestionPause={learnerQuestionPause}
            onNext={() => {
              runPhraseFeedbackNext(display, session);
            }}
          />
          )}
        </View>
      </View>
      <QuestionSidebar
        isOpen={learnerQuestionPause.isActive}
        onClose={learnerQuestionPause.dismiss}
        phraseId={display.currentPhrase.name}
        englishText={display.currentPhrase.English.question}
        spanishText={display.spanishText}
        grammar={display.currentPhrase.Spanish.grammar}
        newGrammar={display.currentPhrase.Spanish.newGrammar}
        newWords={display.currentPhrase.Spanish.newWords}
        lastAttempt={display.lastAttemptDetail}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: "100%",
    position: "relative",
    backgroundColor: "#ffffff",
  },
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
  headerNoMarginBelow: {
    marginBottom: 0,
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
