"use client";

import {
  DEFAULT_COURSE_LEVEL_SLUG,
  type LessonsApiResponse,
} from "@ai-spanish/logic";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { resetLessonProgressAndCompletions } from "@/lib/lessonResetApi";
import {
  COMPLETED_LESSONS_QUERY_KEY,
  useCompletedLessonsQuery,
} from "../hooks/useCompletedLessonsQuery";
import { lessonCompletionQueryKey } from "../hooks/useLessonCompletionQuery";
import { useLessonsQuery } from "../hooks/useLessonsQuery";
import { SignOutButton } from "./SignOutButton";

const isDev = process.env.NODE_ENV === "development";

function HomeLessonsContent({
  data,
}: {
  data: LessonsApiResponse;
}): JSX.Element {
  const { lessons, courseLevel } = data;
  const queryClient = useQueryClient();
  const { data: completed } = useCompletedLessonsQuery();
  const [resetErrorLessonId, setResetErrorLessonId] = useState<string | null>(
    null,
  );
  const completedLessonIds = useMemo<Set<string>>(
    () => new Set(completed?.completedLessonIds ?? []),
    [completed?.completedLessonIds],
  );

  const resetMutation = useMutation({
    mutationFn: async (lessonId: string) => {
      const ok = await resetLessonProgressAndCompletions(lessonId);
      if (!ok) {
        throw new Error("Reset failed");
      }
    },
    onMutate: () => {
      setResetErrorLessonId(null);
    },
    onSuccess: async (_data, lessonId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: COMPLETED_LESSONS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: lessonCompletionQueryKey(lessonId) }),
        queryClient.invalidateQueries({ queryKey: ["lesson-resume-checkpoint", lessonId] }),
      ]);
    },
    onError: (_err, lessonId) => {
      setResetErrorLessonId(lessonId);
    },
  });

  const handleReset = (lessonId: string, lessonTitle: string): void => {
    if (
      !window.confirm(
        `Clear saved progress and all completion history for “${lessonTitle}”? You cannot undo this.`,
      )
    ) {
      return;
    }
    resetMutation.mutate(lessonId);
  };

  return (
    <>
      {lessons.length > 0 ? (
        <p className="text-xs text-gray-400 text-center mb-4">{courseLevel.title}</p>
      ) : null}
      <ul className="flex flex-col gap-4">
        {lessons.map((lesson) => {
          const hasCompletion = completedLessonIds.has(lesson.lessonId);
          const isResetting =
            resetMutation.isPending &&
            resetMutation.variables === lesson.lessonId;
          return (
            <li key={lesson.lessonId} className="flex flex-col gap-1.5">
              <Link
                href={`/lesson/${lesson.lessonId}`}
                className="block w-full rounded-xl border border-gray-200 bg-white px-5 py-4 text-left shadow-sm transition hover:border-gray-300 hover:shadow"
              >
                <span className="block text-base font-medium text-gray-900">
                  {lesson.title}
                </span>
                <span className="mt-1 block text-sm text-gray-500">
                  {lesson.description}
                </span>
              </Link>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={resetMutation.isPending}
                  onClick={() => handleReset(lesson.lessonId, lesson.title)}
                  className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-red-600 rounded-full border border-red-100 bg-white transition hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isResetting ? "Resetting…" : "Reset"}
                </button>
                {hasCompletion ? (
                  <Link
                    href={`/lesson/${lesson.lessonId}/report`}
                    className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-gray-600 rounded-full border border-gray-200 bg-white transition hover:border-gray-300 hover:text-gray-900"
                  >
                    Report
                    <span aria-hidden className="text-gray-400">→</span>
                  </Link>
                ) : null}
              </div>
              {resetErrorLessonId === lesson.lessonId ? (
                <p className="text-right text-xs text-[#D85A30]">
                  Could not reset this lesson. Try again.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {isDev && lessons.length > 0 ? (
        <div className="mt-12 border-t border-dashed border-gray-200 pt-8">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400">
            Developer
          </p>
          <ul className="flex flex-col gap-2">
            {lessons.map((lesson) => (
              <li key={`dev-${lesson.lessonId}`}>
                <Link
                  href={`/dev/mobile-session-log?lesson=${lesson.lessonId}`}
                  className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-4 py-2.5 text-xs text-gray-500 transition hover:border-gray-300 hover:text-gray-700"
                >
                  <span>Mobile session log — {lesson.title}</span>
                  <span className="text-gray-300">→</span>
                </Link>
              </li>
            ))}
            {lessons.map((lesson) => (
              <li key={`sim-${lesson.lessonId}`}>
                <Link
                  href={`/dev/lesson-sim?lesson=${lesson.lessonId}`}
                  className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-4 py-2.5 text-xs text-gray-500 transition hover:border-gray-300 hover:text-gray-700"
                >
                  <span>Lesson simulation — {lesson.title}</span>
                  <span className="text-gray-300">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

export function HomePageClient(): JSX.Element {
  const { data, isLoading, isError, error } = useLessonsQuery(
    DEFAULT_COURSE_LEVEL_SLUG,
  );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white">
      <main className="w-full max-w-[390px] mx-auto px-8 py-16">
        <div className="mb-2 flex w-full items-center justify-between gap-3">
          <span className="w-14 shrink-0" aria-hidden />
          <h1 className="flex-1 text-center text-2xl font-semibold text-gray-900">
            AI Spanish
          </h1>
          <div className="flex w-14 shrink-0 justify-end">
            <SignOutButton />
          </div>
        </div>
        <p className="text-sm text-gray-500 text-center mb-10">
          Choose a lesson to practice
        </p>

        {isLoading ? (
          <p className="text-center text-sm text-gray-500">Loading lessons…</p>
        ) : null}

        {isError ? (
          <p className="text-center text-sm text-[#D85A30]">
            {error instanceof Error ? error.message : "Failed to load lessons."}
          </p>
        ) : null}

        {data ? <HomeLessonsContent data={data} /> : null}

        {!isLoading && data && data.lessons.length === 0 ? (
          <p className="text-center text-sm text-gray-500">
            No lessons in this course level yet. Add rows to{" "}
            <code className="text-xs">lesson_catalog</code> after transcripts exist.
          </p>
        ) : null}
      </main>
    </div>
  );
}
