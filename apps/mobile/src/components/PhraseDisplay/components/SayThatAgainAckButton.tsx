import { FEEDBACK_AUTO_ADVANCE_MS } from "@ai-spanish/logic";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text } from "react-native";
import { pillStyles } from "./PillButton";

const DEFAULT_LABEL = "Say that again";

export interface SayThatAgainAckButtonProps {
  isReplayPlaying: boolean;
  onSayAgain: () => void;
  onAckOkay: () => void;
  /** Visible label; default "Say that again". */
  label?: string;
  /** Progress + timeout duration in ms; default 2000 (recording screen). */
  autoAdvanceMs?: number;
}

/**
 * Full-width pill: progress fill then `onAckOkay`; tap clears timer and runs `onSayAgain`.
 * When `isReplayPlaying`, shows a disabled pill (explain replay in flight).
 */
export const SayThatAgainAckButton = ({
  isReplayPlaying,
  onSayAgain,
  onAckOkay,
  label = DEFAULT_LABEL,
  autoAdvanceMs = FEEDBACK_AUTO_ADVANCE_MS,
}: SayThatAgainAckButtonProps): JSX.Element => {
  const [pillWidth, setPillWidth] = useState(0);
  const fillWidth = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAckOkayRef = useRef(onAckOkay);
  const onSayAgainRef = useRef(onSayAgain);
  onAckOkayRef.current = onAckOkay;
  onSayAgainRef.current = onSayAgain;

  const shouldRunTimer = !isReplayPlaying && pillWidth > 0;

  useEffect(() => {
    if (!shouldRunTimer) return;
    fillWidth.stopAnimation();
    fillWidth.setValue(0);
    timerRef.current = setTimeout(() => onAckOkayRef.current(), autoAdvanceMs);
    Animated.timing(fillWidth, {
      toValue: pillWidth,
      duration: autoAdvanceMs,
      useNativeDriver: false,
    }).start();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [shouldRunTimer, pillWidth, fillWidth, autoAdvanceMs]);

  const handlePress = () => {
    if (isReplayPlaying) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    fillWidth.stopAnimation();
    onSayAgainRef.current();
  };

  if (isReplayPlaying) {
    return (
      <Pressable
        disabled
        style={[pillStyles.pill, pillStyles.pillSecondary, styles.pillWithProgress, styles.pillDisabled]}
      >
        <Text style={[pillStyles.pillLabel, pillStyles.pillLabelSecondary, styles.labelMuted]}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && pillWidth === 0) setPillWidth(w);
      }}
      style={[pillStyles.pill, pillStyles.pillSecondary, styles.pillWithProgress]}
    >
      <Animated.View style={[styles.pillProgressFill, { width: fillWidth }]} />
      <Text style={[pillStyles.pillLabel, pillStyles.pillLabelSecondary, styles.pillLabelOnProgress]}>
        {label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  pillWithProgress: {
    overflow: "hidden",
  },
  pillDisabled: {
    opacity: 0.7,
  },
  pillProgressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "#A8DDD0",
  },
  pillLabelOnProgress: {
    zIndex: 1,
  },
  labelMuted: {
    opacity: 0.5,
  },
});
