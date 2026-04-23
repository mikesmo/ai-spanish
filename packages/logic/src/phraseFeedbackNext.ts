import type { PhraseDisplayAPI } from './types';
import type { UseLessonSessionResult } from './useLessonSession';

/**
 * Next-phrase from the post-answer screen: clear STT, optionally show loading
 * when another card exists, then advance the session queue. Use from both
 * app shells so the feedback UI never paints empty-caption + new-phrase
 * for one frame.
 */
export const runPhraseFeedbackNext = (
  display: PhraseDisplayAPI,
  session: Pick<UseLessonSessionResult, 'remaining' | 'advance'>,
): void => {
  display.handleNext({ exitToLoading: session.remaining > 0 });
  session.advance();
};
