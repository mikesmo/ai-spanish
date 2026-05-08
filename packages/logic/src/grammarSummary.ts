/**
 * Helpers for generating AI-written per-grammar-item summaries at lesson
 * completion. `selectGrammarItemsForSummary` picks the worst eligible items;
 * `buildGrammarSummaryPrompts` builds the prompt strings the server passes to
 * the AI model.
 *
 * Lives in packages/logic so both the web server route and tests can import it
 * without pulling in any Next.js or AI SDK dependencies.
 */

import { classifyItemMastery } from './itemMastery';
import { filterHistoryEntriesForGrammarItemTrail, isReportEligibleItem } from './lessonReport';
import type { GrammarMasteryRow } from './lessonReport';
import type { HistoryEntry } from './useSessionHistory';

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

const MAX_GRAMMAR_SUMMARY_ITEMS = 3;

/**
 * Returns up to three grammar items eligible for an AI-generated focus summary:
 * - Must meet the report evidence threshold (`isReportEligibleItem`, trialsEff ≥ 3).
 * - Must be in the `weak` or `stabilizing` mastery band.
 * - Sorted ascending by mastery (lowest first).
 */
export const selectGrammarItemsForSummary = (
  rows: readonly GrammarMasteryRow[],
): GrammarMasteryRow[] =>
  rows
    .filter(isReportEligibleItem)
    .filter((r) => {
      const band = classifyItemMastery(r.mastery);
      return band === 'weak' || band === 'stabilizing';
    })
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, MAX_GRAMMAR_SUMMARY_ITEMS);

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

export interface GrammarSummaryPrompts {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * A compact description of one attempt record for inclusion in the summary
 * prompt. Avoids shipping the entire HistoryEntry so the prompt stays
 * focused on what the AI actually needs.
 */
interface AttemptRecord {
  eventType: 'attempt' | 'reveal';
  english: string;
  expectedSpanish: string;
  transcript: string;
  missingWords: string[];
  extraWords: string[];
  accuracyScore: number | null;
  isAccuracySuccess: boolean | null;
  /** AI-generated rationale for why this item was violated, if available. */
  aiRationaleForThisItem?: string;
}

/**
 * Builds the system and user prompts for the grammar-item focus summary.
 * The model is expected to return a structured JSON object with `struggling`
 * and `focus` string fields.
 *
 * @param item      The exact grammar item string (comma-split token).
 * @param row       The mastery row for this item (mastery, trialsEff, band).
 * @param entries   Full session history (all HistoryEntry objects).
 */
export function buildGrammarSummaryPrompts(
  item: string,
  row: Pick<GrammarMasteryRow, 'mastery' | 'trialsEff'>,
  entries: readonly HistoryEntry[],
): GrammarSummaryPrompts {
  const trail = filterHistoryEntriesForGrammarItemTrail(item, entries);

  const attempts: AttemptRecord[] = trail.map((entry) => {
    const evt = entry.event;
    if (evt.eventType === 'reveal') {
      return {
        eventType: 'reveal',
        english: entry.phrase.English.question,
        expectedSpanish: entry.phrase.Spanish.answer,
        transcript: '',
        missingWords: entry.phrase.Spanish.words.map((w) => w.word),
        extraWords: [],
        accuracyScore: null,
        isAccuracySuccess: null,
      };
    }
    // attempt or practice — attempt is the only type that reaches here
    // (filterHistoryEntriesForGrammarItemTrail already filters to attempt|reveal)
    const aiRationale = entry.aiClassification?.failedGrammarItems.find(
      (fi) => fi.item === item,
    )?.rationale;

    return {
      eventType: 'attempt',
      english: entry.phrase.English.question,
      expectedSpanish: entry.phrase.Spanish.answer,
      transcript: evt.transcript.join(' '),
      missingWords: evt.missingWords,
      extraWords: evt.extraWords,
      accuracyScore: entry.scoreSummary?.accuracy ?? null,
      isAccuracySuccess: entry.scoreSummary?.isAccuracySuccess ?? null,
      ...(aiRationale ? { aiRationaleForThisItem: aiRationale } : {}),
    };
  });

  const masteryPct = Math.round(row.mastery * 100);
  const trialsRounded = row.trialsEff.toFixed(1);

  const systemLines: string[] = [
    "You are a supportive Spanish tutor reflecting on one learner's lesson. Your written feedback will appear verbatim on their lesson report.",
    '',
    'Tone:',
    '  - Warm, positive, and growth-oriented - learning takes time.',
    '  - Acknowledge effort and progress where reasonable; avoid harsh or judgmental wording.',
    '  - Vary your sentence openings across items; do not repeatedly start with phrases like "I notice that at times you..." or "Keep practicing...".',
    '  - When it would make the explanation clearer, include a brief example or contrast (for example, a corrected Spanish phrase or a before/after pattern). Skip examples when they would feel forced or unsupported by the snippets.',
    '',
    'Anti-leaks (critical):',
    '  - Never mention "events", event numbers, logs, session IDs, timestamps, or any internal numbering from the data blocks below.',
    '  - Never quote labels like "Snippet 1" — those markers exist only for you to read the data.',
    '  - Write as if speaking directly to the learner in second person ("you").',
    '',
    'You will receive:',
    '  - The grammar concept',
    "  - Their mastery estimate for this concept (context for you only — do not quote raw percentages unless it feels natural and helpful)",
    '  - Chronological lesson snippets (spoken attempts vs viewing the answer first)',
    '',
    'Return a JSON object with exactly:',
    '  - "struggling": 1–2 sentences on what tends to trip them up for this concept, grounded only in the snippets. Natural language only.',
    '  - "focus": 1–2 sentences of concrete, encouraging next steps.',
    '',
    'Do not invent mistakes absent from the snippets. Return ONLY valid JSON — two string fields, no markdown fences.',
  ];

  const snippetLabel = (idx: number, kind: 'spoken' | 'answer_first'): string =>
    kind === 'spoken'
      ? `--- Snippet ${idx + 1}: learner spoke ---`
      : `--- Snippet ${idx + 1}: learner viewed the answer before speaking ---`;

  const userLines: string[] = [
    `Grammar concept: "${item}"`,
    `Estimated mastery for this concept (internal): ${masteryPct}% (effective exposure weight: ${trialsRounded})`,
    '',
    `Lesson snippets for this concept (${attempts.length} snippet${attempts.length === 1 ? '' : 's'}):`,
  ];

  attempts.forEach((a, idx) => {
    userLines.push('');
    userLines.push(
      snippetLabel(idx, a.eventType === 'attempt' ? 'spoken' : 'answer_first'),
    );
    userLines.push(`English prompt: "${a.english}"`);
    userLines.push(`Target Spanish: "${a.expectedSpanish}"`);
    if (a.eventType === 'attempt') {
      userLines.push(`What they said: "${a.transcript || '(nothing captured)'}"`);
      userLines.push(`Missing target words: ${a.missingWords.length > 0 ? a.missingWords.join(', ') : 'none'}`);
      userLines.push(`Extra words: ${a.extraWords.length > 0 ? a.extraWords.join(', ') : 'none'}`);
      if (a.accuracyScore !== null) {
        userLines.push(
          `Weighted accuracy: ${Math.round(a.accuracyScore * 100)}% (${a.isAccuracySuccess ? 'met lesson threshold' : 'below lesson threshold'})`,
        );
      }
      if (a.aiRationaleForThisItem) {
        userLines.push(`Classifier note (internal — paraphrase kindly if useful): ${a.aiRationaleForThisItem}`);
      }
    } else {
      userLines.push(
        '(They chose to see the full answer before producing their own response.)',
      );
    }
  });

  userLines.push('');
  userLines.push('Return your analysis as JSON now.');

  return {
    systemPrompt: systemLines.join('\n'),
    userPrompt: userLines.join('\n'),
  };
}
