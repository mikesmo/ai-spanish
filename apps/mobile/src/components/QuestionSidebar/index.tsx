import { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useState } from "react";
import { useSTT } from "@ai-spanish/ai";
import {
  DEFAULT_QUESTION_MAX_RECORD_MS,
  LEARNER_QUESTION_PRESET_PROMPTS,
  useQuestionInput,
} from "@ai-spanish/logic";

export interface QuestionSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  englishText: string;
  spanishText: string;
}

const SCREEN_WIDTH = Dimensions.get("window").width;

export const QuestionSidebar = ({
  isOpen,
  onClose,
  englishText,
  spanishText,
}: QuestionSidebarProps): JSX.Element => {
  const stt = useSTT({ language: "multi" });
  const {
    text: question,
    setText: setQuestion,
    isRecording,
    startRecording,
    stopRecording,
    error,
  } = useQuestionInput(stt, {
    maxRecordMs: DEFAULT_QUESTION_MAX_RECORD_MS,
  });
  const [isLocked, setIsLocked] = useState(false);
  const translateX = useRef(new Animated.Value(SCREEN_WIDTH)).current;

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: isOpen ? 0 : SCREEN_WIDTH,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isOpen, translateX]);

  const handlePresetPress = (prompt: string): void => {
    setQuestion(prompt);
  };

  const handleHoldStart = (): void => {
    if (!isLocked) {
      startRecording();
    }
  };

  const handleHoldEnd = (): void => {
    if (!isLocked) {
      stopRecording();
    }
  };

  const handleToggleLock = (): void => {
    setIsLocked((current) => {
      const next = !current;
      if (next) {
        startRecording();
      } else {
        stopRecording();
      }
      return next;
    });
  };

  useEffect(() => {
    if (!isRecording && isLocked) {
      setIsLocked(false);
    }
  }, [isLocked, isRecording]);

  return (
    <Animated.View
      pointerEvents={isOpen ? "auto" : "none"}
      style={[styles.container, { transform: [{ translateX }] }]}
      accessibilityViewIsModal={isOpen}
      accessibilityElementsHidden={!isOpen}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardAvoid}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Ask about this phrase</Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close question panel"
            style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
          >
            <Text style={styles.closeGlyph}>×</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Phrase block */}
          <View style={styles.phraseBlock}>
            <Text style={styles.sectionLabel}>Current phrase</Text>
            <Text style={styles.spanishText}>{spanishText}</Text>
            <Text style={styles.englishText}>{englishText}</Text>
          </View>

          {/* Preset chips */}
          <View style={styles.presetsSection}>
            <Text style={styles.sectionLabel}>Quick questions</Text>
            <View style={styles.chipsWrap}>
              {LEARNER_QUESTION_PRESET_PROMPTS.map((prompt) => (
                <Pressable
                  key={prompt}
                  onPress={() => handlePresetPress(prompt)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.chip,
                    question === prompt && styles.chipActive,
                    pressed && styles.chipPressed,
                  ]}
                >
                  <Text style={[styles.chipLabel, question === prompt && styles.chipLabelActive]}>
                    {prompt}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Text input */}
          <View style={styles.inputSection}>
            <Text style={styles.sectionLabel}>Your question</Text>
            <TextInput
              value={question}
              onChangeText={setQuestion}
              multiline
              numberOfLines={4}
              placeholder="Type your question here, or use the microphone."
              placeholderTextColor="#9ca3af"
              style={styles.textInput}
              textAlignVertical="top"
            />
            <View style={styles.recordingControls}>
              <Pressable
                onPressIn={handleHoldStart}
                onPressOut={handleHoldEnd}
                disabled={isLocked}
                accessibilityRole="button"
                accessibilityLabel="Hold to record question"
                style={({ pressed }) => [
                  styles.micButton,
                  isRecording && styles.micButtonRecording,
                  pressed && !isLocked && styles.micButtonPressed,
                  isLocked && styles.micButtonLocked,
                ]}
              >
                <Text style={[styles.micGlyph, isRecording && styles.micGlyphRecording]}>
                  {isRecording ? "■" : "●"}
                </Text>
                <Text style={[styles.micButtonLabel, isRecording && styles.micButtonLabelRecording]}>
                  {isRecording ? "Recording" : "Hold to speak"}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleToggleLock}
                accessibilityRole="button"
                accessibilityLabel={
                  isLocked ? "Unlock question recording" : "Lock question recording on"
                }
                accessibilityState={{ selected: isLocked }}
                style={({ pressed }) => [
                  styles.lockButton,
                  isLocked && styles.lockButtonActive,
                  pressed && styles.lockButtonPressed,
                ]}
              >
                <Text style={[styles.lockButtonLabel, isLocked && styles.lockButtonLabelActive]}>
                  {isLocked ? "Unlock" : "Lock on"}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.recordingHint}>
              {isRecording
                ? `Listening live. Recording stops automatically after ${Math.round(DEFAULT_QUESTION_MAX_RECORD_MS / 1000)} seconds.`
                : "Hold the mic, or lock recording on for hands-free input."}
            </Text>
            {error ? (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {error}
              </Text>
            ) : null}
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable
            onPress={() => {}}
            disabled={question.trim() === ""}
            accessibilityRole="button"
            accessibilityLabel="Send question"
            style={({ pressed }) => [
              styles.sendButton,
              question.trim() === "" && styles.sendButtonDisabled,
              pressed && question.trim() !== "" && styles.sendButtonPressed,
            ]}
          >
            <Text style={styles.sendButtonLabel}>Send question</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 24,
    zIndex: 40,
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
    flex: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  closeButtonPressed: {
    backgroundColor: "#f3f4f6",
  },
  closeGlyph: {
    fontSize: 24,
    lineHeight: 28,
    color: "#6b7280",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    gap: 24,
  },
  phraseBlock: {
    backgroundColor: "#f9fafb",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 16,
    gap: 6,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: "#9ca3af",
    marginBottom: 4,
  },
  spanishText: {
    fontSize: 17,
    fontWeight: "500",
    color: "#1D9E75",
    lineHeight: 24,
  },
  englishText: {
    fontSize: 13,
    color: "#6b7280",
    lineHeight: 20,
  },
  presetsSection: {
    gap: 10,
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
  },
  chipActive: {
    backgroundColor: "#E1F5EE",
    borderColor: "#1D9E75",
  },
  chipPressed: {
    backgroundColor: "#f0fdf9",
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#374151",
  },
  chipLabelActive: {
    color: "#085041",
  },
  inputSection: {
    gap: 8,
  },
  textInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 14,
    color: "#111827",
    minHeight: 100,
    backgroundColor: "#ffffff",
  },
  recordingControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  },
  micButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  micButtonRecording: {
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
  },
  micButtonPressed: {
    borderColor: "#1D9E75",
    backgroundColor: "#f0fdf9",
  },
  micButtonLocked: {
    opacity: 0.8,
  },
  micGlyph: {
    fontSize: 14,
    lineHeight: 16,
    color: "#1D9E75",
  },
  micGlyphRecording: {
    color: "#dc2626",
  },
  micButtonLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
  },
  micButtonLabelRecording: {
    color: "#991b1b",
  },
  lockButton: {
    minHeight: 44,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  lockButtonActive: {
    borderColor: "#1D9E75",
    backgroundColor: "#E1F5EE",
  },
  lockButtonPressed: {
    backgroundColor: "#f0fdf9",
  },
  lockButtonLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
  },
  lockButtonLabelActive: {
    color: "#085041",
  },
  recordingHint: {
    fontSize: 12,
    lineHeight: 18,
    color: "#6b7280",
  },
  errorText: {
    fontSize: 12,
    lineHeight: 18,
    color: "#dc2626",
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e7eb",
  },
  sendButton: {
    height: 52,
    borderRadius: 9999,
    backgroundColor: "#1D9E75",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonPressed: {
    backgroundColor: "#188a65",
  },
  sendButtonLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
});
