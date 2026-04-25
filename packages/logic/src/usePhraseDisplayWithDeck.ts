'use client';

import { useMemo, useRef } from 'react';
import { runPhraseFeedbackNext } from './phraseFeedbackNext';
import type { Phrase, SpeechToTextHandle, TTSAdapter } from './types';
import { usePhraseDisplay, type UsePhraseDisplayOptions } from './usePhraseDisplay';
import type { UseLessonSessionResult } from './useLessonSession';

type HostOptions = Omit<
  UsePhraseDisplayOptions,
  | 'ttsPhraseIndex'
  | 'presentationVersion'
  | 'onPhraseEvent'
  | 'onPresentationStart'
  | 'onSkipAnswerScreenAfterSuccess'
>;

/**
 * Wires the original `deck` to S3/segment TTS `phraseIndex` and React Query–style
 * `runPhraseFeedbackNext` (skip-answer success path) for queue-driven
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
    deck.forEach((p, i) => m.set(p.id, i));
    return m;
  }, [deck]);
  const ttsPhraseIndex = deckIndexById.get(session.currentPhrase.id) ?? 0;
  const runFeedbackNextRef = useRef<() => void>(() => {});

  const display = usePhraseDisplay(session.phrases, stt, tts, {
    ...options,
    onPhraseEvent: session.onPhraseEvent,
    onPresentationStart: session.onPresentationStart,
    presentationVersion: session.presentationVersion,
    ttsPhraseIndex,
    onSkipAnswerScreenAfterSuccess: () => runFeedbackNextRef.current(),
  });
  runFeedbackNextRef.current = () => runPhraseFeedbackNext(display, session);

  return { display, ttsPhraseIndex };
}
