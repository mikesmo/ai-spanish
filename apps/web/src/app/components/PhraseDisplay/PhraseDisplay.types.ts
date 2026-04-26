import type {
  AisSpeakingViewModel,
  Phrase,
  PhraseDisplayHostProps,
  UserFeedbackViewProps,
  UserRecordingViewProps,
} from "@ai-spanish/logic";

export type PhraseDisplayProps = PhraseDisplayHostProps & {
  /** Transcript lesson id; title and S3 path come from @ai-spanish/logic. */
  lessonId: string;
};
export type AISpeakingProps = AisSpeakingViewModel;
export type UserRecordingProps = UserRecordingViewProps;
export type UserFeedbackProps = UserFeedbackViewProps;
export type { Phrase };
