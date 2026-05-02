import { type NextRequest, NextResponse } from 'next/server';

import { DEFAULT_COURSE_LEVEL_SLUG, lessonsApiResponseSchema } from '@ai-spanish/logic';

import { assertApiUser } from '@/lib/auth/assert-api-user';
import { getLessonTranscriptDbEnv } from '@/server/lesson-transcript-repository';
import { fetchLessonCatalogByCourseLevelSlug } from '@/server/lesson-catalog-repository';

function catalogMisconfiguredResponse(): NextResponse {
  return NextResponse.json(
    {
      error:
        'Lesson catalog is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    },
    { status: 503 },
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await assertApiUser(request);
  if (!auth.ok) return auth.response;

  if (!getLessonTranscriptDbEnv()) {
    return catalogMisconfiguredResponse();
  }

  const rawSlug =
    request.nextUrl.searchParams.get('courseLevel')?.trim() ||
    DEFAULT_COURSE_LEVEL_SLUG;

  const result = await fetchLessonCatalogByCourseLevelSlug(rawSlug);

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: result.message }, { status: 404 });
    }
    return NextResponse.json({ error: result.message }, { status: 500 });
  }

  const body = lessonsApiResponseSchema.parse({
    courseLevel: {
      slug: result.courseLevel.slug,
      title: result.courseLevel.title,
      sortOrder: result.courseLevel.sort_order,
    },
    lessons: result.lessons.map((row) => ({
      lessonId: row.lesson_id,
      title: row.title,
      description: row.description,
      sortOrder: row.sort_order,
    })),
  });

  return NextResponse.json(body);
}
