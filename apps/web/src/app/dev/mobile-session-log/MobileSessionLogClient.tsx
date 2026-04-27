"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  buildDeckFingerprint,
  createInMemoryProgressStore,
  createSessionEngine,
} from "@ai-spanish/logic";
import { useMobileSessionLogQuery } from "../../hooks/useMobileSessionLogQuery";
import { useLessonQuery } from "../../hooks/useLessonQuery";
import {
  SessionHistoryLogView,
  SessionHistoryStatsBar,
} from "../../components/SessionHistoryLogView";

interface Props {
  lessonId: string;
  lessonTitle: string;
}

const LESSON_IDS = ["1", "2"];

export function MobileSessionLogClient({ lessonId, lessonTitle }: Props) {
  const { data, isLoading, isError } = useMobileSessionLogQuery(lessonId);
  const { data: phrases } = useLessonQuery(lessonId);
  const entries = data?.entries ?? [];

  /**
   * Hydrate a throwaway session engine from the latest checkpoint whenever
   * both the deck and checkpoint are available and their fingerprints match.
   * This lets `getLiveSlotsAhead` reuse the real `getQueuePosition` logic from
   * the engine rather than duplicating queue-position rules on the frontend.
   */
  const hydratedEngine = useMemo(() => {
    const cp = data?.latestCheckpoint;
    if (!cp || !phrases || phrases.length === 0) return null;

    // Validate deck fingerprint if the checkpoint carries one.
    if (cp.deckFingerprint !== undefined) {
      const webFingerprint = buildDeckFingerprint(phrases);
      if (cp.deckFingerprint !== webFingerprint) return null;
    }

    try {
      const store = createInMemoryProgressStore();
      return createSessionEngine(phrases, store, {
        initialCheckpoint: cp,
        getCompletedLessonCount: () => cp.completedLessonCount,
      });
    } catch {
      return null;
    }
  }, [data?.latestCheckpoint, phrases]);

  const getLiveSlotsAhead = useMemo(
    () =>
      hydratedEngine
        ? (phraseId: string) => hydratedEngine.getQueuePosition(phraseId)
        : () => null,
    [hydratedEngine],
  );

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
              {hydratedEngine
                ? "Updates every ~2s · session (now) live"
                : "Updates every ~2s"}
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
            getLiveSlotsAhead={getLiveSlotsAhead}
            queueVersion={entries.length}
            completedLessonCount={data?.latestCheckpoint?.completedLessonCount ?? 0}
            emptyStateMessage={`No entries yet for ${lessonTitle}. Start a lesson on the mobile app — entries appear here within ~2s of each phrase interaction.`}
          />
        </div>
      </div>
    </div>
  );
}
