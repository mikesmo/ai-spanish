"use client";

import {
  bucketPhrasesByRevisitCount,
  buildPhrasesByMasterScore,
  computeLessonReportSummary,
  type PhraseMasteryRow,
  type PhraseRevisitRow,
  type PhraseState,
} from "@ai-spanish/logic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { HistorySidebar, HistoryToggle } from "../../../components/HistorySidebar";
import { useLessonCompletionQuery } from "../../../hooks/useLessonCompletionQuery";

interface Props {
  lessonId: string;
  lessonTitle: string;
}

const formatPct = (n: number | null): string =>
  n == null ? "—" : `${Math.round(n * 100)}%`;

const formatCompletedAt = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

const STATE_BADGE_CLASS: Record<PhraseState, string> = {
  new: "bg-gray-100 text-gray-600 border-gray-200",
  learning: "bg-red-50 text-red-700 border-red-200",
  stabilizing: "bg-amber-50 text-amber-700 border-amber-200",
  mastered: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const STATE_BADGE_LABEL: Record<PhraseState, string> = {
  new: "new",
  learning: "learning",
  stabilizing: "stabilizing",
  mastered: "mastered",
};

const noLiveSlots = (): number | null => null;

interface SummaryStats {
  totalEvents: number;
  totalAttempts: number;
  exactCorrect: number;
  exactCorrectPct: number | null;
  avgAccuracy: number | null;
  avgFluency: number | null;
  practiceCount: number;
  revealCount: number;
  revisitAttemptCount: number;
}

const SummarySection = ({
  stats,
  completedAtMs,
}: {
  stats: SummaryStats;
  completedAtMs: number | null;
}): JSX.Element => (
  <section
    aria-label="Lesson summary"
    className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm"
  >
    <header className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold text-gray-800">Summary</h2>
      {completedAtMs != null ? (
        <span className="text-[11px] text-gray-500">
          Completed {formatCompletedAt(completedAtMs)}
        </span>
      ) : null}
    </header>
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      <div className="flex flex-col">
        <dt className="text-[10px] uppercase tracking-wide text-gray-500">
          Attempts
        </dt>
        <dd className="text-base font-semibold tabular-nums text-gray-900">
          {stats.totalAttempts}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="text-[10px] uppercase tracking-wide text-gray-500">
          Exact
        </dt>
        <dd className="text-base font-semibold tabular-nums text-gray-900">
          {stats.exactCorrectPct == null
            ? "—"
            : `${stats.exactCorrect}/${stats.totalAttempts}`}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="text-[10px] uppercase tracking-wide text-gray-500">
          Avg acc
        </dt>
        <dd className="text-base font-semibold tabular-nums text-gray-900">
          {formatPct(stats.avgAccuracy)}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="text-[10px] uppercase tracking-wide text-gray-500">
          Avg flu
        </dt>
        <dd className="text-base font-semibold tabular-nums text-gray-900">
          {formatPct(stats.avgFluency)}
        </dd>
      </div>
    </dl>
    {(stats.practiceCount > 0 ||
      stats.revealCount > 0 ||
      stats.revisitAttemptCount > 0) && (
      <p className="mt-3 text-[11px] text-gray-500">
        {stats.practiceCount} retry · {stats.revealCount} reveal ·{" "}
        {stats.revisitAttemptCount} revisit attempt
        {stats.revisitAttemptCount === 1 ? "" : "s"}
      </p>
    )}
  </section>
);

const PhraseRevisitList = ({
  rows,
}: {
  rows: PhraseRevisitRow[];
}): JSX.Element => (
  <ul className="mt-3 flex flex-col gap-2">
    {rows.map(({ phrase, revisitCount, failedAttempts }) => (
      <li
        key={phrase.name}
        className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm italic text-gray-900">
            {phrase.Spanish.answer}
          </p>
          <p className="truncate text-xs text-gray-500">
            {phrase.English.question}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-[10px] text-gray-500">
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 tabular-nums">
            {revisitCount}× revisit
            {revisitCount === 1 ? "" : "s"}
          </span>
          {failedAttempts > 0 ? (
            <span className="tabular-nums text-red-500">
              {failedAttempts} fail{failedAttempts === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </li>
    ))}
  </ul>
);

interface RevisitBucketProps {
  title: string;
  rows: PhraseRevisitRow[];
  defaultOpen?: boolean;
}

const RevisitBucket = ({
  title,
  rows,
  defaultOpen = false,
}: RevisitBucketProps): JSX.Element | null => {
  if (rows.length === 0) return null;
  return (
    <details
      className="group rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-gray-800">
        <span>
          {title}{" "}
          <span className="ml-1 text-xs font-normal text-gray-500">
            ({rows.length})
          </span>
        </span>
        <span
          aria-hidden
          className="text-gray-400 transition group-open:rotate-90"
        >
          ▸
        </span>
      </summary>
      <PhraseRevisitList rows={rows} />
    </details>
  );
};

const MasterySection = ({
  rows,
}: {
  rows: PhraseMasteryRow[];
}): JSX.Element => (
  <section
    aria-label="Phrases by mastery score"
    className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm"
  >
    <header className="mb-2 flex items-center justify-between">
      <h2 className="text-sm font-semibold text-gray-800">
        Phrases by Master Score
      </h2>
      <span className="text-[11px] text-gray-500">
        Lowest first · {rows.length} phrase{rows.length === 1 ? "" : "s"}
      </span>
    </header>
    {rows.length === 0 ? (
      <p className="py-2 text-center text-xs text-gray-500">
        No phrases were scored in this lesson.
      </p>
    ) : (
      <ul className="flex flex-col gap-2">
        {rows.map(({ phrase, masteryScore, state }) => (
          <li
            key={phrase.name}
            className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm italic text-gray-900">
                {phrase.Spanish.answer}
              </p>
              <p className="truncate text-xs text-gray-500">
                {phrase.English.question}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <span className="text-sm font-semibold tabular-nums text-gray-900">
                {formatPct(masteryScore)}
              </span>
              <span
                className={`rounded-full border px-1.5 py-0.5 text-[10px] ${STATE_BADGE_CLASS[state]}`}
              >
                {STATE_BADGE_LABEL[state]}
              </span>
            </div>
          </li>
        ))}
      </ul>
    )}
  </section>
);

const BackHeader = ({
  lessonId,
  lessonTitle,
}: {
  lessonId: string;
  lessonTitle: string;
}): JSX.Element => (
  <header className="mb-6 flex items-center gap-3">
    <Link
      href="/"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
      aria-label="Back to home"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
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
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">
        Lesson report
      </p>
      <h1 className="truncate text-lg font-semibold text-gray-900">
        {lessonTitle}
      </h1>
      <p className="text-[11px] text-gray-400">Lesson {lessonId}</p>
    </div>
  </header>
);

export function LessonReportClient({
  lessonId,
  lessonTitle,
}: Props): JSX.Element {
  const { data, isLoading, isError, error } = useLessonCompletionQuery(lessonId);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const entries = useMemo(() => data?.entries ?? [], [data?.entries]);
  const checkpoint = data?.latestCheckpoint ?? null;
  const incorrectPhraseRecords = useMemo(
    () => checkpoint?.incorrectPhraseRecords ?? [],
    [checkpoint?.incorrectPhraseRecords],
  );
  const progress = useMemo(
    () => checkpoint?.progress ?? [],
    [checkpoint?.progress],
  );

  const summary = useMemo(
    () => computeLessonReportSummary(entries),
    [entries],
  );
  const buckets = useMemo(
    () => bucketPhrasesByRevisitCount(entries),
    [entries],
  );
  const masteryRows = useMemo(
    () => buildPhrasesByMasterScore(entries, progress),
    [entries, progress],
  );

  const completedAtMs = useMemo(() => {
    if (entries.length === 0) return null;
    let max = 0;
    for (const entry of entries) {
      const t = entry.event.timestamp;
      if (typeof t === "number" && t > max) max = t;
    }
    return max > 0 ? max : null;
  }, [entries]);

  const hasCompletion = entries.length > 0;

  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto w-full max-w-[640px] px-6 py-10">
        <BackHeader lessonId={lessonId} lessonTitle={lessonTitle} />

        {isLoading ? (
          <p className="text-center text-sm text-gray-500">Loading report…</p>
        ) : null}

        {isError ? (
          <p className="text-center text-sm text-[#D85A30]">
            {error instanceof Error
              ? error.message
              : "Failed to load lesson report."}
          </p>
        ) : null}

        {!isLoading && !isError && !hasCompletion ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white px-5 py-10 text-center">
            <p className="text-sm text-gray-700">
              No completion yet — finish the lesson to see your report.
            </p>
            <Link
              href={`/lesson/${lessonId}`}
              className="mt-4 inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900"
            >
              Start lesson
              <span aria-hidden className="text-gray-400">→</span>
            </Link>
          </div>
        ) : null}

        {hasCompletion ? (
          <div className="flex flex-col gap-5">
            <SummarySection stats={summary} completedAtMs={completedAtMs} />

            {buckets.once.length === 0 &&
            buckets.twice.length === 0 &&
            buckets.threePlus.length === 0 ? (
              <section
                aria-label="Revisits"
                className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm"
              >
                <h2 className="text-sm font-semibold text-gray-800">Revisits</h2>
                <p className="mt-2 text-xs text-gray-500">
                  No phrases needed a revisit in this lesson.
                </p>
              </section>
            ) : (
              <div className="flex flex-col gap-3">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Revisits
                </h2>
                <RevisitBucket
                  title="Phrases that failed once"
                  rows={buckets.once}
                  defaultOpen
                />
                <RevisitBucket
                  title="Phrases that failed twice"
                  rows={buckets.twice}
                />
                <RevisitBucket
                  title="Phrases that failed 3+ times"
                  rows={buckets.threePlus}
                />
              </div>
            )}

            <MasterySection rows={masteryRows} />
          </div>
        ) : null}
      </main>

      {hasCompletion ? (
        <>
          <HistoryToggle
            count={entries.length}
            onClick={() => setIsHistoryOpen(true)}
          />
          <HistorySidebar
            history={entries}
            isOpen={isHistoryOpen}
            onClose={() => setIsHistoryOpen(false)}
            onClear={() => undefined}
            getLiveSlotsAhead={noLiveSlots}
            queueVersion={0}
            remainingInSession={0}
            incorrectPhraseRecords={incorrectPhraseRecords}
            hideClearButton
          />
        </>
      ) : null}
    </div>
  );
}
