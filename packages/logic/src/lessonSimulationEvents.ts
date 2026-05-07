import { alignWords } from './alignment';
import { computeAccuracy, isAccuracySuccess } from './accuracy';
import { computeFluency } from './fluency';
import { normalizeStr } from './comparison';
import type { Attempt, PhraseEvent, PracticeAttempt, RevealEvent } from './events';
import type { Phrase, SpokenWord } from './types';

/**
 * Minimal RNG interface. Pass `Math.random` for production callers; pass a
 * seeded function in tests for deterministic scenarios.
 */
export type SimRng = () => number;

/**
 * Relative weights for the outcome sampled per card in
 * `pickRandomPhraseEventsForCard`. Values are relative and normalized
 * internally — they need not sum to 1.
 */
export interface SimOutcomeWeights {
  /** User answers correctly on the first try. */
  success: number;
  /** User answers incorrectly (optionally followed by 0–2 practice attempts). */
  wrongAttempt: number;
  /** User taps Show Answer without speaking (penalized reveal). */
  reveal: number;
}

const DEFAULT_WEIGHTS: SimOutcomeWeights = {
  success: 0.60,
  wrongAttempt: 0.25,
  reveal: 0.15,
};

/**
 * Build a `SpokenWord[]` from a whitespace-separated answer string with
 * synthetic sequential timings: each word is 0.3 s long, 0.1 s apart.
 * Single-word phrases produce 1 element — `computeFluency` returns `null`
 * for those, exactly as real speech adapters would.
 */
export function buildSimSpokenWords(answer: string): SpokenWord[] {
  const words = answer.trim().split(/\s+/).filter(Boolean);
  return words.map((word, i) => ({
    word,
    start: i * 0.4,
    end: i * 0.4 + 0.3,
  }));
}

function buildSuccessAttempt(phrase: Phrase, now: number): Attempt {
  const answer = phrase.Spanish.answer;
  const target = phrase.Spanish.words;
  const spokenWords = buildSimSpokenWords(answer);
  const alignment = alignWords(target, spokenWords);
  const accuracy = computeAccuracy(target, alignment);
  const fluency = computeFluency(spokenWords);
  const transcript = answer.trim().split(/\s+/).filter(Boolean);

  return {
    eventType: 'attempt',
    phraseId: phrase.name,
    transcript,
    missingWords: [],
    extraWords: [],
    accuracyScore: accuracy.accuracy,
    fluencyScore: fluency?.fluencyScore ?? null,
    spokenWordCount: spokenWords.length,
    isAccuracySuccess: isAccuracySuccess(accuracy.accuracy),
    success: true,
    timestamp: now,
    accuracyBreakdown: accuracy,
    fluencyBreakdown: fluency,
  };
}

function buildWrongAttempt(phrase: Phrase, rng: SimRng, now: number): Attempt {
  const target = phrase.Spanish.words;
  const targetTexts = target.map((w) => w.word);

  let spokenTexts: string[];
  if (targetTexts.length <= 1) {
    spokenTexts = ['eh'];
  } else {
    const dropIdx = Math.floor(rng() * targetTexts.length);
    spokenTexts = targetTexts.filter((_, i) => i !== dropIdx);
    if (rng() < 0.3) spokenTexts.push('este');
  }

  const spokenWords: SpokenWord[] = spokenTexts.map((word, i) => ({
    word,
    start: i * 0.4,
    end: i * 0.4 + 0.3,
  }));

  const finalCaption = spokenTexts.join(' ');
  const alignment = alignWords(target, spokenWords);
  const accuracy = computeAccuracy(target, alignment);
  const fluency = computeFluency(spokenWords);

  return {
    eventType: 'attempt',
    phraseId: phrase.name,
    transcript: spokenTexts,
    missingWords: alignment.missing.map((w) => w.word),
    extraWords: alignment.extra.map((w) => w.word),
    accuracyScore: accuracy.accuracy,
    fluencyScore: fluency?.fluencyScore ?? null,
    spokenWordCount: spokenWords.length,
    isAccuracySuccess: isAccuracySuccess(accuracy.accuracy),
    success: normalizeStr(finalCaption) === normalizeStr(phrase.Spanish.answer),
    timestamp: now,
    accuracyBreakdown: accuracy,
    fluencyBreakdown: fluency,
  };
}

function buildPracticeAttempt(phrase: Phrase, rng: SimRng, now: number): PracticeAttempt {
  const target = phrase.Spanish.words;
  let spokenWords: SpokenWord[];

  if (rng() > 0.5) {
    spokenWords = buildSimSpokenWords(phrase.Spanish.answer);
  } else {
    const targetTexts = target.map((w) => w.word);
    if (targetTexts.length <= 1) {
      spokenWords = [{ word: targetTexts[0] ?? 'eh', start: 0, end: 0.3 }];
    } else {
      const dropIdx = Math.floor(rng() * targetTexts.length);
      const spoken = targetTexts.filter((_, i) => i !== dropIdx);
      spokenWords = spoken.map((word, i) => ({ word, start: i * 0.4, end: i * 0.4 + 0.3 }));
    }
  }

  const alignment = alignWords(target, spokenWords);
  const accuracy = computeAccuracy(target, alignment);
  const fluency = computeFluency(spokenWords);

  return {
    eventType: 'practice',
    phraseId: phrase.name,
    transcript: spokenWords.map((w) => w.word),
    fluencyScore: fluency?.fluencyScore ?? null,
    timestamp: now,
    accuracyBreakdown: accuracy,
    fluencyBreakdown: fluency,
  };
}

/**
 * Pick a random sequence of `PhraseEvent`s for one card in a simulated lesson
 * run. Outcomes are weighted: 60% success, 25% wrong attempt (+ 0–2 practice
 * attempts), 15% reveal. Weights can be overridden for testing.
 *
 * All events share the same `phraseId` and carry scores computed via the
 * real production functions (`alignWords`, `computeAccuracy`, `computeFluency`).
 */
export function pickRandomPhraseEventsForCard(
  phrase: Phrase,
  rng: SimRng,
  weights?: Partial<SimOutcomeWeights>,
): PhraseEvent[] {
  const w: SimOutcomeWeights = { ...DEFAULT_WEIGHTS, ...weights };
  const total = w.success + w.wrongAttempt + w.reveal;
  const roll = rng() * total;
  const now = Date.now();

  if (roll < w.success) {
    return [buildSuccessAttempt(phrase, now)];
  }

  if (roll < w.success + w.wrongAttempt) {
    const events: PhraseEvent[] = [buildWrongAttempt(phrase, rng, now)];
    const practiceCount = Math.floor(rng() * 3);
    for (let i = 0; i < practiceCount; i++) {
      events.push(buildPracticeAttempt(phrase, rng, now + i + 1));
    }
    return events;
  }

  const reveal: RevealEvent = {
    eventType: 'reveal',
    phraseId: phrase.name,
    penaltyApplied: true,
    timestamp: now,
  };
  return [reveal];
}
