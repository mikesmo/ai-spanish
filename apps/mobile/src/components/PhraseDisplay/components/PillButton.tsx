import { Pressable, StyleSheet, Text } from "react-native";

export interface PillButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
}

export const PillButton = ({
  label,
  onPress,
  variant = "secondary",
}: PillButtonProps): JSX.Element => (
  <Pressable
    onPress={onPress}
    style={[pillStyles.pill, variant === "primary" ? pillStyles.pillPrimary : pillStyles.pillSecondary]}
  >
    <Text
      style={[
        pillStyles.pillLabel,
        variant === "primary" ? pillStyles.pillLabelPrimary : pillStyles.pillLabelSecondary,
      ]}
    >
      {label}
    </Text>
  </Pressable>
);

/** Shared pill chrome (also used by AutoNextButton in UserFeedback). */
export const pillStyles = StyleSheet.create({
  pill: {
    width: "100%",
    height: 54,
    borderRadius: 9999,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  pillSecondary: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  pillPrimary: {
    backgroundColor: "#1d9e75",
    borderWidth: 1,
    borderColor: "#1d9e75",
  },
  pillLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  pillLabelSecondary: {
    color: "#111827",
  },
  pillLabelPrimary: {
    color: "#ffffff",
  },
});
