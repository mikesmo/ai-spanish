import { type NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { assertApiUser } from '@/lib/auth/assert-api-user';

const TRANSCRIPTS_DIR = path.join(process.cwd(), 'data', 'transcripts');

const DEFAULT_LESSON = '1';
const VALID_LESSON_IDS = new Set(['1', '2']);

function resolveLessonId(raw: string | null): string {
  if (raw == null || raw === '' || !VALID_LESSON_IDS.has(raw)) {
    return DEFAULT_LESSON;
  }
  return raw;
}

export async function GET(request: NextRequest) {
  const auth = await assertApiUser(request);
  if (!auth.ok) return auth.response;

  try {
    const lessonId = resolveLessonId(
      request.nextUrl.searchParams.get('lesson'),
    );
    const fileName = `lesson${lessonId}.json`;
    const jsonPath = path.join(TRANSCRIPTS_DIR, fileName);
    const fileContent = fs.readFileSync(jsonPath, 'utf8');
    
    // Parse the JSON content
    const phrases = JSON.parse(fileContent);
    
    // Return the JSON response
    return NextResponse.json(phrases);
  } catch (error) {
    console.error('Error reading transcript data:', error);
    return NextResponse.json(
      { error: 'Failed to load phrases' },
      { status: 500 }
    );
  }
}