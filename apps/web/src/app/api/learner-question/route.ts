import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { buildLearnerQuestionSystemPrompt } from '@ai-spanish/logic';
import { assertApiUser } from '@/lib/auth/assert-api-user';

const lastAttemptSchema = z.object({
  userTranscript: z.string(),
  missingWords: z.array(z.string()),
  extraWords: z.array(z.string()),
});

const historyMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(4000),
});

const requestSchema = z.object({
  question: z.string().min(1).max(2000),
  spanishText: z.string().min(1).max(500),
  englishText: z.string().min(1).max(500),
  grammar: z.string().max(200),
  newGrammar: z.string().max(200).optional(),
  newWords: z.string().max(200).optional(),
  lastAttempt: lastAttemptSchema.nullable().optional(),
  history: z.array(historyMessageSchema).max(20),
});

const DEBUG_LOG =
  process.env.NODE_ENV === 'development' ||
  process.env.LEARNER_QUESTION_DEBUG_LOG === '1';

const LOG_PREFIX = '[ai-spanish/learner-question]';

export async function POST(request: NextRequest) {
  const auth = await assertApiUser(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { question, history, ...context } = parsed.data;

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY is not configured' },
      { status: 503 },
    );
  }

  const system = buildLearnerQuestionSystemPrompt(context);

  if (DEBUG_LOG) {
    const payloadForModel = {
      spanishText: context.spanishText,
      englishText: context.englishText,
      grammar: context.grammar,
      newGrammar: context.newGrammar ?? null,
      newWords: context.newWords ?? null,
      lastAttempt: context.lastAttempt ?? null,
    };
    const messages = [...history, { role: 'user' as const, content: question }];
    console.log(`${LOG_PREFIX} system prompt:\n${system}`);
    console.log(`${LOG_PREFIX} context / lesson data:`, JSON.stringify(payloadForModel, null, 2));
    console.log(`${LOG_PREFIX} message list (history + current question):`, JSON.stringify(messages, null, 2));
  }

  const result = streamText({
    model: anthropic('claude-haiku-4-5'),
    system,
    messages: [
      ...history,
      { role: 'user' as const, content: question },
    ],
    maxOutputTokens: 600,
    abortSignal: request.signal,
  });

  return result.toTextStreamResponse();
}
