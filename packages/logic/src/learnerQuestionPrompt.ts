/**
 * Shared prompt builder for the in-lesson learner question feature.
 * Lives in packages/logic so both web and mobile can share the type definitions.
 * The actual system prompt string is only built on the server (Next.js route handler),
 * but the interfaces are used by the shared hook to type the request body.
 */

export interface LearnerLastAttempt {
  /** Verbatim STT transcript of the learner's most recent spoken attempt. */
  userTranscript: string;
  /** Words in the target phrase the learner did not say. */
  missingWords: string[];
  /** Words the learner said that were not in the target phrase. */
  extraWords: string[];
}

export interface LearnerQuestionContext {
  /** The Spanish phrase the learner is practising (e.g. "Perdón, señor."). */
  spanishText: string;
  /** The English meaning shown on the card (e.g. "Excuse me, sir."). */
  englishText: string;
  /** Grammar category being practised (e.g. "polite address"). */
  grammar: string;
  /** New grammar concept introduced on this card, if any. */
  newGrammar?: string;
  /** New vocabulary introduced on this card, if any. */
  newWords?: string;
  /** The learner's most recent spoken attempt, if one has been recorded. */
  lastAttempt?: LearnerLastAttempt | null;
}

/**
 * Builds the system prompt sent to Claude for a learner question session.
 * Call only on the server — this function is pure and has no side effects.
 */
export function buildLearnerQuestionSystemPrompt(
  ctx: LearnerQuestionContext,
): string {
  const lines: string[] = [
    'You are a professional Spanish instructor (like a classroom teacher): calm, clear, and respectful. You help beginner learners who are working through an audio-based Spanish course. You encourage progress without sounding overly casual or chatty.',
    '',
    'The learner is currently practising the following phrase:',
    `  Spanish: ${ctx.spanishText}`,
    `  English: ${ctx.englishText}`,
    '',
    `Grammar being practised: ${ctx.grammar}`,
  ];

  if (ctx.newGrammar && ctx.newGrammar.trim() !== '') {
    lines.push(`New grammar concept introduced on this card: ${ctx.newGrammar}`);
  }
  if (ctx.newWords && ctx.newWords.trim() !== '') {
    lines.push(`New vocabulary introduced on this card: ${ctx.newWords}`);
  }

  if (ctx.lastAttempt && ctx.lastAttempt.userTranscript.trim() !== '') {
    lines.push('');
    lines.push("Learner's most recent spoken attempt:");
    lines.push(`  What they said: "${ctx.lastAttempt.userTranscript}"`);
    if (ctx.lastAttempt.missingWords.length > 0) {
      lines.push(
        `  Words from the target they missed: ${ctx.lastAttempt.missingWords.join(', ')}`,
      );
    }
    if (ctx.lastAttempt.extraWords.length > 0) {
      lines.push(
        `  Extra or incorrect words they said: ${ctx.lastAttempt.extraWords.join(', ')}`,
      );
    }
    lines.push(
      'If the learner asks why what they said was wrong, compare their attempt to the target Spanish above and explain the difference simply and kindly.',
    );
  }

  lines.push('');
  lines.push('Guidelines for your responses:');
  lines.push(
    '- Keep answers short: 1 to 3 short paragraphs at most. Beginners get overwhelmed by long explanations.',
  );
  lines.push('- Use clear, simple English. Avoid heavy linguistic jargon unless the learner asks for it.');
  lines.push(
    '- Only answer questions about this specific phrase, its grammar, or closely related Spanish language topics.',
  );
  lines.push(
    '- If the learner asks about something unrelated to Spanish or this lesson, politely redirect them back to practising.',
  );
  lines.push(
    '- Acknowledge effort when appropriate; keep the tone professional, not slangy or overly familiar.',
  );
  lines.push(
    '- Never use emojis, emoticons, decorative symbols (e.g. smiley faces), or chat-style fillers.',
  );
  lines.push(
    '- Format every reply in GitHub-Flavored Markdown: use ## or ### for short section titles when it helps structure, **bold** for key Spanish words or short phrases, and bullet lists when listing points. Do not wrap the entire reply in a single bullet; use normal paragraphs where suitable.',
  );

  return lines.join('\n');
}
