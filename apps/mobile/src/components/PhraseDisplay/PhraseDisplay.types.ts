import type {
  AisSpeakingViewModel,
  ItemScore,
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
  /**
   * Lifetime (cross-lesson) word/grammar mastery to seed this session's
   * tracker with. See `useLessonSession`'s `initialItemScores`.
   */
  initialItemScores?: {
    wordScores?: Record<string, ItemScore>;
    grammarItemScores?: Record<string, ItemScore>;
  };
};
export type AISpeakingProps = AisSpeakingViewModel;
export type UserRecordingProps = UserRecordingViewProps;
export type UserFeedbackProps = UserFeedbackViewProps;
export type { Phrase };
