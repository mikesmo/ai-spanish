import type { PartOfSpeech } from './weights';

export type Language = 'en' | 'es';

export interface WordMeta {
  word: string;
  type: PartOfSpeech;
  weight: number;
}

export interface Phrase {
  id: string;
  English: { intro: string; question: string };
  Spanish: {
    grammar: string;
    answer: string;
    words: WordMeta[];
  };
}

export type PhraseState = 'new' | 'learning' | 'stabilizing' | 'mastered';

export interface PhraseProgress {
  phraseId: string;
  masteryScore: number;
  stabilityScore: number;
  state: PhraseState;
  lastSeenAt: number;
  nextReviewAt: number;
}

export interface SpokenWord {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export type UIStatus = 'loading' | 'idle' | 'recording' | 'answer' | 'tryAgain';

export type TTSAdapter = {
  /**
   * Play audio for the given text and language.
   * When `phraseIndex` is provided, adapters that support S3 delivery can use
   * it to derive the clip key instead of synthesizing from text.
   */
  play: (text: string, lang: Language, rate?: number, phraseIndex?: number) => Promise<void>;
  /**
   * Prefetch / warm-up audio so playback starts immediately.
   * `phraseIndex` has the same semantics as in `play`.
   */
  prefetch: (text: string, lang: Language, phraseIndex?: number) => Promise<void>;
  stop: () => void;
};

/**
 * Per-attempt options passed to `SpeechToTextHandle.start`. Adapters that
 * don't support a given option should ignore it gracefully (documented on the
 * adapter).
 */
export type SttStartOptions = {
  /**
   * Target words to bias the ASR toward for this attempt, typically the
   * tokens of the current phrase. Web adapter forwards these to Deepgram's
   * `keywords` parameter (Nova-2). Native adapter currently ignores this
   * until the underlying SDK exposes the equivalent knob.
   */
  keywords?: string[];
};

export type SpeechToTextHandle = {
  start: (options?: SttStartOptions) => void;
  stop: () => void | Promise<void>;
  isRecording: boolean;
  caption: string;
  /** Word-level timestamps for the active attempt, if the adapter supports them. */
  words: SpokenWord[];
  isFinal: boolean;
  clearTranscription: () => void;
};

export interface ScoreBreakdown {
  accuracy: number;
  fluency: number | null;
  mastery: number;
  isAccuracySuccess: boolean;
}

export type PhraseDisplayAPI = {
  status: UIStatus;
  currentIndex: number;
  totalPhrases: number;
  currentPhrase: Phrase;
  englishText: string;
  spanishText: string;
  caption: string;
  isCorrect: boolean;
  isAudioPlaying: boolean;
  speed: '1x' | 'slow';
  setSpeed: (s: '1x' | 'slow') => void;
  handleShowAnswer: () => void;
  handleTryAgain: () => void;
  handleNext: () => void;
  handleReplay: () => Promise<void>;
  /**
   * Score breakdown for the most recent first-attempt; null until the first
   * attempt of the current phrase completes.
   */
  lastScoreBreakdown: ScoreBreakdown | null;
};
