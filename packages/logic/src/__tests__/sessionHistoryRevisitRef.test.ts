import { describe, expect, it } from 'vitest';
import {
  buildRevisitRefDisplayByEntryId,
  type RevisitRefHistorySlice,
} from '../sessionHistoryRevisitRef';

const row = (
  id: string,
  phraseName: string,
  isRepeatedPresentation: boolean,
  eventSeq?: number,
): RevisitRefHistorySlice => ({
  id,
  phrase: { name: phraseName },
  isRepeatedPresentation,
  ...(eventSeq != null ? { eventSeq } : {}),
});

describe('buildRevisitRefDisplayByEntryId', () => {
  it('returns an empty map for empty history', () => {
    expect(buildRevisitRefDisplayByEntryId([]).size).toBe(0);
  });

  it('references the last row of the prior stint (first revisit)', () => {
    const history = [
      row('s1', 'A', false),
      row('s2', 'A', false),
      row('b', 'B', false),
      row('r1', 'A', true),
    ];
    const m = buildRevisitRefDisplayByEntryId(history);
    expect(m.get('r1')).toBe(2);
  });

  it('references the last row of the second stint when there were two revisits', () => {
    const history = [
      row('s1', 'A', false),
      row('s2', 'A', false),
      row('b1', 'B', false),
      row('r1', 'A', true),
      row('r2', 'A', true),
      row('b2', 'B', false),
      row('r3', 'A', true),
    ];
    const m = buildRevisitRefDisplayByEntryId(history);
    expect(m.get('r1')).toBe(2);
    expect(m.get('r2')).toBe(2);
    expect(m.get('r3')).toBe(5);
  });

  it('uses eventSeq when present on the referenced row', () => {
    const history = [
      row('s1', 'A', false),
      row('s2', 'A', false, 42),
      row('b', 'B', false),
      row('r1', 'A', true),
    ];
    expect(buildRevisitRefDisplayByEntryId(history).get('r1')).toBe(42);
  });
});
