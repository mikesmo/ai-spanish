import { notFound } from 'next/navigation';
import { getLessonTitle } from '@ai-spanish/logic';
import { LessonSimClient } from './LessonSimClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ lesson?: string; untilPhrase?: string }>;
}

/** Parses `?untilPhrase=` as a 1-based inclusive phrase count. Missing/blank/invalid → `undefined` (full lesson). */
function parseUntilPhrase(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return undefined;
  return parsed;
}

export default async function LessonSimPage({ searchParams }: Props) {
  if (process.env.NODE_ENV !== 'development') notFound();

  const { lesson, untilPhrase } = await searchParams;
  const lessonId = lesson?.trim() ?? '1';
  const lessonTitle = getLessonTitle(lessonId);
  const untilPhraseNumber = parseUntilPhrase(untilPhrase);

  return (
    <LessonSimClient
      lessonId={lessonId}
      lessonTitle={lessonTitle}
      untilPhrase={untilPhraseNumber}
    />
  );
}
