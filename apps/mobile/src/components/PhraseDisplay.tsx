import { View, Text, StyleSheet } from 'react-native';
import { usePhraseDisplay } from '@ai-spanish/logic';
import { useTTS, useSTT } from '@ai-spanish/claude-api';
import type { Phrase } from '@ai-spanish/logic';
import AISpeaking from './AISpeaking';
import UserRecording from './UserRecording';
import UserFeedback from './UserFeedback';

type Props = { phrases: Phrase[] };

export default function PhraseDisplay({ phrases }: Props) {
  const tts = useTTS();
  const stt = useSTT();
  const display = usePhraseDisplay(phrases, stt, tts);

  return (
    <View style={styles.container}>
      <Text style={styles.counter}>
        {display.currentIndex + 1} / {display.totalPhrases}
      </Text>

      {(display.status === 'loading' || display.status === 'idle') && (
        <AISpeaking isLoading={display.status === 'loading'} isAudioPlaying={display.isAudioPlaying} />
      )}

      {(display.status === 'recording' || display.status === 'tryAgain') && (
        <UserRecording
          englishText={display.currentPhrase.English.question}
          transcription={display.caption}
          isCorrect={display.isCorrect}
          onShowAnswer={display.handleShowAnswer}
        />
      )}

      {display.status === 'answer' && (
        <UserFeedback
          transcription={display.caption}
          spanishPhrase={display.spanishText}
          isCorrect={display.isCorrect}
          isAudioPlaying={display.isAudioPlaying}
          speed={display.speed}
          onSpeedChange={display.setSpeed}
          onReplay={display.handleReplay}
          onTryAgain={display.handleTryAgain}
          onNext={display.handleNext}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    backgroundColor: '#ffffff',
  },
  counter: {
    fontSize: 13,
    color: '#9ca3af',
    alignSelf: 'flex-end',
    marginBottom: 16,
  },
});
