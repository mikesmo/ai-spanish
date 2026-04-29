import type { JSX } from "react";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import AppInner from "./AppInner";
import LoginScreen from "./screens/LoginScreen";
import { supabase } from "./src/lib/supabase";

export default function App(): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!supabase) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>
          Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to sign in.
        </Text>
      </View>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  return <AppInner />;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#ffffff",
  },
  message: {
    fontSize: 15,
    color: "#374151",
    textAlign: "center",
  },
});
