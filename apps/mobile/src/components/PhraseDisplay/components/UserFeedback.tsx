import { Feather } from "@expo/vector-icons";
import { diffWords } from "@ai-spanish/logic";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import type { UserFeedbackProps } from "../PhraseDisplay.types";

const AUTO_ADVANCE_MS = 2000;
const NEXT_PHRASE_LABEL = "Next phrase";

interface AudioControlsProps {
  isAudioPlaying: boolean;
  speed: "1x" | "slow";
  onSpeedChange: (speed: "1x" | "slow") => void;
  onReplay: () => void;
}

const AudioControls = ({
  isAudioPlaying,
  speed,
  onSpeedChange,
  onReplay,
}: AudioControlsProps): JSX.Element => (
  <View style={styles.audioControls}>
    <Pressable
      onPress={onReplay}
      disabled={isAudioPlaying}
      style={[styles.playButton, isAudioPlaying && styles.playButtonActive]}
    >
      <Feather
        name="volume-2"
        size={16}
        color={isAudioPlaying ? "#1D9E75" : "#6b7280"}
      />
    </Pressable>

    <View style={styles.speedToggle}>
      <Pressable
        onPress={() => onSpeedChange("1x")}
        style={[styles.speedBtn, speed === "1x" && styles.speedBtnActive]}
      >
        <Text style={[styles.speedLabel, speed === "1x" && styles.speedLabelActive]}>1x</Text>
      </Pressable>
      <View style={styles.speedDivider} />
      <Pressable
        onPress={() => onSpeedChange("slow")}
        style={[styles.speedBtn, speed === "slow" && styles.speedBtnActive]}
      >
        <Text style={[styles.speedLabel, speed === "slow" && styles.speedLabelActive]}>
          slow
        </Text>
      </Pressable>
    </View>
  </View>
);

interface PillButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
}

const PillButton = ({ label, onPress, variant = "secondary" }: PillButtonProps): JSX.Element => (
  <Pressable
    onPress={onPress}
    style={[styles.pill, variant === "primary" ? styles.pillPrimary : styles.pillSecondary]}
  >
    <Text
      style={[styles.pillLabel, variant === "primary" ? styles.pillLabelPrimary : styles.pillLabelSecondary]}
    >
      {label}
    </Text>
  </Pressable>
);

interface AutoNextButtonProps {
  label: string;
  onPress: () => void;
  onTimeout: () => void;
}

const AutoNextButton = ({ label, onPress, onTimeout }: AutoNextButtonProps): JSX.Element => {
  const [pillWidth, setPillWidth] = useState(0);
  const fillWidth = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPressRef = useRef(onPress);
  const onTimeoutRef = useRef(onTimeout);
  onPressRef.current = onPress;
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    if (pillWidth <= 0) return;
    timerRef.current = setTimeout(() => onTimeoutRef.current(), AUTO_ADVANCE_MS);
    Animated.timing(fillWidth, {
      toValue: pillWidth,
      duration: AUTO_ADVANCE_MS,
      useNativeDriver: false,
    }).start();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pillWidth, fillWidth]);

  const handlePress = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    fillWidth.stopAnimation();
    onPressRef.current();
  };

  return (
    <Pressable
      onPress={handlePress}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && pillWidth === 0) setPillWidth(w);
      }}
      style={[styles.pill, styles.pillSecondary, styles.pillWithProgress]}
    >
      <Animated.View style={[styles.pillProgressFill, { width: fillWidth }]} />
      <Text style={[styles.pillLabel, styles.pillLabelSecondary, styles.pillLabelOnProgress]}>
        {label}
      </Text>
    </Pressable>
  );
};

interface NextPhraseAfterAudioButtonProps {
  isAudioPlaying: boolean;
  onNext: () => void;
}

const NextPhraseAfterAudioButton = ({
  isAudioPlaying,
  onNext,
}: NextPhraseAfterAudioButtonProps): JSX.Element => {
  if (isAudioPlaying) {
    return <PillButton label={NEXT_PHRASE_LABEL} onPress={onNext} variant="secondary" />;
  }
  return <AutoNextButton label={NEXT_PHRASE_LABEL} onPress={onNext} onTimeout={onNext} />;
};

const joinLeadingSpace = (index: number): string => (index > 0 ? " " : "");

const renderDiffWords = (
  words: { word: string; type: "correct" | "wrong" | "missing" }[],
  getStyle: (type: "correct" | "wrong" | "missing") => StyleProp<TextStyle>,
): JSX.Element => (
  <>
    {words.map(({ word, type }, index) => (
      <Text key={`${word}-${index}`} style={getStyle(type)}>
        {joinLeadingSpace(index)}
        {word}
      </Text>
    ))}
  </>
);

export const UserFeedback = ({
  transcription,
  spanishPhrase,
  isCorrect,
  isAudioPlaying,
  speed,
  onSpeedChange,
  onReplay,
  onTryAgain,
  onNext,
}: UserFeedbackProps): JSX.Element => {
  const diff = transcription.trim() ? diffWords(transcription, spanishPhrase) : null;

  return (
    <View style={styles.container}>
      <View style={styles.main}>
        {isCorrect ? (
          <View style={styles.correctCenter}>
            <Text style={styles.correctPhrase}>{spanishPhrase}</Text>

            <View style={styles.audioControlsRow}>
              <AudioControls
                isAudioPlaying={isAudioPlaying}
                speed={speed}
                onSpeedChange={onSpeedChange}
                onReplay={onReplay}
              />
            </View>

            <View style={styles.bienHechoRow}>
              <Feather name="check-circle" size={20} color="#1D9E75" />
              <Text style={styles.bienHechoText}>bien hecho!</Text>
            </View>
          </View>
        ) : (
          <View style={styles.incorrectCenter}>
            <View style={styles.diffBlock}>
              <Text style={styles.diffLabel}>YOU SAID</Text>
              <Text style={styles.diffText}>
                {diff ? (
                  renderDiffWords(
                    diff.filter(({ type }) => type !== "missing").map(({ word, type }) => ({ word, type })),
                    (type) => (type === "wrong" ? styles.wrongWord : styles.correctWord),
                  )
                ) : (
                  <Text style={styles.noAnswer}>No answer recorded</Text>
                )}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.diffBlock}>
              <Text style={styles.diffLabel}>CORRECT</Text>
              <Text style={styles.diffText}>
                {diff ? (
                  renderDiffWords(
                    diff
                      .filter(({ type }) => type !== "wrong")
                      .map(({ spanishWord, type }) => ({
                        word: spanishWord ?? "",
                        type,
                      })),
                    (type) => (type === "missing" ? styles.missingWord : styles.normalWord),
                  )
                ) : (
                  <Text style={styles.normalWord}>{spanishPhrase}</Text>
                )}
              </Text>
            </View>

            <AudioControls
              isAudioPlaying={isAudioPlaying}
              speed={speed}
              onSpeedChange={onSpeedChange}
              onReplay={onReplay}
            />
          </View>
        )}
      </View>

      <View style={styles.footer}>
        {isCorrect ? (
          <NextPhraseAfterAudioButton isAudioPlaying={isAudioPlaying} onNext={onNext} />
        ) : (
          <View style={styles.buttonGroup}>
            <PillButton label={NEXT_PHRASE_LABEL} onPress={onNext} variant="secondary" />
            <PillButton label="Try again" onPress={onTryAgain} variant="primary" />
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    width: "100%",
  },
  main: {
    flex: 1,
    width: "100%",
    minHeight: 0,
  },
  footer: {
    width: "100%",
    marginTop: "auto",
    paddingTop: 24,
    paddingBottom: 16,
  },
  buttonGroup: {
    width: "100%",
    gap: 16,
    alignItems: "stretch",
  },
  pill: {
    width: "100%",
    height: 54,
    borderRadius: 9999,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  pillSecondary: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  pillPrimary: {
    backgroundColor: "#1d9e75",
    borderWidth: 1,
    borderColor: "#1d9e75",
  },
  pillWithProgress: {
    position: "relative",
  },
  pillProgressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "#A8DDD0",
  },
  pillLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  pillLabelSecondary: {
    color: "#111827",
  },
  pillLabelPrimary: {
    color: "#ffffff",
  },
  pillLabelOnProgress: {
    zIndex: 1,
  },
  correctCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  correctPhrase: {
    fontSize: 18,
    color: "#1D9E75",
    textAlign: "center",
    lineHeight: 26,
  },
  audioControlsRow: {
    marginTop: 4,
  },
  bienHechoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  bienHechoText: {
    fontSize: 18,
    color: "#1D9E75",
  },
  incorrectCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    width: "100%",
  },
  diffBlock: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  diffLabel: {
    fontSize: 11,
    color: "#9ca3af",
    letterSpacing: 1,
  },
  diffText: {
    fontSize: 18,
    textAlign: "center",
    lineHeight: 26,
    flexWrap: "wrap",
  },
  correctWord: {
    color: "#374151",
  },
  wrongWord: {
    color: "#D85A30",
  },
  normalWord: {
    color: "#374151",
  },
  missingWord: {
    color: "#1D9E75",
    textDecorationLine: "underline",
  },
  noAnswer: {
    color: "#9ca3af",
  },
  divider: {
    width: 40,
    height: 1,
    backgroundColor: "#e5e7eb",
  },
  audioControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 0.5,
    borderColor: "#d1d5db",
    alignItems: "center",
    justifyContent: "center",
  },
  playButtonActive: {
    borderColor: "#1D9E75",
    backgroundColor: "#E1F5EE",
  },
  speedToggle: {
    height: 30,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: "#d1d5db",
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  speedBtn: {
    height: "100%",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  speedBtnActive: {
    backgroundColor: "#E1F5EE",
  },
  speedLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6b7280",
  },
  speedLabelActive: {
    color: "#085041",
  },
  speedDivider: {
    width: 0.5,
    height: 16,
    backgroundColor: "#d1d5db",
  },
});
