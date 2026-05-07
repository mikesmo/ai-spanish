/**
 * Prompt builder for the async AI grammar grading feature.
 * Builds the system and user message strings that are sent to Claude.
 * Lives in packages/logic so both the web route and future mobile
 * implementations can import it. Call only on the server.
 */

import type { GrammarGradingRequest } from './grammarGrading';

export interface GrammarGradingPrompts {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Builds the system and user prompts for a grammar grading request.
 * The model is expected to return a structured JSON object matching
 * the GrammarGradingResult schema.
 */
export function buildGrammarGradingPrompts(
  req: GrammarGradingRequest,
): GrammarGradingPrompts {
  const systemLines: string[] = [
    'You are an expert Spanish language grading assistant. Your job is to analyze a beginner learner\'s spoken attempt at a Spanish phrase and determine whether any grammar rules were violated.',
    '',
    'You will receive:',
    '  - The expected Spanish phrase',
    '  - The English meaning',
    '  - A list of grammar rules being tested (comma-separated items, already split for you)',
    '  - The learner\'s transcript (what they actually said)',
    '  - The missing words (words from the target the learner did not say)',
    '  - The extra words (words the learner said that were not in the target)',
    '',
    'You must return a JSON object with exactly these fields:',
    '  - "failedGrammarItems": an array of objects, each with:',
    '      - "item": the exact grammar rule string from the "Grammar rules being tested" list that was violated',
    '      - "rationale": a single sentence explaining why this specific rule was violated (for developer logging only, never shown to the learner)',
    '    This array should be empty if the learner\'s mistake was purely about choosing the wrong vocabulary word (not a grammar error).',
    '  - "wordMistakes": an array of the specific Spanish words (verbatim, as they appear in the target phrase) that were missed due to pure word-choice or recall errors rather than grammar failures. These are words from missingWords that are not explained by a grammar violation.',
    '',
    'Decision criteria:',
    '  - A GRAMMAR failure means the learner used or omitted a word specifically because they misapplied or forgot a grammatical rule (e.g. wrong verb conjugation form, wrong pronoun case, missing article, wrong gender agreement, wrong polite/informal register, wrong tense).',
    '  - A WORD CHOICE failure means the learner simply did not recall the specific vocabulary word — it is not a structural grammar error.',
    '  - A mistake can be BOTH: if the wrong word choice reflects a grammar error (e.g. using informal "tú" form when the grammar rule tested is polite address), list the grammar item AND include the word in wordMistakes.',
    '  - Only include a grammar item in failedGrammarItems if the learner\'s transcript or missing words provide clear evidence of violating that specific rule.',
    '  - If the learner was largely correct (accuracy success) but made a minor error, be precise — only flag genuine grammar violations, not trivial extra words.',
    '',
    'Return ONLY valid JSON with the two fields. No markdown fences, no extra commentary.',
  ];

  const userLines: string[] = [
    `Expected Spanish: "${req.expectedSpanish}"`,
    `English meaning: "${req.englishText}"`,
    '',
    'Grammar rules being tested:',
    req.grammarItems.map((item) => `  - ${item}`).join('\n'),
  ];

  if (req.newGrammarItems.length > 0) {
    userLines.push('');
    userLines.push('New grammar concept introduced (context only, not separately tracked):');
    userLines.push(req.newGrammarItems.map((item) => `  - ${item}`).join('\n'));
  }

  userLines.push('');

  if (req.userTranscript.length === 0) {
    userLines.push('Learner transcript: (nothing said — the learner did not speak)');
  } else {
    userLines.push(`Learner transcript: "${req.userTranscript.join(' ')}"`);
  }

  if (req.missingWords.length > 0) {
    userLines.push(`Missing words (target words the learner did not say): ${req.missingWords.join(', ')}`);
  } else {
    userLines.push('Missing words: none');
  }

  if (req.extraWords.length > 0) {
    userLines.push(`Extra words (said by learner, not in target): ${req.extraWords.join(', ')}`);
  } else {
    userLines.push('Extra words: none');
  }

  userLines.push('');
  userLines.push('Return your analysis as JSON now.');

  return {
    systemPrompt: systemLines.join('\n'),
    userPrompt: userLines.join('\n'),
  };
}
