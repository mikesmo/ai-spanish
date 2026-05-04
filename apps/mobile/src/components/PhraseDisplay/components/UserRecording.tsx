import { EXPLAIN_ACK_AUTO_ADVANCE_MS } from "@ai-spanish/logic";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { getPhraseHeroLayout } from "../heroLayout";
import type { UserRecordingProps } from "../PhraseDisplay.types";
import { PillButton } from "./PillButton";
import { SayThatAgainAckButton } from "./SayThatAgainAckButton";

const QUESTION_PLACEHOLDER_LABEL = "I have a question";

const CIRCLE_SIZE = 120;

export const UserRecording = ({
  englishText,
  spanishLine,
  showSpanishTranslation = false,
  showEnglishInHint = true,
  transcription,
  isRecording,
  isCorrect,
  onShowAnswer,
  showMicChrome = true,
  phraseLessonType,
  hasRecordingExplainReplay = false,
  explainAck,
  replaySpanishMedium,
}: UserRecordingProps): JSX.Element => {
  const [isQuestionActive, setIsQuestionActive] = useState(false);
  const [hero, setHero] = useState<ReturnType<typeof getPhraseHeroLayout>>(null);
  const wasExplainAckOpenRef = useRef(false);

  useEffect(() => {
    if (!isCorrect) setIsQuestionActive(false);
  }, [isCorrect]);

  useEffect(() => {
    const isOpen = explainAck?.isOpen === true;
    if (wasExplainAckOpenRef.current && !isOpen) {
      setIsQuestionActive(false);
    }
    wasExplainAckOpenRef.current = isOpen;
  }, [explainAck?.isOpen]);

  const showNewPhraseQuestionButton = isCorrect && phraseLessonType === "new";
  const showExplainThatAgain =
    explainAck?.isOpen === true && hasRecordingExplainReplay === true;

  const onStageLayout = (e: LayoutChangeEvent) => {
    setHero(getPhraseHeroLayout(e.nativeEvent.layout));
  };

  const displaySpanishLine =
    showSpanishTranslation && spanishLine != null && String(spanishLine).trim() !== ""
      ? spanishLine
      : null;
  const isReplaySpanishAudioPlaying =
    replaySpanishMedium?.show === true && replaySpanishMedium.isPlaying;
  const showRecordingIndicator =
    showMicChrome && !isReplaySpanishAudioPlaying && isRecording && !isCorrect;
  const blinkOpacity = useRef(new Animated.Value(1)).current;
  const breatheScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(blinkOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(blinkOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheScale, { toValue: 1.07, duration: 400, useNativeDriver: true }),
        Animated.timing(breatheScale, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
    );
    blink.start();
    breathe.start();
    return () => {
      blink.stop();
      breathe.stop();
    };
  }, [blinkOpacity, breatheScale]);

  return (
    <View style={styles.container} onLayout={onStageLayout}>
      {showRecordingIndicator ? (
        <View style={styles.recordingBadge} pointerEvents="none">
          <Animated.View style={[styles.blinkerDot, { opacity: blinkOpacity }]} />
          <Text style={styles.recordingLabel}>Recording</Text>
        </View>
      ) : null}

      {hero != null && isCorrect ? (
        <View style={[styles.aboveLabel, { top: hero.aboveCircleLabelTop }]}>
          <View style={styles.bienHechoRow}>
            <Feather name="check-circle" size={20} color="#1D9E75" />
            <Text style={styles.bienHechoText}>Bien hecho!</Text>
          </View>
        </View>
      ) : hero != null ? (
        <View style={[styles.aboveLabel, { top: hero.aboveCircleLabelTop }]}>
          <View style={styles.nowYouTryRow}>
            <Text style={styles.diffLabel}>Now you try</Text>
          </View>
        </View>
      ) : null}

      {hero != null && showMicChrome && !isReplaySpanishAudioPlaying ? (
        <Animated.View
          style={[
            styles.micCircle,
            { left: hero.circleLeft, top: hero.circleTop },
            isCorrect && styles.micCircleCorrect,
            { transform: [{ scale: breatheScale }] },
          ]}
        >
          <Feather name="mic" size={28} color="white" />
        </Animated.View>
      ) : hero != null && showMicChrome && isReplaySpanishAudioPlaying ? (
        <View
          style={[
            styles.micCircle,
            { left: hero.circleLeft, top: hero.circleTop },
            isCorrect && styles.micCircleCorrect,
          ]}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading"
        >
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      ) : hero != null && !showMicChrome ? (
        <View
          style={[styles.primingCircle, { left: hero.circleLeft, top: hero.circleTop }]}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading"
        >
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      ) : null}

      {hero != null ? (
        <View style={[styles.hintTranscriptBlock, { top: hero.textBelowTop }]}>
          {displaySpanishLine ? (
            <View style={styles.hintBlock}>
              {showEnglishInHint ? <Text style={styles.englishLine}>{englishText}</Text> : null}
              <Text style={styles.spanishTarget}>{displaySpanishLine}</Text>
            </View>
          ) : (
            <Text style={styles.englishText}>{englishText}</Text>
          )}

          <View style={styles.transcriptArea}>
            <Text style={[styles.transcriptText, isCorrect && styles.transcriptCorrect]}>
              {transcription}
            </Text>
          </View>

          {explainAck?.isOpen === true || showNewPhraseQuestionButton ? (
            <View style={styles.explainAckUnderTranscript}>
              {showNewPhraseQuestionButton ? (
                <PillButton
                  label={QUESTION_PLACEHOLDER_LABEL}
                  onPress={() => {
                    setIsQuestionActive((v) => !v);
                  }}
                  variant="secondary"
                />
              ) : null}
              {showExplainThatAgain && explainAck != null ? (
                <PillButton
                  label="Explain that again"
                  onPress={() => {
                    void explainAck.onSayAgain();
                  }}
                  variant="secondary"
                  disabled={explainAck.isReplayPlaying}
                />
              ) : null}
            </View>
          ) : null}

          {replaySpanishMedium?.show === true ? (
            <View style={styles.replaySpanishBelowTranscript}>
              <PillButton
                label="Replay spanish"
                onPress={() => {
                  void replaySpanishMedium.onReplay();
                }}
                variant="secondary"
                disabled={replaySpanishMedium.isPlaying}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.bottomControls}>
        {explainAck?.isOpen === true ? (
          <SayThatAgainAckButton
            isReplayPlaying={explainAck.isReplayPlaying}
            label="Next phrase"
            autoAdvanceMs={EXPLAIN_ACK_AUTO_ADVANCE_MS}
            isPaused={showNewPhraseQuestionButton && isQuestionActive}
            onSayAgain={explainAck.onAckOkay}
            onAckOkay={explainAck.onAckOkay}
          />
        ) : (
          <PillButton label="show answer" onPress={onShowAnswer} variant="secondary" />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    minHeight: 0,
  },
  recordingBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  aboveLabel: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  bienHechoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  nowYouTryRow: {
    alignItems: "center",
    width: "100%",
  },
  diffLabel: {
    fontSize: 11,
    color: "#9ca3af",
    letterSpacing: 1,
  },
  bienHechoText: {
    fontSize: 18,
    color: "#1D9E75",
  },
  micCircle: {
    position: "absolute",
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: "#1D9E75",
    alignItems: "center",
    justifyContent: "center",
  },
  primingCircle: {
    position: "absolute",
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: "#A8DDD0",
    alignItems: "center",
    justifyContent: "center",
  },
  micCircleCorrect: {
    backgroundColor: "rgba(29, 158, 117, 0.7)",
  },
  hintTranscriptBlock: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: 0,
    alignItems: "center",
  },
  hintBlock: {
    alignItems: "center",
    maxWidth: 280,
    gap: 4,
  },
  replaySpanishBelowTranscript: {
    marginTop: 16,
    width: "100%",
    alignSelf: "stretch",
  },
  englishLine: {
    fontSize: 15,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 22,
  },
  spanishTarget: {
    fontSize: 18,
    fontWeight: "500",
    color: "#1D1D1D",
    textAlign: "center",
    lineHeight: 26,
  },
  englishText: {
    fontSize: 15,
    color: "#999",
    textAlign: "center",
    maxWidth: 280,
    opacity: 0.55,
  },
  transcriptArea: {
    marginTop: 16,
    minHeight: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  transcriptText: {
    fontSize: 18,
    color: "#6b7280",
    textAlign: "center",
  },
  transcriptCorrect: {
    color: "#1D9E75",
  },
  explainAckUnderTranscript: {
    marginTop: 16,
    width: "100%",
    alignSelf: "stretch",
    gap: 12,
  },
  bottomControls: {
    marginTop: "auto",
    width: "100%",
    alignItems: "center",
    gap: 24,
    paddingBottom: 16,
  },
  blinkerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#1D9E75",
  },
  recordingLabel: {
    fontSize: 12,
    color: "#9ca3af",
  },
});
