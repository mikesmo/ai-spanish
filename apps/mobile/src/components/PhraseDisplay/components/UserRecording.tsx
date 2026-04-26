import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { UserRecordingProps } from "../PhraseDisplay.types";
import { PillButton } from "./PillButton";

type UserRecordingScreenMode = "pronunciationAttempt" | "userTest";

export const UserRecording = ({
  englishText,
  spanishLine,
  showEnglishInHint = true,
  transcription,
  isRecording,
  isCorrect,
  onShowAnswer,
  showMicChrome = true,
}: UserRecordingProps): JSX.Element => {
  const showRecordingIndicator = showMicChrome && isRecording && !isCorrect;
  const screenMode: UserRecordingScreenMode =
    spanishLine != null && String(spanishLine).trim() !== ""
      ? "pronunciationAttempt"
      : "userTest";
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
    <View style={styles.container}>
      {showRecordingIndicator ? (
        <View style={styles.recordingBadge} pointerEvents="none">
          <Animated.View style={[styles.blinkerDot, { opacity: blinkOpacity }]} />
          <Text style={styles.recordingLabel}>Recording</Text>
        </View>
      ) : null}

      <View style={styles.middle}>
        <View style={styles.centerStack}>
          {isCorrect ? (
            <View style={styles.bienHechoRow}>
              <Feather name="check-circle" size={20} color="#1D9E75" />
              <Text style={styles.bienHechoText}>bien hecho!</Text>
            </View>
          ) : screenMode === "pronunciationAttempt" ? (
            <View style={styles.nowYouTryRow}>
              <Text style={styles.diffLabel}>Now you try</Text>
            </View>
          ) : null}

          {showMicChrome ? (
            <Animated.View
              style={[
                styles.micCircle,
                isCorrect && styles.micCircleCorrect,
                { transform: [{ scale: breatheScale }] },
              ]}
            >
              <Feather name="mic" size={28} color="white" />
            </Animated.View>
          ) : (
            <View style={styles.primingCircle} accessibilityRole="progressbar" accessibilityLabel="Loading">
              <ActivityIndicator size="large" color="#ffffff" />
            </View>
          )}

          {spanishLine ? (
            <View style={styles.hintBlock}>
              {showEnglishInHint ? (
                <Text style={styles.englishLine}>{englishText}</Text>
              ) : null}
              <Text style={styles.spanishTarget}>{spanishLine}</Text>
            </View>
          ) : (
            <Text style={styles.englishText}>{englishText}</Text>
          )}

          <View style={styles.transcriptArea}>
            <Text style={[styles.transcriptText, isCorrect && styles.transcriptCorrect]}>
              {transcription}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.bottomControls}>
        <PillButton label="show answer" onPress={onShowAnswer} variant="secondary" />
      </View>
    </View>
  );
};

const CIRCLE_SIZE = 120;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
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
  middle: {
    flex: 1,
    width: "100%",
    minHeight: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  centerStack: {
    alignItems: "center",
    width: "100%",
  },
  bienHechoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 24,
  },
  /** Same slot as bienHecho; matches UserFeedback section labels. */
  nowYouTryRow: {
    marginBottom: 24,
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
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: "#1D9E75",
    alignItems: "center",
    justifyContent: "center",
  },
  primingCircle: {
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
  hintBlock: {
    alignItems: "center",
    maxWidth: 280,
    marginTop: 24,
    gap: 4,
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
    marginTop: 24,
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
  bottomControls: {
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
