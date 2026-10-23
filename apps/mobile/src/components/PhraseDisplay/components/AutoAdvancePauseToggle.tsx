import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";

interface AutoAdvancePauseToggleProps {
  isPaused: boolean;
  onToggle: () => void;
}

/** Full-width pause control for an auto-advance timer (green when paused). */
export const AutoAdvancePauseToggle = ({
  isPaused,
  onToggle,
}: AutoAdvancePauseToggleProps): JSX.Element => (
  <Pressable
    onPress={onToggle}
    accessibilityRole="button"
    accessibilityLabel={isPaused ? "Resume auto-advance" : "Pause auto-advance"}
    style={[styles.pauseToggle, isPaused && styles.pauseToggleActive]}
  >
    <Feather name="pause" size={16} color={isPaused ? "#1D9E75" : "#6b7280"} />
  </Pressable>
);

const styles = StyleSheet.create({
  pauseToggle: {
    width: "100%",
    height: 54,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  pauseToggleActive: {
    borderColor: "#1D9E75",
    backgroundColor: "#E1F5EE",
  },
});
