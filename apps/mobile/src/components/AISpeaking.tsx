import { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, ActivityIndicator } from 'react-native';

type Props = {
  isLoading: boolean;
  isAudioPlaying: boolean;
};

export default function AISpeaking({ isLoading, isAudioPlaying }: Props) {
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
      delay: number
    ) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(opacity, { toValue: 0.55, duration: 200, useNativeDriver: true }),
            Animated.timing(scale, { toValue: 1.6, duration: 1200, useNativeDriver: true }),
          ]),
          Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.parallel([
            Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0, duration: 0, useNativeDriver: true }),
          ]),
        ])
      );

    const breatheAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheScale, { toValue: 1.06, duration: 800, useNativeDriver: true }),
        Animated.timing(breatheScale, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );

    const r1 = makeRingAnim(ring1Scale, ring1Opacity, 0);
    const r2 = makeRingAnim(ring2Scale, ring2Opacity, 600);
    r1.start();
    r2.start();
    breatheAnim.start();

    return () => {
      r1.stop();
      r2.stop();
      breatheAnim.stop();
    };
  }, [isAudioPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={styles.container}>
      <View style={styles.wrapper}>
        <Animated.View
          style={[styles.ring, { opacity: ring1Opacity, transform: [{ scale: ring1Scale }] }]}
        />
        <Animated.View
          style={[styles.ring, { opacity: ring2Opacity, transform: [{ scale: ring2Scale }] }]}
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
    </View>
  );
}

const CIRCLE_SIZE = 120;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wrapper: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    borderWidth: 2,
    borderColor: '#7F77DD',
  },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: '#7F77DD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleLoading: {
    backgroundColor: 'rgba(127, 119, 221, 0.4)',
  },
  label: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
