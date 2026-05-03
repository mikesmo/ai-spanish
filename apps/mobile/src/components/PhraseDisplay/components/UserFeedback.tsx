import { Feather } from "@expo/vector-icons";
import { diffWords, FEEDBACK_AUTO_ADVANCE_MS } from "@ai-spanish/logic";
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
import { PillButton, pillStyles } from "./PillButton";

const NEXT_PHRASE_LABEL = "Next phrase";
const QUESTION_PLACEHOLDER_LABEL = "I have a question";

/** Placeholder until question flow is wired. */
const noopQuestionPress = (): void => {};

interface AudioControlsProps {
  isAudioPlaying: boolean;
  /** When true, TTS is the explain-ack replay — speaker stays visually idle. */
  isExplainAckReplayPlaying?: boolean;
  speed: "1x" | "slow";
  onSpeedChange: (speed: "1x" | "slow") => void;
  onReplay: () => void;
}

const AudioControls = ({
  isAudioPlaying,
  isExplainAckReplayPlaying = false,
  speed,
  onSpeedChange,
  onReplay,
}: AudioControlsProps): JSX.Element => {
  const isSpeakerActive = isAudioPlaying && !isExplainAckReplayPlaying;

  return (
  <View style={styles.audioControls}>
    <Pressable
      onPress={onReplay}
      disabled={isAudioPlaying}
      style={[styles.playButton, isSpeakerActive && styles.playButtonActive]}
    >
      <Feather
        name="volume-2"
        size={16}
        color={isSpeakerActive ? "#1D9E75" : "#6b7280"}
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
};

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
    timerRef.current = setTimeout(() => onTimeoutRef.current(), FEEDBACK_AUTO_ADVANCE_MS);
    Animated.timing(fillWidth, {
      toValue: pillWidth,
      duration: FEEDBACK_AUTO_ADVANCE_MS,
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
      style={[pillStyles.pill, pillStyles.pillSecondary, styles.pillWithProgress]}
    >
      <Animated.View style={[styles.pillProgressFill, { width: fillWidth }]} />
      <Text style={[pillStyles.pillLabel, pillStyles.pillLabelSecondary, styles.pillLabelOnProgress]}>
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
  isExplainAckOpen,
  isExplainAckReplayPlaying,
  handleExplainSayAgain,
}: UserFeedbackProps): JSX.Element => {
  const diff = transcription.trim() ? diffWords(transcription, spanishPhrase) : null;
  const explainAckDisabled = isAudioPlaying || isExplainAckReplayPlaying;

  const explainAckActions =
    isExplainAckOpen ? (
      <View style={styles.explainAckActions}>
        <PillButton
          label={QUESTION_PLACEHOLDER_LABEL}
          onPress={noopQuestionPress}
          variant="secondary"
        />
        <PillButton
          label="Explain that again"
          onPress={() => {
            void handleExplainSayAgain();
          }}
          variant="secondary"
          disabled={explainAckDisabled}
        />
      </View>
    ) : null;

  return (
    <View style={styles.container}>
      <View style={styles.main}>
        <View style={styles.feedbackStage}>
          {isCorrect ? (
            <View style={styles.correctStageColumn}>
              <Text style={styles.correctPhrase}>{spanishPhrase}</Text>
              {explainAckActions}
            </View>
          ) : (
            <View style={styles.incorrectStageColumn}>
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
                isExplainAckReplayPlaying={isExplainAckReplayPlaying}
                speed={speed}
                onSpeedChange={onSpeedChange}
                onReplay={onReplay}
              />

              {explainAckActions}
            </View>
          )}
        </View>
      </View>

      <View style={[styles.footer, isExplainAckOpen && styles.footerWithExplainAckAbove]}>
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
  feedbackStage: {
    flex: 1,
    minHeight: 0,
    width: "100%",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 60,
  },
  correctStageColumn: {
    width: "100%",
    alignItems: "center",
    gap: 24,
  },
  incorrectStageColumn: {
    width: "100%",
    alignItems: "center",
    gap: 24,
  },
  explainAckActions: {
    width: "100%",
    flexDirection: "column",
    gap: 16,
  },
  footer: {
    width: "100%",
    marginTop: "auto",
    paddingTop: 24,
    paddingBottom: 16,
    gap: 16,
  },
  footerWithExplainAckAbove: {
    paddingTop: 40,
  },
  buttonGroup: {
    width: "100%",
    gap: 16,
    alignItems: "stretch",
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
  pillLabelOnProgress: {
    zIndex: 1,
  },
  correctPhrase: {
    fontSize: 18,
    color: "#1D9E75",
    textAlign: "center",
    lineHeight: 26,
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
