"use client";

import {
  buildDeckFingerprint,
  buildDevPhraseIndexCheckpoint,
  isTranscriptLessonIdSyntaxValid,
} from "@ai-spanish/logic";
import { notFound, useParams, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useLessonResumeCheckpointQuery } from "@ai-spanish/logic";
import { PhraseDisplay } from "../../components/PhraseDisplay";
import { useLessonQuery } from "../../hooks/useLessonQuery";
import { webLessonProgressFetcher } from "@/lib/lessonProgressApi";

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
    isLoading: isLessonLoading,
    isError: isLessonError,
    error: lessonError,
  } = useLessonQuery(lessonId);

  /**
   * Resume probe runs in parallel with the lesson transcript fetch so the user
   * never sees a separate "restoring" stage after the lesson finishes loading.
   */
  const resumeQuery = useLessonResumeCheckpointQuery(webLessonProgressFetcher, lessonId);

  const devPhraseIndexKey =
    process.env.NODE_ENV === "development"
      ? (searchParams.get("phraseIndex") ?? "_")
      : "_";

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

  /**
   * Dev `?phraseIndex=` wins over DB resume checkpoint. The persisted
   * checkpoint is only honored when its `deckFingerprint` matches the
   * currently loaded deck — stale checkpoints (e.g. from before the lesson
   * content changed) are discarded so PhraseDisplay starts a fresh session.
   */
  const initialSessionCheckpoint = useMemo(() => {
    if (devSessionCheckpointOnly) return devSessionCheckpointOnly;
    const cp = resumeQuery.data;
    if (!cp || phrases == null || phrases.length === 0) return undefined;
    if (cp.deckFingerprint !== undefined) {
      const fp = buildDeckFingerprint(phrases);
      if (cp.deckFingerprint !== fp) return undefined;
    }
    return cp;
  }, [devSessionCheckpointOnly, resumeQuery.data, phrases]);

  /**
   * Single, unified loading state. The resume probe must complete a real fetch
   * round-trip on every mount before we render PhraseDisplay — `isSuccess`
   * alone is not enough because `refetchOnMount: 'always'` returns the cached
   * value (often stale: `null` from a prior reset, or the previous run's
   * checkpoint) while a background refetch is still in flight. PhraseDisplay
   * consumes `initialSessionCheckpoint` once at mount and cannot pick up a
   * later update, so we wait for `isFetching` to drop.
   */
  const isResumeSettled =
    Boolean(devSessionCheckpointOnly) ||
    resumeQuery.isError ||
    (resumeQuery.isSuccess && !resumeQuery.isFetching);
  const isPageLoading = isLessonLoading || !isResumeSettled;

  if (isPageLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <main className="w-full max-w-[390px] mx-auto px-8 py-16 text-center text-gray-500">
          Loading lesson...
        </main>
      </div>
    );
  }

  if (isLessonError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <main className="w-full max-w-[390px] mx-auto px-8 py-16 text-center text-[#D85A30]">
          {lessonError instanceof Error
            ? lessonError.message
            : "Failed to load lesson."}
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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white">
      <main className="w-full">
        <PhraseDisplay
          key={`${lessonId}-${devPhraseIndexKey}`}
          phrases={phrases}
          lessonId={lessonId}
          initialSessionCheckpoint={initialSessionCheckpoint}
        />
      </main>
    </div>
  );
}
