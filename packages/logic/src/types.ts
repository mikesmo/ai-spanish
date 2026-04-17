export type Language = 'en' | 'es';

export type Phrase = {
  English: { intro: string; question: string };
  Spanish: { grammar: string; question: string };
};

export type UIStatus = 'loading' | 'idle' | 'recording' | 'answer' | 'tryAgain';

export type TTSAdapter = {
  play: (text: string, lang: Language, rate?: number) => Promise<void>;
  prefetch: (text: string, lang: Language) => Promise<void>;
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
