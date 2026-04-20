import type { AlignmentResult } from './alignment';
import type { AccuracyBreakdown } from './accuracy';
import { ACCURACY_SUCCESS_THRESHOLD } from './accuracy';
import type { FluencyBreakdown } from './fluency';
import type { SpokenWord } from './types';

const PREFIX = '[ai-spanish/learn]';

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
  transcript: string;
  spokenWords: SpokenWord[];
  alignment: AlignmentResult;
  accuracy: AccuracyBreakdown;
  fluency: FluencyBreakdown | null;
  uiExactMatch: boolean;
  accuracySuccess: boolean;
  masteryPreview: number;
}): void {
  console.groupCollapsed(
    `${PREFIX} Attempt · ${ctx.phraseId} · accuracy ${ctx.accuracy.accuracy.toFixed(3)}`,
  );
  console.log('Spanish target:', ctx.spanishTarget);
  console.log('Final caption:', ctx.transcript || '(empty)');
  console.log('STT word count:', ctx.spokenWords.length, ctx.spokenWords);

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
