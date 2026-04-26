import type { AlignmentResult } from './alignment';
import type { AccuracyBreakdown } from './accuracy';
import { ACCURACY_SUCCESS_THRESHOLD } from './accuracy';
import type { FluencyBreakdown } from './fluency';
import { fluencyForMastery } from './mastery';
import type { SpokenWord, WordMeta } from './types';

const PREFIX = '[ai-spanish/learn]';
const STT_PREFIX = '[ai-spanish/stt]';

/**
 * Whether to log the learning pipeline by default. On in development builds;
 * override with `UsePhraseDisplayOptions.debugLearningPipeline`.
 */
export function getDefaultLearningPipelineDebug(): boolean {
  if (
    typeof process !== 'undefined' &&
    process.env?.NODE_ENV === 'development'
  ) {
    return true;
  }
  try {
    const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
    if (dev === true) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function logLearningAttempt(ctx: {
  phraseId: string;
  spanishTarget: string;
  targetWords: WordMeta[];
  transcript: string;
  spokenWords: SpokenWord[];
  alignment: AlignmentResult;
  accuracy: AccuracyBreakdown;
  fluency: FluencyBreakdown | null;
  uiExactMatch: boolean;
  accuracySuccess: boolean;
  masteryPreview: number;
  /** Whether the STT stream reported is_final=true at the moment of capture. */
  isFinalAtCapture: boolean;
  /** ms between the first is_final=true and this emission firing; null if unknown. */
  msSinceFirstFinal: number | null;
  /** Where the emission fired from (which effect / callback). */
  trigger:
    | 'speech-final'
    | 'success-path-timer'
    | 'reveal'
    | 'practice'
    | 'manual'
    | 'show-answer';
}): void {
  const totalTargetWeight = ctx.targetWords.reduce((s, w) => s + w.weight, 0);
  console.groupCollapsed(
    `${PREFIX} Attempt · ${ctx.phraseId} · accuracy ${ctx.accuracy.accuracy.toFixed(3)} · ${ctx.trigger}`,
  );
  console.log('Spanish target:', ctx.spanishTarget);
  console.log('Final caption:', ctx.transcript || '(empty)');
  console.log('STT word count:', ctx.spokenWords.length, ctx.spokenWords);
  console.log('Target words:', ctx.targetWords.length, 'totalWeight:', totalTargetWeight);
  console.log(
    'Capture:',
    'isFinalAtCapture=' + ctx.isFinalAtCapture,
    'msSinceFirstFinal=' + (ctx.msSinceFirstFinal ?? '(unknown)'),
    'trigger=' + ctx.trigger,
  );

  console.log('--- Alignment (LCS on normalized tokens) ---');
  if (ctx.alignment.matched.length > 0) {
    console.table(
      ctx.alignment.matched.map((m, i) => ({
        '#': i + 1,
        target: m.target.word,
        pos: m.target.type,
        w: m.target.weight,
        spoken: m.spoken.word,
        start_s: Number(m.spoken.start.toFixed(3)),
        end_s: Number(m.spoken.end.toFixed(3)),
      })),
    );
  } else {
    console.log('Matched: (none)');
  }
  console.log(
    'Missing:',
    ctx.alignment.missing.length
      ? ctx.alignment.missing.map((m) => `${m.word} (${m.type}, weight ${m.weight})`)
      : '(none)',
  );
  console.log(
    'Extra:',
    ctx.alignment.extra.length
      ? ctx.alignment.extra.map(
          (e) =>
            `${e.word} [${e.start.toFixed(2)}–${e.end.toFixed(2)}s]`,
        )
      : '(none)',
  );

  console.log('--- Accuracy (weighted missing + flat capped extras) ---');
  console.log({
    totalWeight: ctx.accuracy.totalWeight,
    missingPenalty: ctx.accuracy.missingPenalty,
    rawExtraPenalty: ctx.accuracy.rawExtraPenalty,
    extraPenalty_afterCap: ctx.accuracy.extraPenalty,
    accuracyScore: ctx.accuracy.accuracy,
    ACCURACY_SUCCESS_THRESHOLD,
    isAccuracySuccess: ctx.accuracySuccess,
    formula: `clamp01(1 - (${ctx.accuracy.missingPenalty} + ${ctx.accuracy.extraPenalty}) / ${ctx.accuracy.totalWeight})`,
  });

  console.log('--- Fluency (timing; null if <2 words or bad timestamps) ---');
  if (ctx.fluency) {
    console.log({
      fluencyScore: ctx.fluency.fluencyScore,
      speedScore: ctx.fluency.speedScore,
      pauseScore: ctx.fluency.pauseScore,
      gapConsistencyScore: ctx.fluency.gapConsistencyScore,
      wordsPerSecond: Number(ctx.fluency.wordsPerSecond.toFixed(3)),
      longPauses_over_0_5s: ctx.fluency.longPauses,
    });
  } else {
    const imputed = fluencyForMastery(null, ctx.spokenWords.length);
    if (imputed != null) {
      console.log(
        'fluencyScore: null (not recorded) · single STT word → mastery imputes fluency=1 (with-fluency weights)',
      );
    } else {
      console.log(
        'fluencyScore: null → reducer uses mastery = 0.6×accuracy + 0.4×stability (no fluency term)',
      );
    }
  }

  console.log('--- Signals ---', {
    UI_exactStringMatch: ctx.uiExactMatch,
    learning_accuracyGate: ctx.accuracySuccess,
    lastScoreBreakdown_mastery_preview: ctx.masteryPreview,
  });
  console.groupEnd();
}

/** Practice: same diagnostics as attempt for debugging; does not affect SRS. */
export function logLearningPractice(ctx: {
  phraseId: string;
  spanishTarget: string;
  transcript: string;
  spokenWords: SpokenWord[];
  alignment: AlignmentResult;
  accuracy: AccuracyBreakdown;
  fluency: FluencyBreakdown | null;
}): void {
  console.groupCollapsed(
    `${PREFIX} Practice (SRS ignored) · ${ctx.phraseId} · acc ${ctx.accuracy.accuracy.toFixed(3)}`,
  );
  console.log('Spanish target:', ctx.spanishTarget);
  console.log('Caption:', ctx.transcript || '(empty)');
  console.log('STT words:', ctx.spokenWords.length, ctx.spokenWords);
  if (ctx.alignment.matched.length > 0) {
    console.table(
      ctx.alignment.matched.map((m, i) => ({
        '#': i + 1,
        target: m.target.word,
        spoken: m.spoken.word,
      })),
    );
  } else {
    console.log('Matched: (none)');
  }
  console.log('Missing:', ctx.alignment.missing.map((m) => m.word));
  console.log('Extra:', ctx.alignment.extra.map((e) => e.word));
  console.log('Accuracy:', {
    accuracy: ctx.accuracy.accuracy,
    missingPenalty: ctx.accuracy.missingPenalty,
    extraPenalty: ctx.accuracy.extraPenalty,
  });
  console.log(
    'Fluency:',
    ctx.fluency
      ? { fluencyScore: ctx.fluency.fluencyScore, wps: ctx.fluency.wordsPerSecond }
      : null,
  );
  console.groupEnd();
}

export function logRevealEmitted(phraseId: string): void {
  console.log(
    `${PREFIX} RevealEvent · ${phraseId}`,
    '(reducer: mastery ×0.6, stability ×0.7, state → learning)',
  );
}

export function logRevealSkipped(phraseId: string): void {
  console.log(
    `${PREFIX} Show Answer · ${phraseId}`,
    '— no RevealEvent (attempt or practice already recorded for this card)',
  );
}

export function logShowAnswerTryAgainNoProgress(phraseId: string): void {
  console.log(
    `${PREFIX} Show Answer · ${phraseId}`,
    '(Try Again, no gradable speech) — no PhraseEvent; mastery unchanged',
  );
}

export function logPhraseBoundary(ctx: {
  fromIndex: number | null;
  toIndex: number;
  phraseId: string;
  reason: 'init' | 'next';
}): void {
  const bar = '═'.repeat(60);
  const arrow = ctx.fromIndex === null ? `init → #${ctx.toIndex}` : `#${ctx.fromIndex} → #${ctx.toIndex}`;
  console.log(
    `\n${bar}\n${PREFIX} PHRASE ${arrow}  id=${ctx.phraseId}  reason=${ctx.reason}\n${bar}`,
  );
}

export function logAttemptFireSource(ctx: {
  phraseId: string;
  trigger: 'speech-final' | 'success-path-timer' | 'practice';
  captionAtFire: string;
  wordCountAtFire: number;
  isFinalAtFire: boolean;
  msSinceFirstFinal: number | null;
}): void {
  console.log(
    `${PREFIX} fire · ${ctx.trigger}`,
    'phrase=' + ctx.phraseId,
    'isFinal=' + ctx.isFinalAtFire,
    'words=' + ctx.wordCountAtFire,
    'captionLen=' + ctx.captionAtFire.length,
    'msSinceFirstFinal=' + (ctx.msSinceFirstFinal ?? '(unknown)'),
  );
}

export function logSttSegment(ctx: {
  isFinal: boolean;
  speechFinal?: boolean;
  segmentWords: number;
  totalFinalized: number;
  totalWords: number;
  transcript: string;
  captionLen: number;
}): void {
  console.log(
    `${STT_PREFIX} seg`,
    'isFinal=' + ctx.isFinal,
    'speechFinal=' + (ctx.speechFinal ?? false),
    'segWords=' + ctx.segmentWords,
    'totalFinalized=' + ctx.totalFinalized,
    'words=' + ctx.totalWords,
    'transcript=' + JSON.stringify(ctx.transcript),
    'captionLen=' + ctx.captionLen,
  );
}

export function logSttUtteranceEnd(ctx: {
  totalFinalized: number;
  caption: string;
  /** What actually closed the utterance:
   *   - `speech-final`: Deepgram's endpointer fired speech_final=true
   *   - `utterance-end-fallback`: Deepgram emitted a separate UtteranceEnd
   *     event (utterance_end_ms silence after the last finalized word)
   *   - `inactivity-watchdog`: neither of the above fired within our
   *     client-side deadline after the last word; we closed locally to
   *     avoid hanging the UI. Indicates a Deepgram VAD/endpointing anomaly. */
  trigger: 'speech-final' | 'utterance-end-fallback' | 'inactivity-watchdog';
}): void {
  console.log(
    `${STT_PREFIX} utterance-end (${ctx.trigger})`,
    'totalFinalized=' + ctx.totalFinalized,
    'caption=' + JSON.stringify(ctx.caption),
  );
}

export function logSttClear(ctx: {
  prevFinalized: number;
  prevCaptionLen: number;
}): void {
  console.log(
    `${STT_PREFIX} clearTranscription · prev:`,
    'finalized=' + ctx.prevFinalized,
    'captionLen=' + ctx.prevCaptionLen,
  );
}

export function logSttAdapterStart(ctx: {
  connState: string;
  micState: string;
  path: 'startMic-direct' | 'connect-direct' | 'setupMic-async';
  keywords?: string[];
}): void {
  const keywordsSuffix =
    ctx.keywords && ctx.keywords.length > 0
      ? ` keywords=[${ctx.keywords.join(',')}]`
      : ' keywords=[]';
  console.log(
    `${STT_PREFIX} adapter · start`,
    'conn=' + ctx.connState,
    'mic=' + ctx.micState,
    'path=' + ctx.path + keywordsSuffix,
  );
}

export function logSttAdapterStop(ctx: {
  connState: string;
  micState: string;
}): void {
  console.log(
    `${STT_PREFIX} adapter · stop (disconnect WS)`,
    'conn=' + ctx.connState,
    'mic=' + ctx.micState,
  );
}

export function logSttMicSetupStart(): void {
  console.log(`${STT_PREFIX} microphone · setup started (getUserMedia)`);
}

export function logSttMicSetupDone(ctx: { elapsedMs: number }): void {
  console.log(
    `${STT_PREFIX} microphone · setup complete`,
    'elapsedMs=' + ctx.elapsedMs,
  );
}

export function logSttMicStart(ctx: {
  recorderState: string | null;
  path: 'resume' | 'start-fresh';
}): void {
  console.log(
    `${STT_PREFIX} microphone · start`,
    'recorder=' + ctx.recorderState,
    'path=' + ctx.path,
  );
}

/** Mic could not start (e.g. no stream ref while WS already open). */
export function logSttMicStartSkipped(ctx: { reason: string }): void {
  console.log(`${STT_PREFIX} microphone · start skipped`, 'reason=' + ctx.reason);
}

export function logSttMicStop(ctx: { recorderState: string | null }): void {
  console.log(
    `${STT_PREFIX} microphone · stop`,
    'recorder=' + ctx.recorderState,
  );
}

export function logSttDeepgramOpen(): void {
  console.log(`${STT_PREFIX} Deepgram · WebSocket OPEN`);
}

export function logSttDeepgramClose(ctx: {
  sent: number;
  droppedClosed: number;
  droppedEmpty: number;
}): void {
  console.log(`${STT_PREFIX} Deepgram · WebSocket CLOSED`, {
    sent: ctx.sent,
    droppedClosed: ctx.droppedClosed,
    droppedEmpty: ctx.droppedEmpty,
  });
}

export function logSttDeepgramFirstBlobSent(ctx: {
  droppedBeforeFirstSent: number;
  firstDroppedAt: number | null;
  blobSize: number;
}): void {
  console.log(`${STT_PREFIX} Deepgram · first blob sent`, {
    droppedBeforeFirstSent: ctx.droppedBeforeFirstSent,
    firstDroppedAt: ctx.firstDroppedAt,
    blobSize: ctx.blobSize,
  });
}

export function logSttDeepgramFirstBlobDropped(ctx: {
  connState: string;
  hasConnRef: boolean;
  blobSize: number;
}): void {
  console.log(`${STT_PREFIX} Deepgram · first blob dropped (conn not OPEN)`, {
    connState: ctx.connState,
    hasConnRef: ctx.hasConnRef,
    blobSize: ctx.blobSize,
  });
}

export function logSessionHistoryAppend(ctx: {
  eventType: string;
  phraseId: string;
  transcriptPreview: string;
  /** Session-based SRS from `reduceProgress` — matches sidebar `next`. */
  dueOnLessonSessionIndex?: number;
  /** 0-based slot in remaining queue, or `null` — matches sidebar `session (log)`. */
  slotsSessionLog?: number | null;
  /** Same engine lookup reread; matches sidebar `session (now)` at append time. */
  slotsSessionNow?: number | null;
}): void {
  const parts: string[] = [
    'event=' + ctx.eventType,
    'phrase=' + ctx.phraseId,
    'transcriptPreview=' + JSON.stringify(ctx.transcriptPreview.slice(0, 200)),
  ];
  if (ctx.dueOnLessonSessionIndex !== undefined) {
    parts.push('dueOnLesson=' + String(ctx.dueOnLessonSessionIndex));
  }
  if (ctx.slotsSessionLog !== undefined) {
    parts.push('session(log)=' + String(ctx.slotsSessionLog));
  }
  if (ctx.slotsSessionNow !== undefined) {
    parts.push('session(now)=' + String(ctx.slotsSessionNow));
  }
  console.log(`${PREFIX} session history · append`, ...parts);
}

/**
 * Fires when a phrase event is for a different id than the engine’s current
 * card — in-session requeue is skipped, so `getQueuePosition` stays null. Often
 * caused by calling `pickNext` twice in a React Strict Mode `useState` init.
 */
export function logSessionEnginePhraseMismatch(ctx: {
  eventPhraseId: string;
  currentPresentedPhraseId: string;
}): void {
  console.warn(`${PREFIX} session engine · phrase id mismatch (requeue skipped)`, {
    eventPhraseId: ctx.eventPhraseId,
    currentPresentedPhraseId: ctx.currentPresentedPhraseId,
  });
}
