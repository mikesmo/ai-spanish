import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { historyEntrySchema, sessionCheckpointSchema } from '@ai-spanish/logic';
import {
  appendSessionHistoryEntry,
  getLessonHistory,
  getLatestCheckpoint,
  setLatestCheckpoint,
} from '@/lib/sessionHistoryStore';
import { assertApiUser } from '@/lib/auth/assert-api-user';

const DEV_ONLY = NextResponse.json(
  { error: 'Not found' },
  { status: 404 },
);

const lessonIdSchema = z.string().min(1);

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') return DEV_ONLY;

  const auth = await assertApiUser(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Expected a JSON object' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  const lessonIdResult = lessonIdSchema.safeParse(raw['lessonId']);
  if (!lessonIdResult.success) {
    return NextResponse.json(
      { error: 'Invalid lessonId', issues: lessonIdResult.error.issues },
      { status: 400 },
    );
  }

  const entryResult = historyEntrySchema.safeParse(raw['entry']);
  if (!entryResult.success) {
    return NextResponse.json(
      { error: 'Invalid entry', issues: entryResult.error.issues },
      { status: 400 },
    );
  }

  const lessonId = lessonIdResult.data;
  const entry = entryResult.data;
  appendSessionHistoryEntry(lessonId, entry);

  // Checkpoint is optional — older mobile builds may not send it yet.
  if (raw['checkpoint'] !== undefined) {
    const checkpointResult = sessionCheckpointSchema.safeParse(raw['checkpoint']);
    if (checkpointResult.success) {
      setLatestCheckpoint(lessonId, checkpointResult.data);
    }
  }

  const totalForLesson = getLessonHistory(lessonId).length;

  return NextResponse.json({ lessonId, totalForLesson }, { status: 201 });
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') return DEV_ONLY;

  const auth = await assertApiUser(request);
  if (!auth.ok) return auth.response;

  const lesson = request.nextUrl.searchParams.get('lesson');
  if (!lesson || lesson.trim() === '') {
    return NextResponse.json(
      { error: 'Missing required query param: lesson' },
      { status: 400 },
    );
  }

  const entries = getLessonHistory(lesson);
  const latestCheckpoint = getLatestCheckpoint(lesson);
  return NextResponse.json({ lessonId: lesson, entries, latestCheckpoint });
}
