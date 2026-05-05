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
import { LEARNER_QUESTION_PRESET_PROMPTS } from "@ai-spanish/logic";

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
  const [question, setQuestion] = useState("");
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
              placeholder="Type your question here… (voice input coming soon)"
              placeholderTextColor="#9ca3af"
              style={styles.textInput}
              textAlignVertical="top"
            />
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
