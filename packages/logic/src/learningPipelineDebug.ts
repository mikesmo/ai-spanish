import type { AlignmentResult } from './alignment';
import type { AccuracyBreakdown } from './accuracy';
import { ACCURACY_SUCCESS_THRESHOLD } from './accuracy';
import type { FluencyBreakdown } from './fluency';
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
  trigger: 'wrong-path-timer' | 'success-path-timer' | 'reveal' | 'practice' | 'manual';
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
    console.log(
      'fluencyScore: null → reducer uses mastery = 0.6×accuracy + 0.4×stability (no fluency term)',
    );
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

export function logWrongPathScheduled(ctx: {
  phraseId: string;
  isFinal: boolean;
  captionNow: string;
  wordCountNow: number;
  pauseMs: number;
}): void {
  console.log(
    `${PREFIX} wrong-path · scheduled (${ctx.pauseMs}ms)`,
    'phrase=' + ctx.phraseId,
    'isFinal=' + ctx.isFinal,
    'words=' + ctx.wordCountNow,
    'captionLen=' + ctx.captionNow.length,
  );
}

export function logWrongPathRescheduled(ctx: {
  phraseId: string;
  isFinal: boolean;
  captionNow: string;
  wordCountNow: number;
}): void {
  console.log(
    `${PREFIX} wrong-path · rescheduled (cleanup → re-schedule)`,
    'phrase=' + ctx.phraseId,
    'isFinal=' + ctx.isFinal,
    'words=' + ctx.wordCountNow,
    'captionLen=' + ctx.captionNow.length,
  );
}

export function logAttemptFireSource(ctx: {
  phraseId: string;
  trigger: 'wrong-path-timer' | 'success-path-timer' | 'practice';
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
  segmentWords: number;
  totalFinalized: number;
  totalWords: number;
  transcript: string;
  captionLen: number;
}): void {
  console.log(
    `${STT_PREFIX} seg`,
    'isFinal=' + ctx.isFinal,
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
  /** Number of interim words pending at the moment utterance-end fires. */
  pendingInterimWords: number;
  /** Number of interim words that were salvaged (committed to finalized) by
   * the utterance-end handler. Useful for diagnosing caption↔words drift. */
  salvagedInterimWords: number;
}): void {
  console.log(
    `${STT_PREFIX} utterance-end (empty-final)`,
    'totalFinalized=' + ctx.totalFinalized,
    'pendingInterim=' + ctx.pendingInterimWords,
    'salvaged=' + ctx.salvagedInterimWords,
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
