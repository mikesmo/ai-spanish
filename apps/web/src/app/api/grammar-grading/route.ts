import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { buildGrammarGradingPrompts } from '@ai-spanish/logic';
import { assertApiUser } from '@/lib/auth/assert-api-user';

const requestSchema = z.object({
  phraseId: z.string().min(1).max(200),
  eventSeq: z.number().int().positive(),
  englishText: z.string().min(1).max(500),
  expectedSpanish: z.string().min(1).max(500),
  grammarItems: z.array(z.string().max(200)).max(20),
  newGrammarItems: z.array(z.string().max(200)).max(20),
  userTranscript: z.array(z.string().max(200)).max(100),
  missingWords: z.array(z.string().max(200)).max(100),
  extraWords: z.array(z.string().max(200)).max(100),
});

const resultSchema = z.object({
  failedGrammarItems: z.array(z.object({ item: z.string(), rationale: z.string() })),
  wordMistakes: z.array(z.string()),
});

const DEBUG_LOG =
  process.env.NODE_ENV === 'development' ||
  process.env.GRAMMAR_GRADING_DEBUG_LOG === '1';

const LOG_PREFIX = '[ai-spanish/grammar-grading]';

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

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY is not configured' },
      { status: 503 },
    );
  }

  const req = parsed.data;
  const { systemPrompt, userPrompt } = buildGrammarGradingPrompts(req);

  if (DEBUG_LOG) {
    console.log(`${LOG_PREFIX} eventSeq=${req.eventSeq} phraseId=${req.phraseId}`);
    console.log(`${LOG_PREFIX} system prompt:\n${systemPrompt}`);
    console.log(`${LOG_PREFIX} user prompt:\n${userPrompt}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { object } = await (generateObject as any)({
    model: anthropic('claude-haiku-4-5'),
    schema: resultSchema,
    system: systemPrompt,
    prompt: userPrompt,
    abortSignal: request.signal,
  }) as { object: z.infer<typeof resultSchema> };

  if (DEBUG_LOG) {
    console.log(
      `${LOG_PREFIX} result eventSeq=${req.eventSeq}:`,
      JSON.stringify(object, null, 2),
    );
  }

  return Response.json(object);
}
