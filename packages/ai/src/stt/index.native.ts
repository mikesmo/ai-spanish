import { useRef, useState } from 'react';
import { useDeepgramSpeechToText } from 'react-native-deepgram';
import type { SpeechToTextHandle } from '@ai-spanish/logic';

type TranscriptEvent = { isFinal?: boolean };

export function useSTT(): SpeechToTextHandle {
  const [caption, setCaption] = useState('');
  const [isFinal, setIsFinal] = useState(false);
  const paragraphRef = useRef('');
  const lastCaptionRef = useRef('');

  const { startListening, stopListening, state } = useDeepgramSpeechToText({
    trackState: true,
    onTranscript: (text: string, event?: TranscriptEvent) => {
      if (text === '') {
        if (event?.isFinal) { paragraphRef.current = lastCaptionRef.current; setIsFinal(true); }
        return;
      }
      const newCaption = (paragraphRef.current + ' ' + text).trim();
      lastCaptionRef.current = newCaption;
      setCaption(newCaption);
      if (event?.isFinal) { paragraphRef.current = newCaption; setIsFinal(true); }
      else setIsFinal(false);
    },
    onError: (err: unknown) => console.error('[Deepgram STT]', err),
    live: {
      model: 'nova-2',
      language: 'es',
      interimResults: true,
      punctuate: true,
      utteranceEndMs: 3000,
      endpointing: 1000,
    },
  });

  const clearTranscription = () => {
    setCaption('');
    setIsFinal(false);
    paragraphRef.current = '';
    lastCaptionRef.current = '';
  };

  return {
    start: () => startListening(),
    stop: () => stopListening(),
    isRecording: state?.status === 'listening',
    caption,
    isFinal,
    clearTranscription,
  };
}
