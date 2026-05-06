import { describe, expect, it } from 'vitest';
import { buildPresentationOrdinalByEntryId } from '../sessionHistoryPresentationOrdinals';

const slice = (id: string, name: string) => ({
  id,
  phrase: { name },
});

describe('buildPresentationOrdinalByEntryId', () => {
  it('returns empty map for empty history', () => {
    expect(buildPresentationOrdinalByEntryId([]).size).toBe(0);
  });

  it('assigns ordinal 1 to contiguous events on the same phrase', () => {
    const history = [slice('1', 'A'), slice('2', 'A'), slice('3', 'A')];
    const m = buildPresentationOrdinalByEntryId(history);
    expect(m.get('1')).toBe(1);
    expect(m.get('2')).toBe(1);
    expect(m.get('3')).toBe(1);
  });

  it('bumps ordinal when the phrase returns after another phrase', () => {
    const history = [
      slice('a1', 'A'),
      slice('a2', 'A'),
      slice('b1', 'B'),
      slice('a3', 'A'),
    ];
    const m = buildPresentationOrdinalByEntryId(history);
    expect(m.get('a1')).toBe(1);
    expect(m.get('a2')).toBe(1);
    expect(m.get('b1')).toBe(1);
    expect(m.get('a3')).toBe(2);
  });

  it('tracks each phrase independently', () => {
    const history = [
      slice('a1', 'A'),
      slice('b1', 'B'),
      slice('b2', 'B'),
      slice('a2', 'A'),
      slice('b3', 'B'),
    ];
    const m = buildPresentationOrdinalByEntryId(history);
    expect(m.get('a1')).toBe(1);
    expect(m.get('b1')).toBe(1);
    expect(m.get('b2')).toBe(1);
    expect(m.get('a2')).toBe(2);
    expect(m.get('b3')).toBe(2);
  });
});
