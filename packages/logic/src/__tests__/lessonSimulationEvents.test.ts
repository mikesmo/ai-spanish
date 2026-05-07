import { describe, expect, it } from 'vitest';
import { POS_WEIGHTS } from '../weights';
import type { Phrase, WordMeta } from '../types';
import {
  buildSimSpokenWords,
  pickRandomPhraseEventsForCard,
} from '../lessonSimulationEvents';
import { isAccuracySuccess } from '../accuracy';
import { normalizeStr } from '../comparison';

// ---- helpers ----

const wm = (word: string, type: keyof typeof POS_WEIGHTS): WordMeta => ({
  word,
  type,
  weight: POS_WEIGHTS[type],
});

function makePhrase(answer: string, words: WordMeta[]): Phrase {
  return {
    name: 'test-phrase',
    index: 0,
    type: 'new',
    English: {
      'first-intro': 'Say in Spanish:',
      'second-intro': '',
      question: 'I have to go',
      'follow-up': '',
      explain: '',
    },
    Spanish: {
      grammar: '',
      answer,
      words,
    },
  };
}

const SIMPLE_PHRASE = makePhrase('tengo que ir', [
  wm('tengo', 'verb'),
  wm('que', 'conjunction'),
  wm('ir', 'verb'),
]);

const SINGLE_WORD_PHRASE = makePhrase('gracias', [wm('gracias', 'noun')]);

// Deterministic RNG that returns values from a fixed sequence
function seededRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

// ---- buildSimSpokenWords ----

describe('buildSimSpokenWords', () => {
  it('produces one entry per whitespace-separated word', () => {
    const words = buildSimSpokenWords('tengo que ir');
    expect(words).toHaveLength(3);
    expect(words.map((w) => w.word)).toEqual(['tengo', 'que', 'ir']);
  });

  it('gives each word sequential non-overlapping timings', () => {
    const words = buildSimSpokenWords('a b c');
    for (let i = 0; i < words.length - 1; i++) {
      expect(words[i]!.end).toBeLessThan(words[i + 1]!.start);
    }
  });

  it('returns a single entry for a one-word answer', () => {
    expect(buildSimSpokenWords('gracias')).toHaveLength(1);
  });
});

// ---- pickRandomPhraseEventsForCard ----

describe('pickRandomPhraseEventsForCard — success path', () => {
  // Force the success branch: roll < 0.6 (first call), remaining calls used inside success builder
  const rng = seededRng([0.1]);

  it('returns exactly one attempt event', () => {
    const events = pickRandomPhraseEventsForCard(SIMPLE_PHRASE, rng);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('attempt');
  });

  it('success attempt has success=true and isAccuracySuccess=true', () => {
    const rng2 = seededRng([0.1]);
    const [ev] = pickRandomPhraseEventsForCard(SIMPLE_PHRASE, rng2);
    if (!ev || ev.eventType !== 'attempt') throw new Error('expected attempt');
    expect(ev.success).toBe(true);
    expect(ev.isAccuracySuccess).toBe(true);
    expect(isAccuracySuccess(ev.accuracyScore)).toBe(true);
  });

  it('transcript matches the Spanish answer words', () => {
    const rng2 = seededRng([0.1]);
    const [ev] = pickRandomPhraseEventsForCard(SIMPLE_PHRASE, rng2);
    if (!ev || ev.eventType !== 'attempt') throw new Error('expected attempt');
    expect(ev.transcript.join(' ')).toBe(
      normalizeStr(SIMPLE_PHRASE.Spanish.answer),
    );
  });
});

describe('pickRandomPhraseEventsForCard — wrong attempt path', () => {
  // Force wrong branch: roll = 0.65 (> 0.60, < 0.85), then extra rng calls
  // [0.65, dropIdx=0 (roll*3=0), practiceCount=0 (roll*3=0)]
  const rng = seededRng([0.65, 0.0, 0.0]);

  it('first event is an attempt with success=false', () => {
    const events = pickRandomPhraseEventsForCard(SIMPLE_PHRASE, rng);
    const first = events[0];
    if (!first || first.eventType !== 'attempt') throw new Error('expected attempt');
    expect(first.success).toBe(false);
    expect(first.missingWords.length).toBeGreaterThan(0);
  });
});

describe('pickRandomPhraseEventsForCard — wrong attempt with practice attempts', () => {
  // Trace: roll=0.65 (wrong branch), dropIdx=floor(0.0*3)=0, extra=0.99(>=0.3 skip),
  // practiceCount=floor(0.7*3)=2, then practice attempt rng calls.
  const rng = seededRng([0.65, 0.0, 0.99, 0.7, 0.5, 0.5, 0.5, 0.5]);

  it('returns 3 events (1 attempt + 2 practice)', () => {
    const events = pickRandomPhraseEventsForCard(SIMPLE_PHRASE, rng);
    expect(events).toHaveLength(3);
    expect(events[0]?.eventType).toBe('attempt');
    expect(events[1]?.eventType).toBe('practice');
    expect(events[2]?.eventType).toBe('practice');
  });
});

describe('pickRandomPhraseEventsForCard — reveal path', () => {
  // Force reveal: roll = 0.9 (> 0.85)
  const rng = seededRng([0.9]);

  it('returns exactly one reveal event', () => {
    const events = pickRandomPhraseEventsForCard(SIMPLE_PHRASE, rng);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('reveal');
  });

  it('reveal has penaltyApplied=true and correct phraseId', () => {
    const rng2 = seededRng([0.9]);
    const [ev] = pickRandomPhraseEventsForCard(SIMPLE_PHRASE, rng2);
    if (!ev || ev.eventType !== 'reveal') throw new Error('expected reveal');
    expect(ev.penaltyApplied).toBe(true);
    expect(ev.phraseId).toBe(SIMPLE_PHRASE.name);
  });
});

describe('pickRandomPhraseEventsForCard — single-word phrase', () => {
  it('success path produces a valid attempt', () => {
    const rng = seededRng([0.1]);
    const [ev] = pickRandomPhraseEventsForCard(SINGLE_WORD_PHRASE, rng);
    if (!ev || ev.eventType !== 'attempt') throw new Error('expected attempt');
    expect(ev.success).toBe(true);
    // Single word → fluency is null (< 2 words for computeFluency)
    expect(ev.fluencyScore).toBeNull();
  });

  it('wrong path still produces an attempt', () => {
    const rng = seededRng([0.65, 0.0, 0.0]);
    const [ev] = pickRandomPhraseEventsForCard(SINGLE_WORD_PHRASE, rng);
    if (!ev || ev.eventType !== 'attempt') throw new Error('expected attempt');
    expect(ev.success).toBe(false);
  });
});

describe('pickRandomPhraseEventsForCard — custom weights', () => {
  it('always produces a reveal when only reveal weight is non-zero', () => {
    const rng = seededRng([0.99]);
    const events = pickRandomPhraseEventsForCard(SIMPLE_PHRASE, rng, {
      success: 0,
      wrongAttempt: 0,
      reveal: 1,
    });
    expect(events[0]?.eventType).toBe('reveal');
  });

  it('always produces a success attempt when only success weight is non-zero', () => {
    const rng = seededRng([0.01]);
    const events = pickRandomPhraseEventsForCard(SIMPLE_PHRASE, rng, {
      success: 1,
      wrongAttempt: 0,
      reveal: 0,
    });
    const ev = events[0];
    if (!ev || ev.eventType !== 'attempt') throw new Error('expected attempt');
    expect(ev.success).toBe(true);
  });
});
