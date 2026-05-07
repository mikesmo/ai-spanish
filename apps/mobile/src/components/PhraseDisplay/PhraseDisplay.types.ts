import type {
  AisSpeakingViewModel,
  Phrase,
  PhraseDisplayHostProps,
  SessionCheckpointParsed,
  UserFeedbackViewProps,
  UserRecordingViewProps,
} from "@ai-spanish/logic";

export type PhraseDisplayProps = PhraseDisplayHostProps & {
  /** Transcript lesson id; title and S3 path come from @ai-spanish/logic. */
  lessonId: string;
  onExit: () => void;
  /**
   * When provided the session engine is hydrated from this snapshot instead
   * of starting fresh. Validated by the caller (fingerprint check).
   */
  initialSessionCheckpoint?: SessionCheckpointParsed;
};
export type AISpeakingProps = AisSpeakingViewModel;
export type UserRecordingProps = UserRecordingViewProps;
export type UserFeedbackProps = UserFeedbackViewProps;
export type { Phrase };
