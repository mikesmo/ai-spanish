import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { UserRecordingProps } from "../PhraseDisplay.types";
import { PillButton } from "./PillButton";

export const UserRecording = ({
  englishText,
  transcription,
  isCorrect,
  onShowAnswer,
}: UserRecordingProps): JSX.Element => {
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
      <View style={styles.center}>
        <Animated.View
          style={[
            styles.micCircle,
            isCorrect && styles.micCircleCorrect,
            { transform: [{ scale: breatheScale }] },
          ]}
        >
          <Feather name="mic" size={28} color="white" />
        </Animated.View>

        <Text style={styles.englishText}>{englishText}</Text>

        <View style={styles.transcriptArea}>
          <Text style={[styles.transcriptText, isCorrect && styles.transcriptCorrect]}>
            {transcription}
          </Text>
        </View>
      </View>

      <View style={styles.bottomControls}>
        <View style={styles.recordingRow}>
          <Animated.View style={[styles.blinkerDot, { opacity: blinkOpacity }]} />
          <Text style={styles.recordingLabel}>Recording</Text>
        </View>
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  micCircle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: "#1D9E75",
    alignItems: "center",
    justifyContent: "center",
  },
  micCircleCorrect: {
    backgroundColor: "rgba(29, 158, 117, 0.7)",
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
    marginTop: 24,
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
  recordingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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

