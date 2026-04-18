import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { PhraseDisplay } from '../src/components/PhraseDisplay/index';
import { useTranscriptQuery } from '../src/hooks/useTranscriptQuery';

export default function HomeScreen(): JSX.Element {
  const {
    data: phrases,
    isLoading,
    isError,
    error,
  } = useTranscriptQuery();

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
      <PhraseDisplay phrases={phrases} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
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
