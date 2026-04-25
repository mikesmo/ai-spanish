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
  showEnglishInHint: boolean;
};

/**
 * Text hints while the learner is recording (shared recording / try-again status).
 */
export function getUserRecordingViewModel(input: {
  currentPhrase: Phrase;
  spanishText: string;
  isFirstSessionPresentationOfCurrentPhrase: boolean;
  hasUsedTryAgainOnCurrentCard: boolean;
}): UserRecordingViewModel {
  const {
    currentPhrase,
    spanishText,
    isFirstSessionPresentationOfCurrentPhrase,
    hasUsedTryAgainOnCurrentCard,
  } = input;
  return {
    englishText: currentPhrase.English.question,
    spanishLine:
      currentPhrase.type === 'new' &&
      isFirstSessionPresentationOfCurrentPhrase &&
      !hasUsedTryAgainOnCurrentCard
        ? spanishText
        : null,
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
  showEnglishInHint?: boolean;
  transcription: string;
  isRecording: boolean;
  isCorrect: boolean;
  onShowAnswer: () => void;
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
