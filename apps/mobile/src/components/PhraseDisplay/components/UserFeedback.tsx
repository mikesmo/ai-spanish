import { Feather } from "@expo/vector-icons";
import { diffWords } from "@ai-spanish/logic";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import type { UserFeedbackProps } from "../PhraseDisplay.types";

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

          <Pressable onPress={onTryAgain}>
            <Text style={styles.tryAgainLink}>try again</Text>
          </Pressable>
        </View>
      )}

      <Pressable onPress={onNext} style={styles.nextButton}>
        <Text style={styles.nextLink}>next →</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
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
  tryAgainLink: {
    fontSize: 13,
    color: "#9ca3af",
  },
  nextButton: {
    paddingBottom: 8,
  },
  nextLink: {
    fontSize: 13,
    color: "#9ca3af",
  },
});

