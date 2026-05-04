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
  /**
   * When set, hydrates the lesson session from this checkpoint instead of a
   * fresh queue (e.g. dev `?phraseIndex=` on web). Omit in production paths.
   */
  initialSessionCheckpoint?: SessionCheckpointParsed | null;
};
export type AISpeakingProps = AisSpeakingViewModel;
export type UserRecordingProps = UserRecordingViewProps;
export type UserFeedbackProps = UserFeedbackViewProps;
export type { Phrase };
