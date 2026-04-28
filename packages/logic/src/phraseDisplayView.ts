import type { Phrase, UIStatus } from './types';

/**
 * Props for AISpeaking on web and mobile — derived from
 * {@link getAisSpeakingViewModel}; keep presentation logic in one place.
 */
export type AisSpeakingViewModel = {
  isLoading: boolean;
  isAudioPlaying: boolean;
  /** Reserved for future AISpeaking copy; currently always null. */
  englishQuestion: string | null;
  /** Reserved for future AISpeaking copy; currently always null. */
  spanishLine: string | null;
};

export function getAisSpeakingViewModel(input: {
  status: UIStatus;
  isAudioPlaying: boolean;
  currentPhrase: Phrase;
  spanishText: string;
  isFirstSessionPresentationOfCurrentPhrase: boolean;
}): AisSpeakingViewModel {
  const { status, isAudioPlaying } = input;
  return {
    isLoading: status === 'loading',
    isAudioPlaying,
    englishQuestion: null,
    spanishLine: null,
  };
}

export type UserRecordingViewModel = {
  englishText: string;
  spanishLine: string | null;
  /** When true, show {@link spanishLine} on the recording screen (bilingual hint). */
  showSpanishTranslation: boolean;
  showEnglishInHint: boolean;
};

/**
 * The smallest N distinct {@link Phrase.index} values present in `deck` (lesson file order).
 */
export function getFirstNLessonOrdersInDeck(deck: Phrase[], phraseCount: number): Set<number> {
  if (phraseCount <= 0 || deck.length === 0) return new Set();
  const sortedUnique = [...new Set(deck.map((p) => p.index))].sort((a, b) => a - b);
  return new Set(sortedUnique.slice(0, phraseCount));
}

const SPANISH_ON_RECORDING_FIRST_PHRASE_COUNT = 2;

/**
 * Text hints while the learner is recording (shared recording / try-again status).
 */
export function getUserRecordingViewModel(input: {
  currentPhrase: Phrase;
  spanishText: string;
  isFirstSessionPresentationOfCurrentPhrase: boolean;
  hasUsedTryAgainOnCurrentCard: boolean;
  /** Full lesson deck (same array passed to the session). Drives which lesson orders show Spanish. */
  lessonDeck: Phrase[];
}): UserRecordingViewModel {
  const {
    currentPhrase,
    spanishText,
    isFirstSessionPresentationOfCurrentPhrase,
    hasUsedTryAgainOnCurrentCard,
    lessonDeck,
  } = input;
  const showSpanishTranslation = getFirstNLessonOrdersInDeck(
    lessonDeck,
    SPANISH_ON_RECORDING_FIRST_PHRASE_COUNT,
  ).has(currentPhrase.index);
  return {
    englishText: currentPhrase.English.question,
    spanishLine:
      currentPhrase.type === 'new' &&
      isFirstSessionPresentationOfCurrentPhrase &&
      !hasUsedTryAgainOnCurrentCard
        ? spanishText
        : null,
    showSpanishTranslation,
    showEnglishInHint: isFirstSessionPresentationOfCurrentPhrase,
  };
}

/** Shell prop: the full deck before `useLessonSession` narrows the queue. */
export type PhraseDisplayHostProps = {
  phrases: Phrase[];
};

export type UserRecordingViewProps = {
  englishText: string;
  spanishLine?: string | null;
  /** When false, English-only hint on the recording screen. @defaultValue false */
  showSpanishTranslation?: boolean;
  showEnglishInHint?: boolean;
  transcription: string;
  isRecording: boolean;
  isCorrect: boolean;
  onShowAnswer: () => void;
  /** When false, hide mic circle and recording affordances (e.g. recordingPriming). */
  showMicChrome?: boolean;
};

export type UserFeedbackViewProps = {
  transcription: string;
  spanishPhrase: string;
  isCorrect: boolean;
  isAudioPlaying: boolean;
  speed: '1x' | 'slow';
  onSpeedChange: (speed: '1x' | 'slow') => void;
  onReplay: () => void;
  onTryAgain: () => void;
  onNext: () => void;
};
