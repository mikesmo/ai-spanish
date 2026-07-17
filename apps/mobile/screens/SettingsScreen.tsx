import {
  CEFR_LEVELS,
  DECLARED_LEVEL_QUERY_KEY,
  putDeclaredLevel,
  useDeclaredLevelQuery,
  type CefrLevel,
} from "@ai-spanish/logic";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { mobileLessonProgressFetcher } from "../src/services/lessonProgressTransport";

type SettingsScreenProps = {
  onBack: () => void;
};

export default function SettingsScreen({ onBack }: SettingsScreenProps): JSX.Element {
  const queryClient = useQueryClient();
  const {
    data: declaredLevel,
    isLoading,
    isError,
  } = useDeclaredLevelQuery(mobileLessonProgressFetcher);

  const declareLevelMutation = useMutation({
    mutationFn: (level: CefrLevel) => putDeclaredLevel(mobileLessonProgressFetcher, level),
    onSuccess: (ok, level) => {
      if (!ok) return;
      queryClient.setQueryData(DECLARED_LEVEL_QUERY_KEY, level);
    },
  });

  const pendingLevel = declareLevelMutation.isPending
    ? declareLevelMutation.variables
    : undefined;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <Text style={styles.heading}>Settings</Text>
          <View style={styles.backButtonSpacer} />
        </View>

        <Text style={styles.sectionTitle}>Your Spanish level</Text>
        <Text style={styles.sectionDescription}>
          Tell us your CEFR level so we can mark words and grammar you should
          already know. You can change this any time.
        </Text>

        {isLoading ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator />
          </View>
        ) : isError ? (
          <Text style={styles.errorText}>Failed to load your level.</Text>
        ) : (
          <View style={styles.levelGrid}>
            {CEFR_LEVELS.map((level) => {
              const isSelected = declaredLevel === level;
              const isPending = pendingLevel === level;
              return (
                <Pressable
                  key={level}
                  disabled={declareLevelMutation.isPending}
                  onPress={() => declareLevelMutation.mutate(level)}
                  style={({ pressed }) => [
                    styles.levelPill,
                    isSelected && styles.levelPillSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[styles.levelPillText, isSelected && styles.levelPillTextSelected]}
                  >
                    {isPending ? "…" : level}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {declareLevelMutation.isError ||
        (declareLevelMutation.isSuccess && declareLevelMutation.data === false) ? (
          <Text style={styles.errorText}>Could not save your level. Try again.</Text>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 32,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  backButtonSpacer: {
    width: 40,
  },
  pressed: {
    backgroundColor: "#f3f4f6",
  },
  backGlyph: {
    fontSize: 28,
    lineHeight: 32,
    color: "#6b7280",
  },
  heading: {
    flex: 1,
    fontSize: 20,
    fontWeight: "600",
    color: "#111827",
    textAlign: "center",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: "#111827",
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 24,
    lineHeight: 20,
  },
  centerBlock: {
    alignItems: "center",
    paddingVertical: 16,
  },
  levelGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  levelPill: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
    backgroundColor: "#ffffff",
  },
  levelPillSelected: {
    borderColor: "#111827",
    backgroundColor: "#111827",
  },
  levelPillText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
  },
  levelPillTextSelected: {
    color: "#ffffff",
  },
  errorText: {
    marginTop: 16,
    fontSize: 14,
    color: "#D85A30",
  },
});
