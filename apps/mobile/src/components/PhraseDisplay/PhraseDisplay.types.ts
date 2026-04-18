import type { Phrase } from "@ai-spanish/logic";

export interface PhraseDisplayProps {
  phrases: Phrase[];
}

export interface AISpeakingProps {
  isLoading: boolean;
  isAudioPlaying: boolean;
}

export interface UserRecordingProps {
  englishText: string;
  transcription: string;
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
