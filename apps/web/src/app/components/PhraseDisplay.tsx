'use client';

import { usePhraseDisplay } from '@ai-spanish/logic';
import { useTTS, useSTT } from '@ai-spanish/ai';
import type { Phrase } from '@ai-spanish/logic';
import AISpeaking from './phrase-display/AISpeaking';
import UserRecording from './phrase-display/UserRecording';
import UserFeedback from './phrase-display/UserFeedback';

type Props = { phrases: Phrase[] };

export default function PhraseDisplay({ phrases }: Props) {
  const tts = useTTS();
  const stt = useSTT();
  const display = usePhraseDisplay(phrases, stt, tts);

  return (
    <div className="w-full max-w-[390px] mx-auto bg-white flex flex-col items-center py-16 px-8 min-h-[500px]">

      <p className="text-[13px] text-gray-400 self-end mb-8">
        {display.currentIndex + 1} / {display.totalPhrases}
      </p>

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
    </div>
  );
}
