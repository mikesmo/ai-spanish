import type { JSX } from "react";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { supabase } from "../src/lib/supabase";

type LoginScreenProps = {
  onAuthFailure?: (message: string) => void;
};

export default function LoginScreen({
  onAuthFailure,
}: LoginScreenProps): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(): Promise<void> {
    setMessage(null);
    if (!supabase) {
      const msg =
        "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.";
      setMessage(msg);
      onAuthFailure?.(msg);
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setMessage(error.message);
        onAuthFailure?.(error.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed.";
      setMessage(msg);
      onAuthFailure?.(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.inner}>
        <Text style={styles.heading}>AI Spanish</Text>
        <Text style={styles.subtitle}>Sign in to load lessons</Text>

        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="Email"
          placeholderTextColor="#9ca3af"
          style={styles.input}
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          autoCapitalize="none"
          autoComplete="password"
          placeholder="Password"
          placeholderTextColor="#9ca3af"
          secureTextEntry
          style={styles.input}
          value={password}
          onChangeText={setPassword}
        />

        {message ? <Text style={styles.error}>{message}</Text> : null}

        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={() => void onSubmit()}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            submitting && styles.buttonDisabled,
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonLabel}>Sign in</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  inner: {
    paddingHorizontal: 32,
    paddingVertical: 24,
    gap: 12,
  },
  heading: {
    fontSize: 24,
    fontWeight: "600",
    color: "#111827",
    textAlign: "center",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#111827",
  },
  error: {
    fontSize: 14,
    color: "#b91c1c",
  },
  button: {
    marginTop: 8,
    backgroundColor: "#111827",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonPressed: {
    opacity: 0.9,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
