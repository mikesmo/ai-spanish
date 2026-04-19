export type Language = 'en' | 'es';

export type Phrase = {
  English: { intro: string; question: string };
  Spanish: { grammar: string; answer: string };
};

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

export type SpeechToTextHandle = {
  start: () => void;
  stop: () => void | Promise<void>;
  isRecording: boolean;
  caption: string;
  isFinal: boolean;
  clearTranscription: () => void;
};

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
};
