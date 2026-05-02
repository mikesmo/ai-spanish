import type { PartOfSpeech } from './weights';

export type Language = 'en' | 'es';

export interface WordMeta {
  word: string;
  type: PartOfSpeech;
  weight: number;
}

export type PhraseLessonType = 'new' | 'composite';

export interface Phrase {
  /** Stable slug for the phrase (e.g. transcript key / logging). */
  name: string;
  /** 0-based phrase index in the lesson file (deck position). Audio clip ids use `name` instead of this index. */
  index: number;
  /** Lesson grouping label from transcript JSON (e.g. "Polite phrases"). */
  category?: string;
  /**
   * Lesson card kind from JSON. When `'new'`, the first in-session
   * presentation may show a Spanish pronunciation example (audio + text) on
   * AISpeaking after the English prompt; revisits skip that phase.
   * `'composite'` marks other cards (same UI behavior as non-`new` for
   * pronunciation-example eligibility).
   */
  type?: PhraseLessonType;
  English: {
    'first-intro': string;
    'second-intro': string;
    question: string;
  };
  Spanish: {
    grammar: string;
    /** Teaching/highlight grammar line from newer transcript JSON (optional). */
    newGrammar?: string;
    /** New vocabulary chunk from newer transcript JSON (optional). */
    newWords?: string;
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
  /**
   * Phrase is eligible for the scheduled-review bucket when the host’s
   * `completedLessonCount` (fully finished lesson runs) is >= this index.
   */
  dueOnLessonSessionIndex: number;
  /**
   * Last cross-session spacing in whole lessons (drives geometric growth in
   * the mastered band).
   */
  srsSpacingLessons: number;
}

export interface SpokenWord {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

/**
 * `pronunciationExample` is used only for `Phrase.type === 'new'` on the
 * first presentation of that phrase name in the current session.
 *
 * `recordingPriming` — after bootstrap TTS, optional clip before the mic opens
 * for the first three phrases in the deck on first presentation only (not on
 * revisits; only when the host passes `playRecordingPrimingAudio`).
 */
export type UIStatus =
  | 'loading'
  | 'idle'
  | 'pronunciationExample'
  | 'recordingPriming'
  | 'recording'
  | 'answer'
  | 'tryAgain';

/**
 * Optional hints for TTS. Segment-based adapters (e.g. S3 clip playback) may
 * use them; on-the-fly TTS can ignore.
 */
export type TtsAdapterOptions = {
  /**
   * When true, the first English clip is `first-intro`; when false or omitted,
   * it is `second-intro`. `usePhraseDisplay` sets this false for repeat
   * in-session presentations when `Phrase.English['first-intro']` is non-empty.
   */
  englishUseFirstIntro?: boolean;
  /**
   * When true, append `question` after the intro clip (back-to-back). Set when
   * the active intro text (`first-intro` or `second-intro`) ends with `:` after
   * `trimEnd()`.
   */
  englishAppendQuestion?: boolean;
  /**
   * When aborted, in-flight S3/playback work should no-op. Used by
   * `usePhraseDisplay` during phrase bootstrap to cancel obsolete audio.
   */
  signal?: AbortSignal;
  /**
   * S3 path segment for batch-uploaded clips (e.g. `lesson1`), sent as
   * `/api/audio?lesson=` on web. Omitted or empty uses the server default env.
   */
  s3LessonSegment?: string;
};

export type TTSAdapter = {
  /**
   * Play audio for the given text and language.
   * When `phraseName` is provided, adapters that support S3 delivery can use
   * it to derive the clip key instead of synthesizing from text. Clip keys
   * follow `{name}-{segment}` (e.g. `perdona-first-intro`).
   */
  play: (
    text: string,
    lang: Language,
    rate?: number,
    phraseName?: string,
    options?: TtsAdapterOptions
  ) => Promise<void>;
  /**
   * Prefetch / warm-up audio so playback starts immediately.
   * `phraseName` has the same semantics as in `play`.
   */
  prefetch: (
    text: string,
    lang: Language,
    phraseName?: string,
    options?: TtsAdapterOptions,
  ) => Promise<void>;
  stop: () => void;
};

/**
 * Per-attempt options passed to `SpeechToTextHandle.start`. Adapters that
 * don't support a given option should ignore it gracefully (documented on the
 * adapter).
 */
export type SttStartOptions = {
  /**
   * Target words to bias the ASR toward for this attempt. The learning pipeline
   * supplies this when the phrase's `Spanish.words` has one or two entries
   * (from lesson JSON). Web and native adapters map non-empty arrays to
   * Deepgram's live `keywords` (Nova-2) using `toDeepgramLiveKeywordParams`
   * from `./deepgramKeywords`.
   */
  keywords?: string[];
  /**
   * When present and aborted, `start` is a no-op. Used by the phrase bootstrap
   * so in-flight work can be cancelled on phrase change or unmount.
   */
  signal?: AbortSignal;
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
  /** Non-null when the last `start()` attempt failed (e.g. auth key fetch error). Cleared on the next `start()`. */
  error: string | null;
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
  /**
   * `exitToLoading`: set when another card will load — leaves the feedback
   * screen in the same paint as clearing STT, before `advance()` updates the
   * target phrase (avoids a flash of the wrong/incorrect diff layout).
   */
  handleNext: (options?: { exitToLoading?: boolean }) => void;
  handleReplay: () => Promise<void>;
  /**
   * True after the user taps Try Again for the current card; reset when the
   * phrase (re)presents. Used for “first pass” UI on the answer screen.
   */
  hasUsedTryAgainOnCurrentCard: boolean;
  /**
   * True the first time this phrase name is presented in the current session
   * (requeues / revisits are false). Drives on-screen English prompt hints.
   */
  isFirstSessionPresentationOfCurrentPhrase: boolean;
  /**
   * Score breakdown for the most recent first-attempt; null until the first
   * attempt of the current phrase completes.
   */
  lastScoreBreakdown: ScoreBreakdown | null;
};
