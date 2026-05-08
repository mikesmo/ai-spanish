/**
 * Server-only helper that generates AI-written focus summaries for up to three of the worst
 * weak/stabilizing grammar items at lesson completion.
 *
 * Called synchronously from POST /api/lesson-completions before the upsert
 * so summaries are baked into the stored payload.
 */

import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';
import {
  buildGrammarSummaryPrompts,
  classifyItemMastery,
  type GrammarMasteryRow,
  type GrammarSummary,
  type HistoryEntry,
} from '@ai-spanish/logic';

const SUMMARY_TIMEOUT_MS = 12_000;

const LOG_PREFIX = '[ai-spanish/grammar-summary]';
const DEBUG_LOG =
  process.env.NODE_ENV === 'development' ||
  process.env.GRAMMAR_SUMMARY_DEBUG_LOG === '1';

const aiResultSchema = z.object({
  struggling: z.string(),
  focus: z.string(),
});

async function generateOneSummary(
  row: GrammarMasteryRow,
  entries: readonly HistoryEntry[],
): Promise<GrammarSummary> {
  const { systemPrompt, userPrompt } = buildGrammarSummaryPrompts(
    row.item,
    row,
    entries,
  );

  if (DEBUG_LOG) {
    console.log(`${LOG_PREFIX} generating summary for "${row.item}"`);
    console.log(`${LOG_PREFIX} system:\n${systemPrompt}`);
    console.log(`${LOG_PREFIX} user:\n${userPrompt}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { object } = await (generateObject as any)({
      model: anthropic('claude-haiku-4-5'),
      schema: aiResultSchema,
      system: systemPrompt,
      prompt: userPrompt,
      abortSignal: controller.signal,
    }) as { object: z.infer<typeof aiResultSchema> };

    if (DEBUG_LOG) {
      console.log(`${LOG_PREFIX} result for "${row.item}":`, JSON.stringify(object));
    }

    const band = classifyItemMastery(row.mastery);
    return {
      item: row.item,
      mastery: row.mastery,
      band: band as 'weak' | 'stabilizing',
      trialsEff: row.trialsEff,
      attemptCount: row.phraseIds.length,
      status: 'success',
      struggling: object.struggling,
      focus: object.focus,
    };
  } catch (err: unknown) {
    const errorReason =
      err instanceof Error ? err.message : 'Unknown error';
    console.error(
      `${LOG_PREFIX} failed for "${row.item}": ${errorReason}`,
    );
    const band = classifyItemMastery(row.mastery);
    return {
      item: row.item,
      mastery: row.mastery,
      band: band as 'weak' | 'stabilizing',
      trialsEff: row.trialsEff,
      attemptCount: row.phraseIds.length,
      status: 'error',
      errorReason,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Runs up to 5 AI summary calls in parallel (one per grammar item).
 * Always resolves — failed calls produce `{ status: 'error' }` entries.
 */
export async function generateGrammarSummaries(
  targets: readonly GrammarMasteryRow[],
  entries: readonly HistoryEntry[],
): Promise<GrammarSummary[]> {
  const results = await Promise.allSettled(
    targets.map((row) => generateOneSummary(row, entries)),
  );

  return results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    const row = targets[i]!;
    const band = classifyItemMastery(row.mastery);
    return {
      item: row.item,
      mastery: row.mastery,
      band: band as 'weak' | 'stabilizing',
      trialsEff: row.trialsEff,
      attemptCount: row.phraseIds.length,
      status: 'error' as const,
      errorReason: result.reason instanceof Error
        ? result.reason.message
        : 'Unknown error',
    };
  });
}
