import { lessons } from "@ai-spanish/logic";
import { StatusBar } from "expo-status-bar";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

type LessonListScreenProps = {
  onChooseLesson: (lessonId: string) => void;
};

export default function LessonListScreen({
  onChooseLesson,
}: LessonListScreenProps): JSX.Element {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>AI Spanish</Text>
        <Text style={styles.subtitle}>Choose a lesson to practice</Text>
        <View style={styles.list}>
          {lessons.map((lesson) => (
            <Pressable
              key={lesson.id}
              onPress={() => onChooseLesson(lesson.id)}
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
    marginBottom: 40,
  },
  list: {
    gap: 16,
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
