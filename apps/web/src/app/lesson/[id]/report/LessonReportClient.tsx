"use client";

import {
  averageMasteryByPos,
  bucketPhrasesByFailedAttemptCount,
  buildGrammarItemsByMastery,
  buildItemScoreLookupsForHistoryDetail,
  buildPhrasesByMasterScore,
  buildWordsByMastery,
  computeLessonReportSummary,
  filterHistoryEntriesForGrammarItemTrail,
  filterHistoryEntriesForWordItemTrail,
  groupWordsByPos,
  isReportEligibleItem,
  normalizeStr,
  PART_OF_SPEECH_VALUES,
  summarizeItemBands,
  type GrammarMasteryRow,
  type GrammarSummary,
  type HistoryEntry,
  type IncorrectPhraseRecord,
  type ItemBandSummary,
  type ItemMasteryBand,
  type ItemScore,
  type PhraseMasteryRow,
  type PhraseRevisitRow,
  type PhraseState,
  type WordMasteryRow,
} from "@ai-spanish/logic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { HistorySidebar, HistoryToggle } from "../../../components/HistorySidebar";
import { SessionHistoryEntryDetail } from "../../../components/SessionHistoryLogView";
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

// ─── Badge styles ──────────────────────────────────────────────────────────────

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

const BAND_BADGE_CLASS: Record<ItemMasteryBand, string> = {
  weak: "bg-red-50 text-red-700 border-red-200",
  stabilizing: "bg-amber-50 text-amber-700 border-amber-200",
  mastered: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const noLiveSlots = (): number | null => null;

/** Matches session history `#` column for this phrase's last row (`eventSeq ?? chronological index`). */
const ReportLastEventSeq = ({ seq }: { seq: number }): JSX.Element | null => {
  if (seq <= 0) return null;
  return (
    <span
      className="font-mono text-[10px] tabular-nums text-gray-400"
      title="History # column — last row for this phrase in lesson order"
    >
      {seq}
    </span>
  );
};

// ─── Summary section ──────────────────────────────────────────────────────────

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

// ─── Failed attempts sections ─────────────────────────────────────────────────

const PhraseRevisitList = ({
  rows,
}: {
  rows: PhraseRevisitRow[];
}): JSX.Element => (
  <ul className="mt-3 flex flex-col gap-2">
    {rows.map(({ phrase, revisitCount, lastEventSeq }) => (
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
          {revisitCount > 0 ? (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 tabular-nums">
              {revisitCount}× revisit
              {revisitCount === 1 ? "" : "s"}
            </span>
          ) : null}
          <ReportLastEventSeq seq={lastEventSeq} />
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

// ─── Phrase mastery section ───────────────────────────────────────────────────

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
        {rows.map(({ phrase, masteryScore, state, lastEventSeq }) => (
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
              <ReportLastEventSeq seq={lastEventSeq} />
            </div>
          </li>
        ))}
      </ul>
    )}
  </section>
);

// ─── Mastery health snapshot ──────────────────────────────────────────────────

const BandBar = ({
  summary,
  label,
}: {
  summary: ItemBandSummary;
  label: string;
}): JSX.Element => {
  const { weak, stabilizing, mastered, untrained, total } = summary;
  if (total === 0) return <p className="text-xs text-gray-400">No data</p>;

  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] text-gray-600">{label}</span>
        <span className="text-[10px] text-gray-400">{total} items</span>
      </div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100"
        role="img"
        aria-label={`${label}: ${mastered} mastered, ${stabilizing} stabilizing, ${weak} weak, ${untrained} untrained`}
      >
        {mastered > 0 && (
          <div
            className="h-full bg-emerald-500"
            style={{ width: pct(mastered) }}
          />
        )}
        {stabilizing > 0 && (
          <div
            className="h-full bg-amber-400"
            style={{ width: pct(stabilizing) }}
          />
        )}
        {weak > 0 && (
          <div
            className="h-full bg-red-400"
            style={{ width: pct(weak) }}
          />
        )}
        {untrained > 0 && (
          <div
            className="h-full bg-gray-200"
            style={{ width: pct(untrained) }}
          />
        )}
      </div>
      <div className="mt-1 flex gap-3 text-[10px] text-gray-500">
        {mastered > 0 && <span className="text-emerald-600">{mastered} mastered</span>}
        {stabilizing > 0 && <span className="text-amber-600">{stabilizing} stabilizing</span>}
        {weak > 0 && <span className="text-red-600">{weak} weak</span>}
        {untrained > 0 && <span className="text-gray-400">{untrained} unseen</span>}
      </div>
    </div>
  );
};

const MasteryHealthSection = ({
  wordSummary,
  grammarSummary,
}: {
  wordSummary: ItemBandSummary;
  grammarSummary: ItemBandSummary;
}): JSX.Element => (
  <section
    aria-label="Mastery health"
    className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm"
  >
    <h2 className="mb-4 text-sm font-semibold text-gray-800">Mastery Health</h2>
    <div className="flex flex-col gap-4">
      <BandBar summary={wordSummary} label="Words" />
      <BandBar summary={grammarSummary} label="Grammar" />
    </div>
    <div className="mt-3 flex flex-wrap gap-3 text-[10px]">
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" />
        Mastered
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-sm bg-amber-400" />
        Stabilizing
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-sm bg-red-400" />
        Weak
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-sm bg-gray-200" />
        Unseen
      </span>
    </div>
  </section>
);

// ─── POS strength bar ─────────────────────────────────────────────────────────

const POS_LABEL: Record<string, string> = {
  verb: "Verbs",
  noun: "Nouns",
  adjective: "Adjectives",
  adverb: "Adverbs",
  pronoun: "Pronouns",
  preposition: "Prepositions",
  conjunction: "Conjunctions",
  article: "Articles",
  determiner: "Determiners",
};

const PosStrengthSection = ({
  avgByPos,
}: {
  avgByPos: Partial<Record<string, number | null>>;
}): JSX.Element | null => {
  const posEntries = PART_OF_SPEECH_VALUES.filter(
    (pos) => pos in avgByPos,
  );
  if (posEntries.length === 0) return null;

  return (
    <section
      aria-label="Part of speech strength"
      className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm"
    >
      <h2 className="mb-3 text-sm font-semibold text-gray-800">
        Strength by Part of Speech
      </h2>
      <ul className="flex flex-col gap-2">
        {posEntries.map((pos) => {
          const avg = avgByPos[pos];
          const pct = avg != null ? Math.round(avg * 100) : null;
          const bandClass =
            avg == null
              ? "bg-gray-200"
              : avg >= 0.8
                ? "bg-emerald-500"
                : avg >= 0.6
                  ? "bg-amber-400"
                  : "bg-red-400";

          return (
            <li key={pos} className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-[11px] text-gray-600">
                {POS_LABEL[pos] ?? pos}
              </span>
              <div className="flex-1 overflow-hidden rounded-full bg-gray-100 h-2">
                <div
                  className={`h-full rounded-full ${bandClass} transition-[width] duration-300`}
                  style={{ width: pct != null ? `${pct}%` : "0%" }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-600">
                {pct != null ? `${pct}%` : "—"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

// ─── Item trail panel ─────────────────────────────────────────────────────────

const EVENT_LABEL: Record<string, string> = {
  attempt: "attempt",
  reveal: "reveal",
  practice: "retry",
};

interface ItemTrailPanelProps {
  trailEntries: HistoryEntry[];
  incorrectRecordsByPhraseId: ReadonlyMap<string, IncorrectPhraseRecord>;
  grammarItemScoreLookup: ReadonlyMap<string, ItemScore>;
  wordScoreLookup: ReadonlyMap<string, ItemScore>;
}

const ItemTrailPanel = ({
  trailEntries,
  incorrectRecordsByPhraseId,
  grammarItemScoreLookup,
  wordScoreLookup,
}: ItemTrailPanelProps): JSX.Element => {
  if (trailEntries.length === 0) {
    return (
      <p className="mt-2 text-[11px] text-gray-400">No events recorded for this item.</p>
    );
  }

  return (
    <ol className="mt-2 flex flex-col gap-1">
      {trailEntries.map((entry, idx) => {
        const seq = entry.eventSeq ?? idx + 1;
        const label = EVENT_LABEL[entry.event.eventType] ?? entry.event.eventType;
        const spanish = entry.phrase.Spanish.answer;
        return (
          <li key={entry.id}>
            <details className="group rounded border border-gray-100 bg-white">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 text-[11px] hover:bg-gray-50">
                <span className="font-mono tabular-nums text-gray-400 w-5 shrink-0 text-right">
                  #{seq}
                </span>
                <span
                  className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${
                    entry.event.eventType === "reveal"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : entry.event.eventType === "attempt" && entry.scoreSummary?.isAccuracySuccess
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-gray-200 bg-gray-50 text-gray-600"
                  }`}
                >
                  {label}
                </span>
                <span className="min-w-0 flex-1 truncate italic text-gray-700">{spanish}</span>
                <span
                  aria-hidden
                  className="shrink-0 text-gray-400 transition group-open:rotate-90"
                >
                  ▸
                </span>
              </summary>
              <div className="border-t border-gray-100">
                <SessionHistoryEntryDetail
                  entry={entry}
                  incorrectPhraseRecord={incorrectRecordsByPhraseId.get(entry.phrase.name)}
                  grammarItemScoreLookup={grammarItemScoreLookup}
                  wordScoreLookup={wordScoreLookup}
                />
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
};

// ─── Word mastery row component ───────────────────────────────────────────────

interface WordRowProps {
  row: WordMasteryRow;
  entries: readonly HistoryEntry[];
  incorrectRecordsByPhraseId: ReadonlyMap<string, IncorrectPhraseRecord>;
  grammarItemScoreLookup: ReadonlyMap<string, ItemScore>;
  wordScoreLookup: ReadonlyMap<string, ItemScore>;
}

const WordRow = ({
  row,
  entries,
  incorrectRecordsByPhraseId,
  grammarItemScoreLookup,
  wordScoreLookup,
}: WordRowProps): JSX.Element => {
  const band: ItemMasteryBand = row.isUntrained
    ? "weak"
    : row.mastery >= 0.8
      ? "mastered"
      : row.mastery >= 0.6
        ? "stabilizing"
        : "weak";

  const hasTrail = !row.isUntrained && row.trialsEff > 0;
  const trailEntries = useMemo(
    () => (hasTrail ? filterHistoryEntriesForWordItemTrail(normalizeStr(row.word), entries) : []),
    [hasTrail, row.word, entries],
  );

  const summary = (
    <div className="flex items-center gap-2 w-full">
      <div className="min-w-0 flex-1">
        <span className="text-sm text-gray-900">{row.displayWord}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-[10px] tabular-nums text-gray-400">
          {Math.round(row.trialsEff)} trials
        </span>
        {row.isUntrained ? (
          <span className="rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-400">
            unseen
          </span>
        ) : (
          <>
            <span className="text-sm font-semibold tabular-nums text-gray-900">
              {formatPct(row.mastery)}
            </span>
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[10px] ${BAND_BADGE_CLASS[band]}`}
            >
              {band}
            </span>
          </>
        )}
        {hasTrail && (
          <span aria-hidden className="text-gray-400 text-[10px] group-open:rotate-90 transition">▸</span>
        )}
      </div>
    </div>
  );

  if (!hasTrail) {
    return (
      <li className="rounded-lg border border-gray-100 bg-white px-3 py-2">
        {summary}
      </li>
    );
  }

  return (
    <li className="group rounded-lg border border-gray-100 bg-white">
      <details>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
          {summary}
        </summary>
        <div className="border-t border-gray-100 px-3 pb-3">
          <ItemTrailPanel
            trailEntries={trailEntries}
            incorrectRecordsByPhraseId={incorrectRecordsByPhraseId}
            grammarItemScoreLookup={grammarItemScoreLookup}
            wordScoreLookup={wordScoreLookup}
          />
        </div>
      </details>
    </li>
  );
};

// ─── Words merged ranking + by type ──────────────────────────────────────────

interface WordsRankingSectionProps {
  rows: WordMasteryRow[];
  entries: readonly HistoryEntry[];
  incorrectRecordsByPhraseId: ReadonlyMap<string, IncorrectPhraseRecord>;
  grammarItemScoreLookup: ReadonlyMap<string, ItemScore>;
  wordScoreLookup: ReadonlyMap<string, ItemScore>;
}

const WordsRankingSection = ({
  rows,
  entries,
  incorrectRecordsByPhraseId,
  grammarItemScoreLookup,
  wordScoreLookup,
}: WordsRankingSectionProps): JSX.Element => {
  const grouped = useMemo(() => groupWordsByPos(rows), [rows]);

  const trailProps = { entries, incorrectRecordsByPhraseId, grammarItemScoreLookup, wordScoreLookup };

  return (
    <section aria-label="Words by master score" className="flex flex-col gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        Words
      </h2>

      {/* Merged ranking */}
      <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
        <header className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-800">
            All words ranked
          </span>
          <span className="text-[11px] text-gray-500">
            Lowest first · {rows.length} word{rows.length === 1 ? "" : "s"}
          </span>
        </header>
        {rows.length === 0 ? (
          <p className="py-2 text-xs text-gray-400">No word data yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((row) => (
              <WordRow key={row.word} row={row} {...trailProps} />
            ))}
          </ul>
        )}
      </div>

      {/* By part of speech */}
      {PART_OF_SPEECH_VALUES.filter((pos) => grouped[pos] != null).map(
        (pos) => {
          const posRows = grouped[pos]!;
          return (
            <details
              key={pos}
              className="group rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-gray-800">
                <span>
                  {POS_LABEL[pos] ?? pos}{" "}
                  <span className="ml-1 text-xs font-normal text-gray-500">
                    ({posRows.length})
                  </span>
                </span>
                <span
                  aria-hidden
                  className="text-gray-400 transition group-open:rotate-90"
                >
                  ▸
                </span>
              </summary>
              <ul className="mt-3 flex flex-col gap-1.5">
                {posRows.map((row) => (
                  <WordRow key={row.word} row={row} {...trailProps} />
                ))}
              </ul>
            </details>
          );
        },
      )}
    </section>
  );
};

// ─── Grammar mastery section ──────────────────────────────────────────────────

interface GrammarRankingSectionProps {
  rows: GrammarMasteryRow[];
  entries: readonly HistoryEntry[];
  incorrectRecordsByPhraseId: ReadonlyMap<string, IncorrectPhraseRecord>;
  grammarItemScoreLookup: ReadonlyMap<string, ItemScore>;
  wordScoreLookup: ReadonlyMap<string, ItemScore>;
}

const GrammarRankingSection = ({
  rows,
  entries,
  incorrectRecordsByPhraseId,
  grammarItemScoreLookup,
  wordScoreLookup,
}: GrammarRankingSectionProps): JSX.Element => (
  <section
    aria-label="Grammar by master score"
    className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm"
  >
    <header className="mb-2 flex items-center justify-between">
      <h2 className="text-sm font-semibold text-gray-800">Grammar ranked</h2>
      <span className="text-[11px] text-gray-500">
        Lowest first · {rows.length} concept{rows.length === 1 ? "" : "s"}
      </span>
    </header>
    {rows.length === 0 ? (
      <p className="py-2 text-xs text-gray-400">No grammar data yet.</p>
    ) : (
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const band: ItemMasteryBand = row.isUntrained
            ? "weak"
            : row.mastery >= 0.8
              ? "mastered"
              : row.mastery >= 0.6
                ? "stabilizing"
                : "weak";

          const hasTrail = !row.isUntrained && row.trialsEff > 0;
          const trailEntries = hasTrail
            ? filterHistoryEntriesForGrammarItemTrail(row.item, entries)
            : [];

          const rowContent = (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900">{row.item}</p>
                {row.latestRationale && (
                  <p className="mt-0.5 text-[11px] italic text-gray-500">
                    {row.latestRationale}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                {row.isUntrained ? (
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-400">
                    unseen
                  </span>
                ) : (
                  <>
                    <span className="text-sm font-semibold tabular-nums text-gray-900">
                      {formatPct(row.mastery)}
                    </span>
                    <span
                      className={`rounded-full border px-1.5 py-0.5 text-[10px] ${BAND_BADGE_CLASS[band]}`}
                    >
                      {band}
                    </span>
                  </>
                )}
                <span className="text-[10px] tabular-nums text-gray-400">
                  {Math.round(row.trialsEff)} trials
                </span>
                {hasTrail && (
                  <span aria-hidden className="text-gray-400 text-[10px] group-open:rotate-90 transition">▸</span>
                )}
              </div>
            </>
          );

          if (!hasTrail) {
            return (
              <li
                key={row.item}
                className="flex items-start gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2"
              >
                {rowContent}
              </li>
            );
          }

          return (
            <li key={row.item} className="group rounded-lg border border-gray-100 bg-white">
              <details>
                <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2">
                  {rowContent}
                </summary>
                <div className="border-t border-gray-100 px-3 pb-3">
                  <ItemTrailPanel
                    trailEntries={trailEntries}
                    incorrectRecordsByPhraseId={incorrectRecordsByPhraseId}
                    grammarItemScoreLookup={grammarItemScoreLookup}
                    wordScoreLookup={wordScoreLookup}
                  />
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    )}
  </section>
);

// ─── Practice next callout ────────────────────────────────────────────────────

interface PracticeItem {
  label: string;
  sublabel: string;
  mastery: number;
  kind: "word" | "grammar";
}

// ─── Grammar focus summary ─────────────────────────────────────────────────────

const BAND_BORDER_CLASS: Record<'weak' | 'stabilizing', string> = {
  weak: 'border-red-200',
  stabilizing: 'border-amber-200',
};

const BAND_HEADER_CLASS: Record<'weak' | 'stabilizing', string> = {
  weak: 'text-red-700',
  stabilizing: 'text-amber-700',
};

const GrammarFocusSection = ({
  summaries,
}: {
  summaries: GrammarSummary[];
}): JSX.Element | null => {
  if (summaries.length === 0) return null;

  return (
    <section
      aria-label="Grammar focus"
      className="flex flex-col gap-3"
    >
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        Grammar focus
      </h2>
      <p className="text-[11px] text-gray-500 -mt-1">
        AI-generated coaching for your weakest grammar items this lesson.
      </p>
      {summaries.map((s) => (
        <div
          key={s.item}
          className={`rounded-xl border bg-white px-5 py-4 shadow-sm ${BAND_BORDER_CLASS[s.band]}`}
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <h3 className={`text-sm font-semibold ${BAND_HEADER_CLASS[s.band]}`}>
              {s.item}
            </h3>
            <span
              className={`shrink-0 text-xs font-semibold tabular-nums ${BAND_HEADER_CLASS[s.band]}`}
              title={`Mastery: ${Math.round(s.mastery * 100)}% · Band: ${s.band} · Effective trials: ${s.trialsEff.toFixed(1)}`}
            >
              {Math.round(s.mastery * 100)}%
            </span>
          </div>
          {s.status === 'success' ? (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-[11px] font-semibold text-gray-700 mb-0.5">
                  What you&apos;re finding difficult
                </p>
                <p className="text-[11px] text-gray-600 leading-relaxed">
                  {s.struggling}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-gray-700 mb-0.5">
                  What to focus on
                </p>
                <p className="text-[11px] text-gray-600 leading-relaxed">
                  {s.focus}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-gray-400 italic">
              Summary unavailable for this item.
            </p>
          )}
        </div>
      ))}
    </section>
  );
};

const PracticeNextSection = ({
  items,
}: {
  items: PracticeItem[];
}): JSX.Element | null => {
  if (items.length === 0) return null;

  return (
    <section
      aria-label="Suggested practice"
      className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4"
    >
      <h2 className="mb-3 text-sm font-semibold text-amber-900">
        Practice next
      </h2>
      <p className="mb-3 text-[11px] text-amber-700">
        Lowest-mastery items from this lesson — focus here in your next session.
      </p>
      <ol className="flex flex-col gap-2">
        {items.map((item, idx) => (
          <li key={item.label} className="flex items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-[10px] font-semibold text-amber-800">
              {idx + 1}
            </span>
            <div className="min-w-0 flex-1">
              <span className="text-sm text-amber-900">{item.label}</span>
              <span className="ml-1.5 text-[10px] text-amber-600">
                {item.sublabel}
              </span>
            </div>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-amber-800">
              {formatPct(item.mastery)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
};

// ─── Back header ──────────────────────────────────────────────────────────────

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

// ─── Root client component ────────────────────────────────────────────────────

export function LessonReportClient({
  lessonId,
  lessonTitle,
}: Props): JSX.Element {
  const { data, isLoading, isError, error } = useLessonCompletionQuery(lessonId);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const entries = useMemo(() => data?.entries ?? [], [data?.entries]);
  const grammarSummaries = useMemo(() => data?.grammarSummaries ?? [], [data?.grammarSummaries]);
  const checkpoint = data?.latestCheckpoint ?? null;
  const incorrectPhraseRecords = useMemo(
    () => checkpoint?.incorrectPhraseRecords ?? [],
    [checkpoint?.incorrectPhraseRecords],
  );
  const progress = useMemo(
    () => checkpoint?.progress ?? [],
    [checkpoint?.progress],
  );
  const wordScores = useMemo(
    () => checkpoint?.wordScores ?? {},
    [checkpoint?.wordScores],
  );
  const grammarItemScores = useMemo(
    () => checkpoint?.grammarItemScores ?? {},
    [checkpoint?.grammarItemScores],
  );

  const summary = useMemo(
    () => computeLessonReportSummary(entries),
    [entries],
  );
  const buckets = useMemo(
    () => bucketPhrasesByFailedAttemptCount(entries),
    [entries],
  );
  const masteryRows = useMemo(
    () => buildPhrasesByMasterScore(entries, progress),
    [entries, progress],
  );
  const wordRows = useMemo(
    () => buildWordsByMastery(entries, wordScores),
    [entries, wordScores],
  );
  const grammarRows = useMemo(
    () => buildGrammarItemsByMastery(entries, grammarItemScores, incorrectPhraseRecords),
    [entries, grammarItemScores, incorrectPhraseRecords],
  );

  /** Words with enough evidence to appear in report rankings (trialsEff >= threshold). */
  const reportWordRows = useMemo(
    () => wordRows.filter(isReportEligibleItem),
    [wordRows],
  );
  /** Grammar items with enough evidence to appear in report rankings. */
  const reportGrammarRows = useMemo(
    () => grammarRows.filter(isReportEligibleItem),
    [grammarRows],
  );

  const wordBandSummary = useMemo(() => summarizeItemBands(reportWordRows), [reportWordRows]);
  const grammarBandSummary = useMemo(
    () => summarizeItemBands(reportGrammarRows),
    [reportGrammarRows],
  );
  const avgByPos = useMemo(() => averageMasteryByPos(reportWordRows), [reportWordRows]);

  const practiceNextItems = useMemo((): PracticeItem[] => {
    const wordItems: PracticeItem[] = reportWordRows
      .slice(0, 5)
      .map((r) => ({
        label: r.displayWord,
        sublabel: POS_LABEL[r.type] ?? r.type,
        mastery: r.mastery,
        kind: "word" as const,
      }));
    const grammarItems: PracticeItem[] = reportGrammarRows
      .slice(0, 5)
      .map((r) => ({
        label: r.item,
        sublabel: "grammar",
        mastery: r.mastery,
        kind: "grammar" as const,
      }));

    return [...wordItems, ...grammarItems]
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, 5);
  }, [reportWordRows, reportGrammarRows]);

  const completedAtMs = useMemo(() => {
    if (entries.length === 0) return null;
    let max = 0;
    for (const entry of entries) {
      const t = entry.event.timestamp;
      if (typeof t === "number" && t > max) max = t;
    }
    return max > 0 ? max : null;
  }, [entries]);

  const { grammarItemScoreLookup, wordScoreLookup } = useMemo(
    () => buildItemScoreLookupsForHistoryDetail(incorrectPhraseRecords, wordScores, grammarItemScores),
    [incorrectPhraseRecords, wordScores, grammarItemScores],
  );

  const incorrectRecordsByPhraseId = useMemo(() => {
    const map = new Map<string, IncorrectPhraseRecord>();
    for (const r of incorrectPhraseRecords) map.set(r.phraseId, r);
    return map;
  }, [incorrectPhraseRecords]);

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

            {/* Practice next — surfaces lowest-mastery items early */}
            <PracticeNextSection items={practiceNextItems} />

            {/* AI-generated grammar coaching for the weakest items */}
            <GrammarFocusSection summaries={grammarSummaries} />

            {/* Grammar ranked — immediately after grammar focus summary */}
            <section aria-label="Grammar" className="flex flex-col gap-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Grammar
              </h2>
              <GrammarRankingSection
                rows={reportGrammarRows}
                entries={entries}
                incorrectRecordsByPhraseId={incorrectRecordsByPhraseId}
                grammarItemScoreLookup={grammarItemScoreLookup}
                wordScoreLookup={wordScoreLookup}
              />
            </section>

            {/* Mastery health snapshot */}
            <MasteryHealthSection
              wordSummary={wordBandSummary}
              grammarSummary={grammarBandSummary}
            />

            {/* POS strength bars */}
            <PosStrengthSection avgByPos={avgByPos} />

            {/* Word rankings */}
            <WordsRankingSection
              rows={reportWordRows}
              entries={entries}
              incorrectRecordsByPhraseId={incorrectRecordsByPhraseId}
              grammarItemScoreLookup={grammarItemScoreLookup}
              wordScoreLookup={wordScoreLookup}
            />

            {/* Failed attempts */}
            {buckets.once.length === 0 &&
            buckets.twice.length === 0 &&
            buckets.threePlus.length === 0 ? (
              <section
                aria-label="Failed attempts"
                className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm"
              >
                <h2 className="text-sm font-semibold text-gray-800">
                  Failed attempts
                </h2>
                <p className="mt-2 text-xs text-gray-500">
                  No phrases had a failed scored attempt in this lesson.
                </p>
              </section>
            ) : (
              <div className="flex flex-col gap-3">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Failed attempts
                </h2>
                <RevisitBucket
                  title="Phrases that failed once"
                  rows={buckets.once}
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

            {/* Phrase-level mastery */}
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
