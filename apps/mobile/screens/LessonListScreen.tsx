import { DEFAULT_COURSE_LEVEL_SLUG } from "@ai-spanish/logic";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLessonsQuery } from "../src/hooks/useLessonsQuery";

type LessonListScreenProps = {
  onChooseLesson: (lessonId: string) => void;
};

export default function LessonListScreen({
  onChooseLesson,
}: LessonListScreenProps): JSX.Element {
  const { data, isLoading, isError, error } = useLessonsQuery(
    DEFAULT_COURSE_LEVEL_SLUG,
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>AI Spanish</Text>
        <Text style={styles.subtitle}>Choose a lesson to practice</Text>

        {isLoading ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator />
            <Text style={styles.hint}>Loading lessons…</Text>
          </View>
        ) : null}

        {isError ? (
          <Text style={styles.errorText}>
            {error instanceof Error ? error.message : "Failed to load lessons."}
          </Text>
        ) : null}

        {data?.courseLevel?.title ? (
          <Text style={styles.levelLabel}>{data.courseLevel.title}</Text>
        ) : null}

        {data ? (
          <View style={styles.list}>
            {data.lessons.map((lesson) => (
              <Pressable
                key={lesson.lessonId}
                onPress={() => onChooseLesson(lesson.lessonId)}
                style={({ pressed }) => [
                  styles.card,
                  pressed && styles.cardPressed,
                ]}
              >
                <Text style={styles.cardTitle}>{lesson.title}</Text>
                <Text style={styles.cardDescription}>{lesson.description}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {!isLoading && data && data.lessons.length === 0 ? (
          <Text style={styles.hint}>
            No lessons in this course level yet. Add rows to lesson_catalog
            after transcripts exist.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  scroll: {
    paddingHorizontal: 32,
    paddingVertical: 24,
    paddingBottom: 40,
  },
  heading: {
    fontSize: 24,
    fontWeight: "600",
    color: "#111827",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 24,
  },
  levelLabel: {
    fontSize: 12,
    color: "#9ca3af",
    textAlign: "center",
    marginBottom: 16,
  },
  list: {
    gap: 16,
  },
  centerBlock: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
  },
  hint: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
  },
  errorText: {
    fontSize: 14,
    color: "#D85A30",
    textAlign: "center",
    marginBottom: 16,
  },
  card: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  cardPressed: {
    borderColor: "#d1d5db",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
  },
  cardDescription: {
    marginTop: 6,
    fontSize: 14,
    color: "#6b7280",
  },
});
