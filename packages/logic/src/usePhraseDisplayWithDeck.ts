'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { Phrase, SpeechToTextHandle, TTSAdapter } from './types';
import { usePhraseDisplay, type UsePhraseDisplayOptions } from './usePhraseDisplay';
import type { UseLessonSessionResult } from './useLessonSession';
import { buildLessonAudioClipList } from './lessonAudioClips';

type HostOptions = Omit<
  UsePhraseDisplayOptions,
  'ttsPhraseIndex' | 'presentationVersion' | 'onPhraseEvent' | 'onPresentationStart'
>;

/**
 * Wires the original `deck` to S3/segment TTS `phraseIndex` for queue-driven
 * `session.phrases` — same pattern web and mobile use. Also starts the
 * lesson-wide audio preload when the adapter supports it.
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

  // Must run before usePhraseDisplay's bootstrap effect so the first card's
  // presign requests wait on the batch instead of racing it.
  const startPhraseNameRef = useRef(session.currentPhrase.name);
  const { preloadLesson } = tts;
  const s3LessonSegment = options?.s3LessonSegment;
  useEffect(() => {
    if (!preloadLesson) return;
    const controller = new AbortController();
    void preloadLesson(buildLessonAudioClipList(deck, startPhraseNameRef.current), {
      s3LessonSegment,
      signal: controller.signal,
    }).catch(() => {});
    return () => controller.abort();
  }, [deck, preloadLesson, s3LessonSegment]);

  const display = usePhraseDisplay(session.phrases, stt, tts, {
    ...options,
    onPhraseEvent: session.onPhraseEvent,
    onPresentationStart: session.onPresentationStart,
    presentationVersion: session.presentationVersion,
    ttsPhraseIndex,
  });

  return { display, ttsPhraseIndex };
}
