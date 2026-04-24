import type { Phrase } from "@ai-spanish/logic";

export interface PhraseDisplayProps {
  phrases: Phrase[];
}

export interface AISpeakingProps {
  isLoading: boolean;
  isAudioPlaying: boolean;
  /** Spanish line during pronunciation example phase. */
  spanishLine?: string | null;
}

export interface UserRecordingProps {
  englishText: string;
  /**
   * When set (e.g. new-phrase, first pass), show English `englishText` in grey
   * with this Spanish line below, instead of a single faded English line.
   */
  spanishLine?: string | null;
  /**
   * When `spanishLine` is set, whether to show the English line above it.
   * false for session revisits; default true.
   */
  showEnglishInHint?: boolean;
  transcription: string;
  isRecording: boolean;
  isCorrect: boolean;
  onShowAnswer: () => void;
}

export interface UserFeedbackProps {
  transcription: string;
  spanishPhrase: string;
  isCorrect: boolean;
  isAudioPlaying: boolean;
  speed: "1x" | "slow";
  onSpeedChange: (speed: "1x" | "slow") => void;
  onReplay: () => void;
  onTryAgain: () => void;
  onNext: () => void;
}
