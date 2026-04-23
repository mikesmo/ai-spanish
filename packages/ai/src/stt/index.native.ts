import { useCallback, useRef, useState } from 'react';
import { useDeepgramSpeechToText } from 'react-native-deepgram';
import {
  getDefaultLearningPipelineDebug,
  logSttAdapterStart,
  logSttAdapterStop,
  logSttClear,
  logSttSegment,
  logSttUtteranceEnd,
  type SpeechToTextHandle,
  type SpokenWord,
  type SttStartOptions,
} from '@ai-spanish/logic';

type TranscriptEvent = { isFinal?: boolean };

/**
 * Deepgram live options — mirrors the web adapter's `DEEPGRAM_OPTIONS` so
 * both platforms transcribe with the same behaviour. Key notes:
 *   - `language: 'es-ES'` for Castilian Spanish parity with web.
 *   - `smartFormat: true` supersedes `punctuate` — enables capitalization,
 *     punctuation, numeric normalization, etc. in one knob.
 *   - `fillerWords` is NOT enabled: we don't want "um"/"uh"/"eh" tokens
 *     muddying the accuracy diff for beginner learners.
 *   - `endpointing: 1500` matches web: 1500 ms of silence is Deepgram's
 *     VAD-driven utterance close signal (fires `is_final=true` +
 *     `speech_final=true`).
 *   - `utteranceEndMs` is intentionally unset. Its word-timing-based
 *     silence detector was empirically firing prematurely on beginner
 *     pauses on web, so both platforms rely solely on VAD endpointing
 *     (plus our client-side INACTIVITY_WATCHDOG_MS fallback below).
 */
const DEEPGRAM_LIVE_OPTIONS = {
  model: 'nova-2',
  language: 'es-ES',
  interimResults: true,
  smartFormat: true,
  endpointing: 1500,
} as const;

/**
 * Client-side inactivity watchdog (parity with web): if the native SDK
 * fails to emit an `isFinal` event within this many milliseconds of the
 * most recent transcript carrying new text, close the utterance locally.
 * 3000 ms tolerates a mid-phrase vocab-retrieval pause without feeling
 * laggy when a genuinely-ended utterance simply failed to trigger
 * end-of-speech detection. See also: the web `INACTIVITY_WATCHDOG_MS`.
 */
const INACTIVITY_WATCHDOG_MS = 3000;

/**
 * Initial-silence safety net: if the mic starts but no transcript ever
 * arrives with non-empty text, we have no "last words at" moment to drive
 * the inactivity watchdog from. Arm this on start and clear it on the
 * first real word. If it fires, the attempt closes with zero words rather
 * than hanging the UI — user can retry immediately.
 */
const INITIAL_SILENCE_TIMEOUT_MS = 6000;

/**
 * Note: on native, the `react-native-deepgram` SDK surface only exposes
 * `isFinal` on its `DeepgramTranscriptEvent`. The raw Deepgram
 * `speech_final` signal (which web uses as the true utterance-close
 * trigger) is not forwarded by the native SDK. As a result we treat any
 * `isFinal === true` as an utterance close here; this is slightly coarser
 * than web and explains why the inactivity/initial-silence timers below
 * are doubly important on mobile.
 */
export function useSTT(): SpeechToTextHandle {
  const [caption, setCaption] = useState('');
  const [isFinal, setIsFinalState] = useState(false);
  const paragraphRef = useRef('');
  const lastCaptionRef = useRef('');
  const finalizedCountRef = useRef(0);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // `stopListening` is returned by the SDK hook, but our timer callbacks
  // need to reference it inside the `onTranscript` closure that's passed
  // INTO the same hook. Break the cycle with a ref we overwrite each
  // render after the hook has returned.
  const stopListeningRef = useRef<() => void>(() => {});
  const debugRef = useRef(getDefaultLearningPipelineDebug());
  debugRef.current = getDefaultLearningPipelineDebug();

  const clearInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  const clearInitialSilenceTimer = useCallback(() => {
    if (initialSilenceTimerRef.current) {
      clearTimeout(initialSilenceTimerRef.current);
      initialSilenceTimerRef.current = null;
    }
  }, []);

  // Close the utterance locally when neither the SDK's `isFinal` nor any
  // new transcript has arrived inside the watchdog window. Synthesizes
  // an utterance-end by committing the last interim caption and flipping
  // `isFinal` so `usePhraseDisplay` advances out of the recording state.
  const fireWatchdog = useCallback(() => {
    inactivityTimerRef.current = null;
    paragraphRef.current = lastCaptionRef.current;
    setIsFinalState(true);
    finalizedCountRef.current += 1;
    try {
      stopListeningRef.current();
    } catch {
      // swallow — we've already committed state and want to stay silent
      // here so the UI can advance cleanly.
    }
    if (debugRef.current) {
      logSttUtteranceEnd({
        totalFinalized: finalizedCountRef.current,
        caption: lastCaptionRef.current,
        trigger: 'inactivity-watchdog',
      });
    }
  }, []);

  const armInactivityWatchdog = useCallback(() => {
    clearInactivityTimer();
    inactivityTimerRef.current = setTimeout(
      fireWatchdog,
      INACTIVITY_WATCHDOG_MS,
    );
  }, [clearInactivityTimer, fireWatchdog]);

  const { startListening, stopListening, state } = useDeepgramSpeechToText({
    trackState: true,
    onTranscript: (text: string, event?: TranscriptEvent) => {
      // Any message (text or empty) means the socket is alive — cancel
      // the initial-silence watchdog once we've heard from Deepgram.
      if (text !== '') clearInitialSilenceTimer();

      if (text === '') {
        if (event?.isFinal) {
          paragraphRef.current = lastCaptionRef.current;
          setIsFinalState(true);
          finalizedCountRef.current += 1;
          clearInactivityTimer();
          if (debugRef.current) {
            logSttSegment({
              isFinal: true,
              segmentWords: 0,
              totalFinalized: finalizedCountRef.current,
              totalWords: lastCaptionRef.current
                .split(/\s+/)
                .filter(Boolean).length,
              transcript: '',
              captionLen: lastCaptionRef.current.length,
            });
            logSttUtteranceEnd({
              totalFinalized: finalizedCountRef.current,
              caption: lastCaptionRef.current,
              trigger: 'speech-final',
            });
          }
        }
        return;
      }

      const newCaption = (paragraphRef.current + ' ' + text).trim();
      lastCaptionRef.current = newCaption;
      setCaption(newCaption);
      const segmentWordCount = text.split(/\s+/).filter(Boolean).length;

      if (event?.isFinal) {
        paragraphRef.current = newCaption;
        setIsFinalState(true);
        finalizedCountRef.current += 1;
        clearInactivityTimer();
      } else {
        setIsFinalState(false);
        armInactivityWatchdog();
      }

      if (debugRef.current) {
        logSttSegment({
          isFinal: !!event?.isFinal,
          segmentWords: segmentWordCount,
          totalFinalized: finalizedCountRef.current,
          totalWords: newCaption.split(/\s+/).filter(Boolean).length,
          transcript: text,
          captionLen: newCaption.length,
        });
        if (event?.isFinal) {
          logSttUtteranceEnd({
            totalFinalized: finalizedCountRef.current,
            caption: newCaption,
            trigger: 'speech-final',
          });
        }
      }
    },
    onError: (err: unknown) => console.error('[Deepgram STT]', err),
    live: DEEPGRAM_LIVE_OPTIONS,
  });

  stopListeningRef.current = stopListening;

  const clearTranscription = useCallback(() => {
    const prevCaptionLen = lastCaptionRef.current.length;
    const prevFinalized = finalizedCountRef.current;
    setCaption('');
    setIsFinalState(false);
    paragraphRef.current = '';
    lastCaptionRef.current = '';
    finalizedCountRef.current = 0;
    clearInactivityTimer();
    clearInitialSilenceTimer();
    if (debugRef.current) {
      logSttClear({ prevFinalized, prevCaptionLen });
    }
  }, [clearInactivityTimer, clearInitialSilenceTimer]);

  // The `react-native-deepgram` SDK surface only yields an opaque transcript
  // string via `onTranscript(text, event)`, so we can't produce per-word
  // timestamps here today. Expose an empty `words[]` so consumers gracefully
  // fall back to the no-fluency mastery formula (see packages/logic/mastery).
  const words: SpokenWord[] = [];

  return {
    // TODO(native-stt-keywords): `react-native-deepgram` doesn't expose the
    // underlying WebSocket query params, so we can't forward options.keywords
    // to Deepgram's `keywords` biasing on native today. Accept the arg for
    // API parity with the web adapter; revisit when the underlying SDK
    // gains a keywords knob.
    start: (options?: SttStartOptions) => {
      if (debugRef.current) {
        logSttAdapterStart({
          connState: 'unknown',
          micState: state?.status ?? 'idle',
          path: 'startMic-direct',
          keywords: options?.keywords,
        });
      }
      clearInitialSilenceTimer();
      initialSilenceTimerRef.current = setTimeout(() => {
        initialSilenceTimerRef.current = null;
        // No transcript ever arrived — commit nothing, flip final so the
        // UI advances, and stop the SDK.
        setIsFinalState(true);
        try {
          stopListeningRef.current();
        } catch {}
        if (debugRef.current) {
          logSttUtteranceEnd({
            totalFinalized: finalizedCountRef.current,
            caption: lastCaptionRef.current,
            trigger: 'inactivity-watchdog',
          });
        }
      }, INITIAL_SILENCE_TIMEOUT_MS);
      startListening();
    },
    stop: () => {
      if (debugRef.current) {
        logSttAdapterStop({
          connState: 'unknown',
          micState: state?.status ?? 'idle',
        });
      }
      clearInactivityTimer();
      clearInitialSilenceTimer();
      stopListening();
    },
    isRecording: state?.status === 'listening',
    caption,
    words,
    isFinal,
    clearTranscription,
  };
}
