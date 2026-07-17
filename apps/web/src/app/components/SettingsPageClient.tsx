"use client";

import {
  CEFR_LEVELS,
  DECLARED_LEVEL_QUERY_KEY,
  putDeclaredLevel,
  useDeclaredLevelQuery,
  type CefrLevel,
} from "@ai-spanish/logic";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { webLessonProgressFetcher } from "@/lib/lessonProgressApi";

export function SettingsPageClient(): JSX.Element {
  const queryClient = useQueryClient();
  const { data: declaredLevel, isLoading, isError } = useDeclaredLevelQuery(
    webLessonProgressFetcher,
  );

  const declareLevelMutation = useMutation({
    mutationFn: (level: CefrLevel) => putDeclaredLevel(webLessonProgressFetcher, level),
    onSuccess: (ok, level) => {
      if (!ok) return;
      queryClient.setQueryData(DECLARED_LEVEL_QUERY_KEY, level);
    },
  });

  const pendingLevel = declareLevelMutation.isPending
    ? declareLevelMutation.variables
    : undefined;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white">
      <main className="w-full max-w-[390px] mx-auto px-8 py-16">
        <div className="mb-2 flex w-full items-center justify-between gap-3">
          <Link
            href="/"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
            aria-label="Back"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <h1 className="flex-1 text-center text-2xl font-semibold text-gray-900">
            Settings
          </h1>
          <span className="w-10 shrink-0" aria-hidden />
        </div>

        <div className="mt-10">
          <p className="mb-2 text-sm font-medium text-gray-900">Your Spanish level</p>
          <p className="mb-6 text-sm text-gray-500">
            Tell us your CEFR level so we can mark words and grammar you should
            already know. You can change this any time.
          </p>

          {isLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : isError ? (
            <p className="text-sm text-[#D85A30]">Failed to load your level.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {CEFR_LEVELS.map((level) => {
                const isSelected = declaredLevel === level;
                const isPending = pendingLevel === level;
                return (
                  <button
                    key={level}
                    type="button"
                    disabled={declareLevelMutation.isPending}
                    onClick={() => declareLevelMutation.mutate(level)}
                    className={`rounded-full border px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      isSelected
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    {isPending ? "…" : level}
                  </button>
                );
              })}
            </div>
          )}

          {declareLevelMutation.isError ||
          (declareLevelMutation.isSuccess && declareLevelMutation.data === false) ? (
            <p className="mt-4 text-sm text-[#D85A30]">
              Could not save your level. Try again.
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
