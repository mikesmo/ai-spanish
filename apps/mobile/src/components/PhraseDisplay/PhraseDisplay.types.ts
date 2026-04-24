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
   * When set, show `englishText` in grey and this line below (new-phrase, first pass).
   */
  spanishLine?: string | null;
  /**
   * When `spanishLine` is set, whether to show the English line; false on revisits.
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
