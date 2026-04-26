import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { getPhraseHeroLayout, HERO_CIRCLE_SIZE } from "../heroLayout";
import type { AISpeakingProps } from "../PhraseDisplay.types";

export const AISpeaking = ({
  isLoading,
  isAudioPlaying,
  englishQuestion,
  spanishLine,
}: AISpeakingProps): JSX.Element => {
  const [hero, setHero] = useState<ReturnType<typeof getPhraseHeroLayout>>(null);
  const onStageLayout = (e: LayoutChangeEvent) => {
    setHero(getPhraseHeroLayout(e.nativeEvent.layout));
  };

  const ring1Scale = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0)).current;
  const ring2Scale = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0)).current;
  const breatheScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isAudioPlaying) {
      ring1Opacity.setValue(0);
      ring2Opacity.setValue(0);
      breatheScale.setValue(1);
      return;
    }

    const makeRingAnim = (
      scale: Animated.Value,
      opacity: Animated.Value,
      delay: number,
    ) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(opacity, {
              toValue: 0.55,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(scale, {
              toValue: 1.6,
              duration: 1200,
              useNativeDriver: true,
            }),
          ]),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.parallel([
            Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0, duration: 0, useNativeDriver: true }),
          ]),
        ]),
      );

    const breatheAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheScale, {
          toValue: 1.06,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(breatheScale, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );

    const ring1Anim = makeRingAnim(ring1Scale, ring1Opacity, 0);
    const ring2Anim = makeRingAnim(ring2Scale, ring2Opacity, 600);
    ring1Anim.start();
    ring2Anim.start();
    breatheAnim.start();

    return () => {
      ring1Anim.stop();
      ring2Anim.stop();
      breatheAnim.stop();
    };
  }, [
    breatheScale,
    isAudioPlaying,
    ring1Opacity,
    ring1Scale,
    ring2Opacity,
    ring2Scale,
  ]);

  return (
    <View style={styles.container} onLayout={onStageLayout}>
      {hero != null ? (
        <View
          style={[
            styles.heroWrapper,
            {
              left: hero.circleLeft,
              top: hero.circleTop,
              width: HERO_CIRCLE_SIZE,
              height: HERO_CIRCLE_SIZE,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.ring,
              { opacity: ring1Opacity, transform: [{ scale: ring1Scale }] },
            ]}
          />
          <Animated.View
            style={[
              styles.ring,
              { opacity: ring2Opacity, transform: [{ scale: ring2Scale }] },
            ]}
          />
          <Animated.View
            style={[
              styles.circle,
              isLoading && styles.circleLoading,
              { transform: [{ scale: breatheScale }] },
            ]}
          >
            {isLoading ? (
              <ActivityIndicator color="rgba(255,255,255,0.7)" size="small" />
            ) : (
              <Text style={styles.label}>AI</Text>
            )}
          </Animated.View>
        </View>
      ) : null}
      {hero != null && (englishQuestion || spanishLine) ? (
        <View
          style={[
            styles.revealBlock,
            {
              top: hero.textBelowTop,
            },
          ]}
        >
          {englishQuestion ? <Text style={styles.englishQuestion}>{englishQuestion}</Text> : null}
          {spanishLine ? <Text style={styles.spanishLine}>{spanishLine}</Text> : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
  },
  heroWrapper: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: HERO_CIRCLE_SIZE,
    height: HERO_CIRCLE_SIZE,
    borderRadius: HERO_CIRCLE_SIZE / 2,
    borderWidth: 2,
    borderColor: "#7F77DD",
  },
  circle: {
    width: HERO_CIRCLE_SIZE,
    height: HERO_CIRCLE_SIZE,
    borderRadius: HERO_CIRCLE_SIZE / 2,
    backgroundColor: "#7F77DD",
    alignItems: "center",
    justifyContent: "center",
  },
  circleLoading: {
    backgroundColor: "rgba(127, 119, 221, 0.4)",
  },
  label: {
    color: "white",
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  revealBlock: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: 8,
    alignItems: "center",
    maxWidth: "100%",
  },
  englishQuestion: {
    textAlign: "center",
    fontSize: 15,
    color: "#6B7280",
    marginBottom: 8,
  },
  spanishLine: {
    textAlign: "center",
    fontSize: 20,
    fontWeight: "500",
    color: "#1D1D1D",
  },
});
