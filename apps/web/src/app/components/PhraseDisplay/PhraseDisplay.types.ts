import type { Phrase } from "@ai-spanish/logic";

export interface PhraseDisplayProps {
  phrases: Phrase[];
}

export interface AISpeakingProps {
  isLoading: boolean;
  isAudioPlaying: boolean;
  /** English prompt in grey above the answer (pronunciation example phase). */
  englishQuestion?: string | null;
  /** Spanish line under the English question (e.g. pronunciation example phase). */
  spanishLine?: string | null;
}

export interface UserRecordingProps {
  englishText: string;
  /**
   * When set (e.g. new-phrase, first pass), show English `englishText` in grey
   * with this Spanish line below, instead of a single faded English line.
   */
  spanishLine?: string | null;
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
