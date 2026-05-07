import { notFound } from 'next/navigation';
import { getLessonTitle } from '@ai-spanish/logic';
import { LessonSimClient } from './LessonSimClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ lesson?: string }>;
}

export default async function LessonSimPage({ searchParams }: Props) {
  if (process.env.NODE_ENV !== 'development') notFound();

  const { lesson } = await searchParams;
  const lessonId = lesson?.trim() ?? '1';
  const lessonTitle = getLessonTitle(lessonId);

  return <LessonSimClient lessonId={lessonId} lessonTitle={lessonTitle} />;
}
