export type PartOfSpeech =
  | 'verb'
  | 'noun'
  | 'adjective'
  | 'adverb'
  | 'pronoun'
  | 'preposition'
  | 'conjunction'
  | 'article'
  | 'determiner';

/**
 * Per-part-of-speech weights used by the weighted accuracy engine.
 * A missing verb hurts mastery far more than a missing article.
 */
export const POS_WEIGHTS: Record<PartOfSpeech, number> = {
  verb: 3.0,
  noun: 2.5,
  adjective: 2.0,
  adverb: 1.5,
  pronoun: 1.5,
  preposition: 1.0,
  conjunction: 1.0,
  article: 0.5,
  determiner: 0.5,
};

export const PART_OF_SPEECH_VALUES: readonly PartOfSpeech[] = Object.keys(
  POS_WEIGHTS,
) as PartOfSpeech[];

export function weightForPos(type: PartOfSpeech): number {
  return POS_WEIGHTS[type];
}
