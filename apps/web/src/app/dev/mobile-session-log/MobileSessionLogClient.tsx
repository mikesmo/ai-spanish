"use client";

import Link from "next/link";
import { useMobileSessionLogQuery } from "../../hooks/useMobileSessionLogQuery";
import {
  SessionHistoryLogView,
  SessionHistoryStatsBar,
} from "../../components/SessionHistoryLogView";

interface Props {
  lessonId: string;
  lessonTitle: string;
}

const LESSON_IDS = ["1", "2"];

const noopGetLiveSlotsAhead = (): null => null;

export function MobileSessionLogClient({ lessonId, lessonTitle }: Props) {
  const { data, isLoading, isError } = useMobileSessionLogQuery(lessonId);
  const entries = data?.entries ?? [];

  return (
    <div className="min-h-screen bg-gray-50 font-mono text-sm">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-baseline gap-4">
          <Link
            href="/"
            className="text-xs text-gray-400 hover:text-gray-600 transition"
          >
            ← Home
          </Link>
          <h1 className="text-lg font-semibold text-gray-800">
            Mobile session log — {lessonTitle}
          </h1>
          {isLoading && (
            <span className="ml-auto text-xs text-gray-400">Loading…</span>
          )}
          {isError && (
            <span className="ml-auto text-xs text-red-500">
              Error fetching data
            </span>
          )}
          {!isLoading && !isError && (
            <span className="ml-auto text-xs text-gray-400">
              Updates every ~2s
            </span>
          )}
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {LESSON_IDS.map((id) => (
            <Link
              key={id}
              href={`/dev/mobile-session-log?lesson=${id}`}
              className={`rounded border px-3 py-1 text-xs transition ${
                id === lessonId
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-400"
              }`}
            >
              Lesson {id}
            </Link>
          ))}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <SessionHistoryStatsBar
            history={entries}
            remainingInSession={0}
            subtitle="Buffered log (mobile dev)"
            variant="light"
          />
          <SessionHistoryLogView
            history={entries}
            getLiveSlotsAhead={noopGetLiveSlotsAhead}
            queueVersion={0}
            completedLessonCount={0}
            emptyStateMessage={`No entries yet for ${lessonTitle}. Start a lesson on the mobile app — entries appear here within ~2s of each phrase interaction.`}
          />
        </div>
      </div>
    </div>
  );
}
