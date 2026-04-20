import { describe, expect, it } from 'vitest';
import { alignWords } from '../alignment';
import { POS_WEIGHTS } from '../weights';
import type { SpokenWord, WordMeta } from '../types';

const wm = (word: string, type: keyof typeof POS_WEIGHTS): WordMeta => ({
  word,
  type,
  weight: POS_WEIGHTS[type],
});

const sw = (word: string, start: number, end: number): SpokenWord => ({
  word,
  start,
  end,
});

describe('alignWords', () => {
  it('matches every word when spoken equals target', () => {
    const target: WordMeta[] = [
      wm('tengo', 'verb'),
      wm('que', 'conjunction'),
      wm('ir', 'verb'),
    ];
    const spoken: SpokenWord[] = [
      sw('tengo', 0, 0.3),
      sw('que', 0.4, 0.5),
      sw('ir', 0.6, 0.8),
    ];

    const result = alignWords(target, spoken);
    expect(result.matched).toHaveLength(3);
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
  });

  it('flags a missing middle word', () => {
    const target: WordMeta[] = [
      wm('tengo', 'verb'),
      wm('que', 'conjunction'),
      wm('ir', 'verb'),
    ];
    const spoken: SpokenWord[] = [sw('tengo', 0, 0.3), sw('ir', 0.6, 0.8)];

    const result = alignWords(target, spoken);
    expect(result.matched.map((m) => m.target.word)).toEqual(['tengo', 'ir']);
    expect(result.missing.map((m) => m.word)).toEqual(['que']);
    expect(result.extra).toEqual([]);
  });

  it('flags an inserted extra word', () => {
    const target: WordMeta[] = [wm('tengo', 'verb'), wm('banco', 'noun')];
    const spoken: SpokenWord[] = [
      sw('tengo', 0, 0.3),
      sw('umm', 0.4, 0.6),
      sw('banco', 0.7, 1.0),
    ];

    const result = alignWords(target, spoken);
    expect(result.matched).toHaveLength(2);
    expect(result.missing).toEqual([]);
    expect(result.extra.map((e) => e.word)).toEqual(['umm']);
  });

  it('handles a duplicated spoken word as extra', () => {
    const target: WordMeta[] = [wm('banco', 'noun')];
    const spoken: SpokenWord[] = [sw('banco', 0, 0.3), sw('banco', 0.4, 0.7)];

    const result = alignWords(target, spoken);
    expect(result.matched).toHaveLength(1);
    expect(result.missing).toEqual([]);
    expect(result.extra.map((e) => e.word)).toEqual(['banco']);
  });

  it('is case- and accent-insensitive', () => {
    const target: WordMeta[] = [wm('Dónde', 'adverb'), wm('está', 'verb')];
    const spoken: SpokenWord[] = [
      sw('DONDE', 0, 0.3),
      sw('esta', 0.4, 0.7),
    ];

    const result = alignWords(target, spoken);
    expect(result.matched).toHaveLength(2);
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
  });

  it('handles empty spoken input as all-missing', () => {
    const target: WordMeta[] = [wm('tengo', 'verb'), wm('banco', 'noun')];
    const result = alignWords(target, []);
    expect(result.matched).toEqual([]);
    expect(result.missing.map((m) => m.word)).toEqual(['tengo', 'banco']);
    expect(result.extra).toEqual([]);
  });

  it('handles empty target as all-extra', () => {
    const spoken: SpokenWord[] = [sw('uno', 0, 0.1), sw('dos', 0.2, 0.3)];
    const result = alignWords([], spoken);
    expect(result.matched).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.extra.map((e) => e.word)).toEqual(['uno', 'dos']);
  });

  it('preserves the spoken timestamp on matched pairs', () => {
    const target: WordMeta[] = [wm('tengo', 'verb')];
    const spoken: SpokenWord[] = [sw('Tengo', 1.23, 1.55)];

    const result = alignWords(target, spoken);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]!.spoken.start).toBeCloseTo(1.23);
    expect(result.matched[0]!.spoken.end).toBeCloseTo(1.55);
  });
});
