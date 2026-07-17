import {
  buildDeckFingerprint,
  isTranscriptLessonIdSyntaxValid,
  useLearnerMasteryQuery,
  useLessonResumeCheckpointQuery,
  type SessionCheckpointParsed,
} from "@ai-spanish/logic";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";
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
import { mobileLessonProgressFetcher } from "../src/services/lessonProgressTransport";

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
    isLoading: isLessonLoading,
    isError,
    error,
  } = useLessonQuery(lessonId);

  /**
   * Resume probe runs in parallel with the lesson transcript fetch so the user
   * never sees a separate "restoring" stage after the lesson finishes loading.
   */
  const resumeQuery = useLessonResumeCheckpointQuery(
    mobileLessonProgressFetcher,
    lessonId,
  );

  /**
   * Lifetime word/grammar mastery, used to seed the tracker for any lesson.
   * Also runs in parallel — see web's `LessonPageContent` for the same
   * pattern.
   */
  const masteryQuery = useLearnerMasteryQuery(mobileLessonProgressFetcher);

  /**
   * Wait for a real round-trip fetch before rendering PhraseDisplay —
   * `initialCheckpoint` is consumed only at mount so we must not hand it
   * stale (cached) data. Mirror web's `isResumeSettled` logic.
   */
  const isResumeSettled =
    resumeQuery.isError ||
    (resumeQuery.isSuccess && !resumeQuery.isFetching);
  const isMasterySettled =
    masteryQuery.isError || (masteryQuery.isSuccess && !masteryQuery.isFetching);

  const initialSessionCheckpoint = useMemo((): SessionCheckpointParsed | undefined => {
    const cp = resumeQuery.data;
    if (!cp || phrases == null || phrases.length === 0) return undefined;
    if (cp.deckFingerprint !== undefined) {
      const fp = buildDeckFingerprint(phrases);
      if (cp.deckFingerprint !== fp) return undefined;
    }
    return cp;
  }, [resumeQuery.data, phrases]);

  const isPageLoading = isLessonLoading || !isResumeSettled || !isMasterySettled;

  if (isPageLoading) {
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
      <PhraseDisplay
        phrases={phrases}
        lessonId={lessonId}
        onExit={onBack}
        initialSessionCheckpoint={initialSessionCheckpoint}
        initialItemScores={masteryQuery.data ?? undefined}
      />
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
