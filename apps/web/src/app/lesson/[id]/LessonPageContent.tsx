"use client";

import {
  buildDevPhraseIndexCheckpoint,
  isTranscriptLessonIdSyntaxValid,
} from "@ai-spanish/logic";
import { notFound, useParams, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { PhraseDisplay } from "../../components/PhraseDisplay";
import { useLessonQuery } from "../../hooks/useLessonQuery";
import { useLessonResumeCheckpointQuery } from "../../hooks/useLessonResumeCheckpointQuery";

function resolveLessonId(params: { id?: string | string[] }): string {
  const raw =
    typeof params.id === "string"
      ? params.id
      : Array.isArray(params.id)
        ? params.id[0]
        : undefined;
  if (raw == null || !isTranscriptLessonIdSyntaxValid(raw)) {
    notFound();
  }
  return raw;
}

export default function LessonPageContent(): JSX.Element {
  const params = useParams();
  const lessonId = resolveLessonId(params);
  const searchParams = useSearchParams();

  const {
    data: phrases,
    isLoading,
    isError,
    error,
  } = useLessonQuery(lessonId);

  const devPhraseIndexKey =
    process.env.NODE_ENV === "development"
      ? (searchParams.get("phraseIndex") ?? "_")
      : "_";

  const resumeQuery = useLessonResumeCheckpointQuery(lessonId, phrases);

  const devSessionCheckpointOnly = useMemo(() => {
    if (
      process.env.NODE_ENV !== "development" ||
      phrases == null ||
      phrases.length === 0
    ) {
      return undefined;
    }
    const raw = searchParams.get("phraseIndex");
    if (raw === null || raw === "") {
      return undefined;
    }
    const phraseIndex = Number.parseInt(raw, 10);
    if (!Number.isFinite(phraseIndex) || phraseIndex < 0) {
      return undefined;
    }
    return buildDevPhraseIndexCheckpoint({
      lessonId,
      deck: phrases,
      phraseIndex,
      completedLessonCount: 0,
    });
  }, [lessonId, phrases, searchParams]);

  /** Dev `?phraseIndex=` wins over DB resume checkpoint. */
  const initialSessionCheckpoint = useMemo(
    () =>
      devSessionCheckpointOnly ??
      resumeQuery.data ??
      undefined,
    [devSessionCheckpointOnly, resumeQuery.data],
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <main className="w-full max-w-[390px] mx-auto px-8 py-16 text-center text-gray-500">
          Loading lesson...
        </main>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <main className="w-full max-w-[390px] mx-auto px-8 py-16 text-center text-[#D85A30]">
          {error instanceof Error ? error.message : "Failed to load lesson."}
        </main>
      </div>
    );
  }

  if (!phrases || phrases.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <main className="w-full max-w-[390px] mx-auto px-8 py-16 text-center text-gray-500">
          No phrases available.
        </main>
      </div>
    );
  }

  /**
   * Engine hydrates once — wait for any in-flight resume GET so we never mount
   * with stale React Query cache while a refetch is in flight.
   * Dev ?phraseIndex= skips.
   */
  const resumeProbeSettled =
    devSessionCheckpointOnly ||
    (resumeQuery.isFetched && !resumeQuery.isFetching);

  if (!resumeProbeSettled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <main className="w-full max-w-[390px] mx-auto px-8 py-16 text-center text-gray-500">
          Restoring your lesson...
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white">
      <main className="w-full">
        <PhraseDisplay
          key={`${lessonId}-${devPhraseIndexKey}`}
          phrases={phrases}
          lessonId={lessonId}
          initialSessionCheckpoint={initialSessionCheckpoint ?? undefined}
        />
      </main>
    </div>
  );
}
