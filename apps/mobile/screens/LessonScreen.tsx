import { isTranscriptLessonIdSyntaxValid } from "@ai-spanish/logic";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import {
  ActivityIndicator,
  BackHandler,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { PhraseDisplay } from "../src/components/PhraseDisplay";
import { useLessonQuery } from "../src/hooks/useLessonQuery";

type LessonScreenProps = {
  lessonId: string;
  onBack: () => void;
};

function InvalidLessonId({ onBack }: { onBack: () => void }): null {
  useEffect(() => {
    onBack();
  }, [onBack]);
  return null;
}

function LessonSessionContent({
  lessonId,
  onBack,
}: {
  lessonId: string;
  onBack: () => void;
}): JSX.Element {
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const {
    data: phrases,
    isLoading,
    isError,
    error,
  } = useLessonQuery(lessonId);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.centerText}>Loading lesson...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.center}>
          <Text style={[styles.centerText, styles.errorText]}>
            {error instanceof Error ? error.message : "Failed to load lesson."}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!phrases || phrases.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.center}>
          <Text style={styles.centerText}>No phrases available.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <PhraseDisplay phrases={phrases} lessonId={lessonId} onExit={onBack} />
    </SafeAreaView>
  );
}

export default function LessonScreen({
  lessonId,
  onBack,
}: LessonScreenProps): JSX.Element {
  if (!isTranscriptLessonIdSyntaxValid(lessonId)) {
    return <InvalidLessonId onBack={onBack} />;
  }
  return <LessonSessionContent lessonId={lessonId} onBack={onBack} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  centerText: {
    color: "#6b7280",
  },
  errorText: {
    color: "#D85A30",
    paddingHorizontal: 24,
    textAlign: "center",
  },
});
