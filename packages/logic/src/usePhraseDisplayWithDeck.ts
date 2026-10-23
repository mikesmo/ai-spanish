'use client';

import { useMemo } from 'react';
import type { Phrase, SpeechToTextHandle, TTSAdapter } from './types';
import { usePhraseDisplay, type UsePhraseDisplayOptions } from './usePhraseDisplay';
import type { UseLessonSessionResult } from './useLessonSession';

type HostOptions = Omit<
  UsePhraseDisplayOptions,
  'ttsPhraseIndex' | 'presentationVersion' | 'onPhraseEvent' | 'onPresentationStart'
>;

/**
 * Wires the original `deck` to S3/segment TTS `phraseIndex` for queue-driven
 * `session.phrases` — same pattern web and mobile use.
 */
export function usePhraseDisplayWithDeck(
  deck: Phrase[],
  session: UseLessonSessionResult,
  stt: SpeechToTextHandle,
  tts: TTSAdapter,
  options?: HostOptions,
) {
  const deckIndexById = useMemo(() => {
    const m = new Map<string, number>();
    deck.forEach((p, i) => m.set(p.name, i));
    return m;
  }, [deck]);
  const ttsPhraseIndex = deckIndexById.get(session.currentPhrase.name) ?? 0;

  const display = usePhraseDisplay(session.phrases, stt, tts, {
    ...options,
    onPhraseEvent: session.onPhraseEvent,
    onPresentationStart: session.onPresentationStart,
    presentationVersion: session.presentationVersion,
    ttsPhraseIndex,
  });

  return { display, ttsPhraseIndex };
}
