export * from './types';
export * from './weights';
export * from './comparison';
export * from './alignment';
export * from './accuracy';
export * from './fluency';
export * from './events';
export * from './mastery';
export * from './progressStore';
export * from './sessionEngine';
export {
  buildDevPhraseIndexCheckpoint,
  type BuildDevPhraseIndexCheckpointArgs,
} from './buildDevPhraseIndexCheckpoint';
export {
  SRS_LEARNING_SESSIONS_OFFSET,
  SRS_STABILIZING_SESSIONS_OFFSET,
  SRS_MASTERED_MIN_SESSIONS_OFFSET,
  SRS_MASTERED_MAX_SESSIONS_OFFSET,
  SRS_REVEAL_SESSIONS_OFFSET,
  computeSrsLessonOffset,
  scheduleDueOnLessonSessionIndex,
  isDueForReview,
} from './srs';
export type { CreateSessionEngineOptions } from './sessionEngine';
export * from './lessonBuilder';
export * from './schemas';
export {
  DEFAULT_AUDIO_CONTENT_PREFIX,
  normalizeAudioContentPrefix,
  normalizeLessonSegment,
  buildS3AudioKey,
} from './s3-keys';
export type { S3PathConfig } from './s3-keys';
export {
  DEEPGRAM_KEYWORD_LIVE_BOOST,
  DEEPGRAM_KEYWORD_MAX,
  deepgramLiveKeywordTokensForPhrase,
  toDeepgramLiveKeywordParams,
  tokenizeForDeepgramKeywords,
} from './deepgramKeywords';
export { transcriptsMatch } from './transcriptsMatch';
export {
  buildPhraseAudioClipSpecs,
  PHRASE_ANSWER_MEDIUM_CLIP_SUFFIX,
  PHRASE_ANSWER_SLOW_CLIP_SUFFIX,
  type PhraseAudioClipSpec,
} from './phraseAudioClipSpecs';
export {
  PHRASE_SYNTH_SEGMENTS,
  findDuplicatePhraseNames,
  isPhraseSynthSegment,
  languageForPhraseAudioSegment,
  mergePhraseSegmentText,
  phraseClipJobId,
  phraseSynthSegmentFromClipId,
  type PhraseSynthSegment,
} from './phraseAudioSegments';
export { usePhraseDisplay } from './usePhraseDisplay';
export type { UsePhraseDisplayOptions } from './usePhraseDisplay';
export { runPhraseFeedbackNext } from './phraseFeedbackNext';
export { useLessonSession } from './useLessonSession';
export type {
  PhraseEventContext,
  UseLessonSessionOptions,
  UseLessonSessionResult,
} from './useLessonSession';
export { createIncorrectPhraseTracker } from './incorrectPhraseTracker';
export type {
  IncorrectPhraseRecord,
  IncorrectPhraseTracker,
  ResolvedWordEntry,
} from './incorrectPhraseTracker';
export { useSessionHistory } from './useSessionHistory';
export type {
  HistoryEntry,
  ScoreSummary,
  StabilityBreakdownSnapshot,
  UseSessionHistoryResult,
} from './useSessionHistory';
export { useLessonSessionWithHistory } from './useLessonSessionWithHistory';
export type {
  UseLessonSessionWithHistoryResult,
  UseLessonSessionWithHistoryOptions,
} from './useLessonSessionWithHistory';
export {
  getDefaultLearningPipelineDebug,
  logSessionHistoryAppend,
  logSttAdapterStart,
  logSttAdapterStop,
  logSttClear,
  logSttDeepgramClose,
  logSttDeepgramFirstBlobDropped,
  logSttDeepgramFirstBlobSent,
  logSttDeepgramKeywordsSent,
  logSttDeepgramOpen,
  logSttMicSetupDone,
  logSttMicSetupStart,
  logSttMicStart,
  logSttMicStartSkipped,
  logSttMicStop,
  logSttSegment,
  logSttUtteranceEnd,
} from './learningPipelineDebug';
export {
  POST_SUCCESS_EXTRA_PAUSE_MS,
  FEEDBACK_AUTO_ADVANCE_MS,
  EXPLAIN_ACK_AUTO_ADVANCE_MS,
} from './phraseDisplayTiming';
export {
  TRANSCRIPT_QUERY_KEY,
  createTranscriptQueryOptions,
  lessonTranscriptQueryKey,
  lessonTranscriptQueryKeyPrefix,
  createLessonTranscriptQueryOptions,
} from './transcriptQuery';
export {
  LESSONS_QUERY_KEY_PREFIX,
  lessonsQueryKey,
  createLessonsQueryOptions,
} from './lessonCatalogQuery';
export {
  DEFAULT_TRANSCRIPT_LESSON_ID,
  DEFAULT_COURSE_LEVEL_SLUG,
  lessons,
  getLessonTitle,
  isValidTranscriptLessonId,
  isTranscriptLessonIdSyntaxValid,
  resolveTranscriptLessonQueryParam,
  transcriptPathWithLesson,
  lessonsApiPath,
  s3LessonFolderForTranscriptLessonId,
  type LessonListEntry,
} from './lessonCatalog';
export {
  getAisSpeakingViewModel,
  getFirstNLessonOrdersInDeck,
  getUserRecordingViewModel,
  LEARNER_QUESTION_PRESET_PROMPTS,
  type AisSpeakingViewModel,
  type LearnerQuestionPauseProps,
  type PhraseDisplayHostProps,
  type UserFeedbackViewProps,
  type UserRecordingViewModel,
  type UserRecordingViewProps,
  type UserRecordingExplainAckViewProps,
  type UserRecordingReplaySpanishMediumProps,
} from './phraseDisplayView';
export {
  useLearnerQuestionPause,
  type UseLearnerQuestionPauseOptions,
  type LearnerQuestionPauseHandle,
} from './useLearnerQuestionPause';
export {
  DEFAULT_QUESTION_MAX_RECORD_MS,
  useQuestionInput,
  type UseQuestionInputOptions,
  type UseQuestionInputResult,
} from './useQuestionInput';
export {
  buildLearnerQuestionSystemPrompt,
  type LearnerLastAttempt,
  type LearnerQuestionContext,
} from './learnerQuestionPrompt';
export {
  useLearnerQuestion,
  type LearnerQuestionTurn,
  type LearnerQuestionRequestBody,
  type UseLearnerQuestionOptions,
  type UseLearnerQuestionResult,
} from './useLearnerQuestion';
export { usePhraseDisplayWithDeck } from './usePhraseDisplayWithDeck';
