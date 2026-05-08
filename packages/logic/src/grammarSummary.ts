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

/**
 * Returns up to 5 grammar items eligible for an AI-generated focus summary:
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
    .slice(0, 5);

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
    "You are an expert Spanish language tutor analyzing a beginner learner's practice session.",
    'Your job is to identify what the learner is struggling with for a specific grammar concept and give them a short, concrete, encouraging tip.',
    '',
    'You will receive:',
    '  - The grammar concept being analyzed',
    "  - The learner's mastery score for this concept (0–100%)",
    '  - A list of phrases the learner practiced that involve this concept, with their attempt details',
    '',
    'You must return a JSON object with exactly these two fields:',
    '  - "struggling": 1–2 sentences describing what the learner is finding difficult about this concept, based on their specific errors. Be concrete — reference the types of mistakes seen.',
    '  - "focus": 1–2 sentences of actionable advice on what to concentrate on to improve. Keep it encouraging and specific.',
    '',
    'Base your analysis strictly on the attempt data provided. Do not invent errors not present in the data.',
    'Return ONLY valid JSON with the two fields. No markdown fences, no extra commentary.',
  ];

  const userLines: string[] = [
    `Grammar concept: "${item}"`,
    `Current mastery: ${masteryPct}% (effective trials: ${trialsRounded})`,
    '',
    `Attempt history (${attempts.length} event${attempts.length === 1 ? '' : 's'}):`,
  ];

  attempts.forEach((a, idx) => {
    userLines.push('');
    userLines.push(`--- Event ${idx + 1} (${a.eventType}) ---`);
    userLines.push(`English: "${a.english}"`);
    userLines.push(`Expected Spanish: "${a.expectedSpanish}"`);
    if (a.eventType === 'attempt') {
      userLines.push(`Transcript: "${a.transcript || '(nothing said)'}"`);
      userLines.push(`Missing words: ${a.missingWords.length > 0 ? a.missingWords.join(', ') : 'none'}`);
      userLines.push(`Extra words: ${a.extraWords.length > 0 ? a.extraWords.join(', ') : 'none'}`);
      if (a.accuracyScore !== null) {
        userLines.push(`Accuracy: ${Math.round(a.accuracyScore * 100)}% (${a.isAccuracySuccess ? 'passed' : 'failed'})`);
      }
      if (a.aiRationaleForThisItem) {
        userLines.push(`AI grammar note: ${a.aiRationaleForThisItem}`);
      }
    } else {
      userLines.push('(Learner revealed the answer without attempting)');
    }
  });

  userLines.push('');
  userLines.push('Return your analysis as JSON now.');

  return {
    systemPrompt: systemLines.join('\n'),
    userPrompt: userLines.join('\n'),
  };
}
