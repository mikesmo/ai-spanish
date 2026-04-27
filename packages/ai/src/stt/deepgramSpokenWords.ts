import type { SpokenWord } from '@ai-spanish/logic';

type DeepgramWordRow = {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  confidence?: number;
};

/**
 * Maps a Deepgram live v1 `channel.alternatives[0].words` list into
 * `SpokenWord` entries. When start/end are missing, assigns sequential
 * synthetic timestamps so `alignWords` / `computeFluency` can run (same idea as
 * web, which only keeps words with real timings — native often needs fallbacks
 * for Nova streaming quirks).
 */
export function spokenWordsFromDeepgramRaw(raw: unknown): SpokenWord[] {
  if (!raw || typeof raw !== 'object') return [];
  const msg = raw as {
    channel?: { alternatives?: { words?: DeepgramWordRow[] }[] };
  };
  const rawWords = msg.channel?.alternatives?.[0]?.words;
  if (!Array.isArray(rawWords) || rawWords.length === 0) return [];

  let t = 0;
  const out: SpokenWord[] = [];
  for (const w of rawWords) {
    const word = (w.punctuated_word ?? w.word ?? '').trim();
    if (!word) continue;
    const hasStart = typeof w.start === 'number' && Number.isFinite(w.start);
    const hasEnd = typeof w.end === 'number' && Number.isFinite(w.end);
    let start: number;
    let end: number;
    if (hasStart && hasEnd) {
      start = w.start as number;
      end = w.end as number;
      t = Math.max(t, end);
    } else {
      start = t;
      end = t + 0.2;
      t = end;
    }
    out.push({
      word,
      start,
      end,
      confidence:
        typeof w.confidence === 'number' && Number.isFinite(w.confidence)
          ? w.confidence
          : undefined,
    });
  }
  return out;
}

/**
 * When Deepgram does not return `words` (or they fail to map), build token
 * objects from a transcript segment with synthetic timings so the learning
 * pipeline can still align.
 */
export function syntheticSpokenWordsFromTextSegment(
  line: string,
  timeStartSec = 0,
): SpokenWord[] {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  let t = timeStartSec;
  const out: SpokenWord[] = [];
  for (const p of parts) {
    const start = t;
    const end = t + 0.25;
    t = end;
    out.push({ word: p, start, end });
  }
  return out;
}
