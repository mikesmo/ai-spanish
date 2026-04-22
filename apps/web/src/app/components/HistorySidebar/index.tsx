"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeStr,
  type Attempt,
  type PracticeAttempt,
  type RevealEvent,
  type WordMeta,
} from "@ai-spanish/logic";
import type { HistoryEntry, ScoreSummary } from "../../hooks/useSessionHistory";

interface HistorySidebarProps {
  history: HistoryEntry[];
  isOpen: boolean;
  onClose: () => void;
  onClear: () => void;
}

interface SessionStats {
  totalAttempts: number;
  exactCorrect: number;
  exactCorrectPct: number | null;
  avgAccuracy: number | null;
  avgFluency: number | null;
  practiceCount: number;
  revealCount: number;
}

const computeStats = (history: HistoryEntry[]): SessionStats => {
  const attempts = history.filter(
    (h): h is HistoryEntry & { event: Attempt } =>
      h.event.eventType === "attempt",
  );
  const total = attempts.length;
  const exact = attempts.filter((h) => h.event.success).length;
  const accuracySum = attempts.reduce(
    (sum, h) => sum + h.event.accuracyScore,
    0,
  );
  const fluencyVals = attempts
    .map((h) => h.event.fluencyScore)
    .filter((v): v is number => v != null);
  return {
    totalAttempts: total,
    exactCorrect: exact,
    exactCorrectPct: total > 0 ? exact / total : null,
    avgAccuracy: total > 0 ? accuracySum / total : null,
    avgFluency:
      fluencyVals.length > 0
        ? fluencyVals.reduce((s, v) => s + v, 0) / fluencyVals.length
        : null,
    practiceCount: history.filter((h) => h.event.eventType === "practice")
      .length,
    revealCount: history.filter((h) => h.event.eventType === "reveal").length,
  };
};

const formatPct = (n: number | null): string =>
  n == null ? "—" : `${Math.round(n * 100)}%`;

const formatTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

type ResultBadge = { label: string; className: string; title: string };

const getResultBadge = (entry: HistoryEntry): ResultBadge | null => {
  if (entry.event.eventType === "reveal") {
    return {
      label: "shown",
      className: "bg-red-100 text-red-700 border-red-200",
      title: "User tapped Show Answer — penalty applied",
    };
  }
  if (entry.event.eventType === "practice") {
    return {
      label: "retry",
      className: "bg-gray-100 text-gray-600 border-gray-200",
      title: "Try Again repetition — not scored, does not affect mastery",
    };
  }
  const { success, isAccuracySuccess } = entry.event;
  if (success) {
    return {
      label: "exact",
      className: "bg-emerald-100 text-emerald-700 border-emerald-200",
      title: "Exact string match",
    };
  }
  if (isAccuracySuccess) {
    return {
      label: "close",
      className: "bg-amber-100 text-amber-700 border-amber-200",
      title: "Accuracy passed threshold but not an exact match",
    };
  }
  return {
    label: "miss",
    className: "bg-red-100 text-red-700 border-red-200",
    title: "Accuracy below threshold",
  };
};

interface WordAlignmentRow {
  word: string;
  type: string;
  weight: number;
  status: "matched" | "missing";
}

const buildAlignmentRows = (
  words: WordMeta[],
  missingWords: string[],
): WordAlignmentRow[] => {
  const missingSet = new Set(missingWords.map((w) => normalizeStr(w)));
  return words.map((w) => ({
    word: w.word,
    type: w.type,
    weight: w.weight,
    status: missingSet.has(normalizeStr(w.word)) ? "missing" : "matched",
  }));
};

interface AttemptDetailProps {
  entry: HistoryEntry & { event: Attempt; scoreSummary: ScoreSummary };
}

const AttemptDetail = ({ entry }: AttemptDetailProps): JSX.Element => {
  const { event, phrase, scoreSummary } = entry;
  const rows = useMemo(
    () => buildAlignmentRows(phrase.Spanish.words, event.missingWords),
    [phrase, event.missingWords],
  );

  const totalWeight = rows.reduce((s, r) => s + r.weight, 0);
  const missingPenalty = rows
    .filter((r) => r.status === "missing")
    .reduce((s, r) => s + r.weight, 0);
  const extraCount = event.extraWords.length;
  const rawExtraPenalty = 0.7 * extraCount;
  const extraPenalty = Math.min(1.0, rawExtraPenalty);

  const hasFluency = scoreSummary.fluency != null;
  const masteryFormula = hasFluency
    ? "0.5 × accuracy + 0.3 × fluency + 0.2 × stability(0)"
    : "0.6 × accuracy + 0.4 × stability(0)";

  return (
    <div className="bg-gray-50 border-t border-gray-200 px-3 py-3 space-y-4 text-[11px]">
      <div>
        <div className="font-semibold text-gray-700 mb-1">Target phrase</div>
        <div className="text-gray-900 italic">{phrase.Spanish.answer}</div>
      </div>

      <div>
        <div className="font-semibold text-gray-700 mb-1">Transcript</div>
        <div className="text-gray-900">
          {event.transcript.length > 0 ? event.transcript.join(" ") : "—"}
        </div>
      </div>

      <div>
        <div className="font-semibold text-gray-700 mb-1">Word alignment</div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="py-1 pr-2 font-medium">Word</th>
              <th className="py-1 pr-2 font-medium">POS</th>
              <th className="py-1 pr-2 font-medium">Weight</th>
              <th className="py-1 pr-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.word}-${i}`} className="border-b border-gray-100">
                <td
                  className={`py-1 pr-2 font-mono ${
                    r.status === "missing"
                      ? "text-red-600 line-through"
                      : "text-gray-900"
                  }`}
                >
                  {r.word}
                </td>
                <td className="py-1 pr-2 text-gray-600">{r.type}</td>
                <td className="py-1 pr-2 text-gray-600">
                  {r.weight.toFixed(1)}
                </td>
                <td
                  className={`py-1 pr-2 ${
                    r.status === "missing"
                      ? "text-red-600"
                      : "text-emerald-600"
                  }`}
                >
                  {r.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {extraCount > 0 && (
        <div>
          <div className="font-semibold text-gray-700 mb-1">
            Extra words ({extraCount})
          </div>
          <div className="text-gray-900 font-mono">
            {event.extraWords.join(", ")}
          </div>
        </div>
      )}

      <div>
        <div className="font-semibold text-gray-700 mb-1">
          Accuracy breakdown
        </div>
        <div className="text-gray-700 font-mono space-y-0.5">
          <div>
            accuracy = 1 − (missingPenalty + extraPenalty) / totalWeight
          </div>
          <div className="pl-4">
            missingPenalty = {missingPenalty.toFixed(2)}
          </div>
          <div className="pl-4">
            extraPenalty = min(1.0, 0.7 × {extraCount}) ={" "}
            {extraPenalty.toFixed(2)}
          </div>
          <div className="pl-4">totalWeight = {totalWeight.toFixed(2)}</div>
          <div className="pt-1 text-gray-900">
            = {formatPct(scoreSummary.accuracy)}{" "}
            {event.isAccuracySuccess ? (
              <span className="text-emerald-600">(≥ 85% threshold)</span>
            ) : (
              <span className="text-red-600">(&lt; 85% threshold)</span>
            )}
          </div>
        </div>
      </div>

      <div>
        <div className="font-semibold text-gray-700 mb-1">Fluency</div>
        <div className="text-gray-700">
          {scoreSummary.fluency == null
            ? "null (no word-level timings from STT adapter)"
            : `${formatPct(scoreSummary.fluency)} — from speed, long pauses, gap variance`}
        </div>
      </div>

      <div>
        <div className="font-semibold text-gray-700 mb-1">Mastery preview</div>
        <div className="text-gray-700 font-mono">{masteryFormula}</div>
        <div className="text-gray-900 pt-0.5">
          = {formatPct(scoreSummary.mastery)}
        </div>
      </div>
    </div>
  );
};

interface RowProps {
  index: number;
  entry: HistoryEntry;
}

const HistoryRow = ({ index, entry }: RowProps): JSX.Element => {
  const [expanded, setExpanded] = useState(false);
  const { event, phrase, scoreSummary } = entry;
  const badge = getResultBadge(entry);

  const userSaid =
    event.eventType === "reveal"
      ? "—"
      : (event as Attempt | PracticeAttempt).transcript.join(" ") || "—";

  const canExpand =
    event.eventType === "attempt" && scoreSummary != null;

  // Try Again / practice events never update stored mastery, stability, or
  // SRS — render them visibly muted so the informational accuracy/mastery
  // values on these rows read as "not part of scored history".
  const isPractice = event.eventType === "practice";
  const primaryTextClass = isPractice ? "text-gray-500" : "text-gray-900";
  const rowBgClass = isPractice
    ? "bg-gray-100"
    : canExpand
      ? "cursor-pointer hover:bg-gray-50"
      : "";
  const rowTitle = isPractice
    ? "Practice only — not scored, does not update mastery"
    : undefined;

  return (
    <>
      <tr
        className={`border-b border-gray-100 ${rowBgClass}`}
        title={rowTitle}
        onClick={() => canExpand && setExpanded((v) => !v)}
      >
        <td className="py-2 pl-3 pr-1 text-gray-400 tabular-nums align-top">
          {index}
        </td>
        <td className="py-2 px-1 align-top">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-400">
              {formatTime(event.timestamp)}
            </span>
            {badge && (
              <span
                title={badge.title}
                className={`inline-block w-fit text-[10px] px-1.5 py-0.5 rounded border ${badge.className}`}
              >
                {badge.label}
              </span>
            )}
          </div>
        </td>
        <td className={`py-2 px-1 align-top max-w-[140px] ${primaryTextClass}`}>
          <div className="truncate" title={phrase.English.question}>
            {phrase.English.question}
          </div>
          <div
            className="text-[10px] text-gray-500 truncate font-mono"
            title={userSaid}
          >
            {userSaid}
          </div>
        </td>
        <td className={`py-2 px-1 text-right tabular-nums align-top ${primaryTextClass}`}>
          {formatPct(scoreSummary?.accuracy ?? null)}
        </td>
        <td className={`py-2 px-1 text-right tabular-nums align-top ${primaryTextClass}`}>
          {formatPct(scoreSummary?.fluency ?? null)}
        </td>
        <td className={`py-2 px-1 text-right tabular-nums align-top ${primaryTextClass}`}>
          {formatPct(scoreSummary?.mastery ?? null)}
        </td>
        <td className="py-2 pl-1 pr-3 text-right align-top text-gray-400">
          {canExpand && (
            <span className="inline-block w-3 text-center">
              {expanded ? "▾" : "▸"}
            </span>
          )}
        </td>
      </tr>
      {expanded && canExpand && (
        <tr>
          <td colSpan={7} className="p-0">
            <AttemptDetail
              entry={
                entry as HistoryEntry & {
                  event: Attempt;
                  scoreSummary: ScoreSummary;
                }
              }
            />
          </td>
        </tr>
      )}
    </>
  );
};

interface LegendItem {
  term: string;
  description: string;
}

const EVENT_LEGEND: LegendItem[] = [
  {
    term: "attempt",
    description:
      "First time you speak a phrase. Scored on accuracy + fluency and feeds the mastery engine.",
  },
  {
    term: "retry",
    description:
      "You pressed Try Again. Pure motor/pronunciation repetition — not scored and never changes mastery or the review schedule. Retry rows are grayed out to signal they're excluded from the mastery calculation.",
  },
  {
    term: "reveal",
    description:
      "You tapped Show Answer before a scored attempt. Strong failure signal: decays mastery (×0.6) and stability (×0.7).",
  },
  {
    term: "exact",
    description:
      "Your transcript matched the target Spanish string exactly (after normalization). Triggers the success chime.",
  },
  {
    term: "close",
    description:
      "Weighted accuracy ≥ 85% but not an exact match — still counts as a learning success for the mastery engine.",
  },
  {
    term: "miss",
    description:
      "Weighted accuracy below the 85% learning-success threshold.",
  },
];

const METRIC_LEGEND: LegendItem[] = [
  {
    term: "Accuracy",
    description:
      "Part-of-speech weighted match against the target phrase. Missing a verb (weight 3.0) hurts far more than missing an article (0.5). Formula: 1 − (missingPenalty + extraPenalty) / totalWeight.",
  },
  {
    term: "Fluency",
    description:
      "Derived from word-level timings: speaking speed, long pauses, and gap consistency. Null on platforms without word timestamps (currently mobile).",
  },
  {
    term: "Mastery",
    description:
      "Blended score: 0.5×accuracy + 0.3×fluency + 0.2×stability (or 0.6×accuracy + 0.4×stability when fluency is null). Stability is shown as 0 in this preview — the real engine updates it via an EMA across sessions.",
  },
];

const Legend = (): JSX.Element => (
  <div className="border-t border-gray-200 bg-gray-50 px-4 py-4 space-y-4">
    <div>
      <h3 className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide mb-2">
        About mastery
      </h3>
      <p className="text-[11px] leading-relaxed text-gray-600">
        The mastery score is the system&apos;s best guess at how well you
        know a phrase — not just did you say it right once, but can you
        produce it accurately and fluently, repeatedly, across time. It
        combines what you said (accuracy), how smoothly you said it
        (fluency), and how consistently you get it right (stability).
        Phrases graduate through{" "}
        <span className="font-mono">learning</span> →{" "}
        <span className="font-mono">stabilizing</span> →{" "}
        <span className="font-mono">mastered</span> bands, and the spaced-
        repetition scheduler uses that band to decide when to show them to
        you again.
      </p>
    </div>

    <div>
      <h3 className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide mb-2">
        Metrics
      </h3>
      <dl className="space-y-2 text-[11px] leading-relaxed">
        {METRIC_LEGEND.map((item) => (
          <div key={item.term}>
            <dt className="font-semibold text-gray-800">{item.term}</dt>
            <dd className="text-gray-600">{item.description}</dd>
          </div>
        ))}
      </dl>
    </div>

    <div>
      <h3 className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide mb-2">
        Event types
      </h3>
      <dl className="space-y-2 text-[11px] leading-relaxed">
        {EVENT_LEGEND.map((item) => (
          <div key={item.term}>
            <dt className="font-mono font-semibold text-gray-800">
              {item.term}
            </dt>
            <dd className="text-gray-600">{item.description}</dd>
          </div>
        ))}
      </dl>
    </div>
  </div>
);

const StatCard = ({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element => (
  <div className="flex flex-col min-w-0">
    <span className="text-[10px] uppercase tracking-wide text-gray-400">
      {label}
    </span>
    <span className="text-sm font-semibold text-gray-100 tabular-nums">
      {value}
    </span>
  </div>
);

const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 480;
const STORAGE_KEY = "history-sidebar-width";

const getInitialWidth = (): number => {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  const parsed = stored ? Number.parseInt(stored, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= MIN_WIDTH) return parsed;
  return DEFAULT_WIDTH;
};

const clampWidth = (width: number): number => {
  if (typeof window === "undefined") return Math.max(MIN_WIDTH, width);
  const max = Math.max(MIN_WIDTH, window.innerWidth - 40);
  return Math.min(max, Math.max(MIN_WIDTH, width));
};

export const HistorySidebar = ({
  history,
  isOpen,
  onClose,
  onClear,
}: HistorySidebarProps): JSX.Element => {
  const stats = useMemo(() => computeStats(history), [history]);
  const reversed = useMemo(() => [...history].reverse(), [history]);

  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const resizingRef = useRef(false);

  useEffect(() => {
    setWidth(getInitialWidth());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  // Reserve room on the right of <body> when the panel is open so the main
  // content re-centers in the remaining viewport instead of hiding behind the
  // panel. Restores on close / unmount.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const body = document.body;
    const prev = body.style.paddingRight;
    const prevTransition = body.style.transition;
    if (!isResizing) {
      body.style.transition = "padding-right 300ms ease-out";
    } else {
      body.style.transition = "none";
    }
    body.style.paddingRight = isOpen ? `${width}px` : "0px";
    return () => {
      body.style.paddingRight = prev;
      body.style.transition = prevTransition;
    };
  }, [isOpen, width, isResizing]);

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!resizingRef.current) return;
      setWidth(clampWidth(window.innerWidth - e.clientX));
    };
    const onUp = (): void => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      setIsResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startResize = useCallback((e: React.MouseEvent): void => {
    e.preventDefault();
    resizingRef.current = true;
    setIsResizing(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, []);

  const onResizeKey = useCallback((e: React.KeyboardEvent): void => {
    const step = e.shiftKey ? 40 : 16;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setWidth((w) => clampWidth(w + step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setWidth((w) => clampWidth(w - step));
    }
  }, []);

  return (
    <>
      <aside
        role="dialog"
        aria-label="Session history"
        aria-hidden={!isOpen}
        style={isOpen ? { width: `${width}px` } : undefined}
        className={`fixed top-0 right-0 z-50 h-[100dvh] bg-white shadow-2xl flex flex-col transform ${
          isResizing
            ? ""
            : "transition-transform duration-300 ease-out"
        } ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize history sidebar"
          aria-valuenow={width}
          aria-valuemin={MIN_WIDTH}
          tabIndex={0}
          onMouseDown={startResize}
          onKeyDown={onResizeKey}
          className={`absolute top-0 left-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize group z-10 ${
            isResizing ? "bg-primary/40" : "hover:bg-primary/20"
          }`}
        >
          <div
            className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-10 rounded-full transition-colors ${
              isResizing
                ? "bg-primary"
                : "bg-gray-300 group-hover:bg-primary/70"
            }`}
          />
        </div>
        <header className="bg-gray-900 text-white px-4 py-3 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold tracking-wide">
                Session history
              </h2>
              <span className="text-[10px] text-gray-400">
                {history.length} event{history.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClear}
                disabled={history.length === 0}
                className="text-[11px] text-gray-300 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close history"
                className="text-gray-300 hover:text-white text-lg leading-none w-6 h-6 flex items-center justify-center"
              >
                ×
              </button>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label="Attempts"
              value={String(stats.totalAttempts)}
            />
            <StatCard
              label="Exact"
              value={
                stats.exactCorrectPct == null
                  ? "—"
                  : `${stats.exactCorrect}/${stats.totalAttempts}`
              }
            />
            <StatCard label="Avg acc" value={formatPct(stats.avgAccuracy)} />
            <StatCard label="Avg flu" value={formatPct(stats.avgFluency)} />
          </div>
          {(stats.practiceCount > 0 || stats.revealCount > 0) && (
            <div className="mt-2 text-[10px] text-gray-400">
              {stats.practiceCount} retry · {stats.revealCount} reveal
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto">
          {history.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-500">
              No events yet. Attempts, practice repeats, and reveals will
              appear here as you progress through the lesson.
            </div>
          ) : (
            <table className="w-full text-[11px] border-collapse">
              <thead className="sticky top-0 bg-white shadow-[0_1px_0_0_#e5e7eb]">
                <tr className="text-left text-gray-500">
                  <th className="py-2 pl-3 pr-1 font-medium">#</th>
                  <th className="py-2 px-1 font-medium">Event</th>
                  <th className="py-2 px-1 font-medium">Question / said</th>
                  <th className="py-2 px-1 font-medium text-right">Acc</th>
                  <th className="py-2 px-1 font-medium text-right">Flu</th>
                  <th className="py-2 px-1 font-medium text-right">Mast</th>
                  <th className="py-2 pl-1 pr-3" aria-label="expand" />
                </tr>
              </thead>
              <tbody>
                {reversed.map((entry, i) => (
                  <HistoryRow
                    key={entry.id}
                    index={history.length - i}
                    entry={entry}
                  />
                ))}
              </tbody>
            </table>
          )}
          <Legend />
        </div>
      </aside>
    </>
  );
};

interface HistoryToggleProps {
  count: number;
  onClick: () => void;
}

export const HistoryToggle = ({
  count,
  onClick,
}: HistoryToggleProps): JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    aria-label="Open session history"
    className="fixed top-4 right-4 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-900 text-white text-xs font-medium shadow hover:bg-gray-800"
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3v18h18" />
      <path d="M7 15l4-4 3 3 5-6" />
    </svg>
    History
    {count > 0 && (
      <span className="ml-1 bg-primary text-white rounded-full text-[10px] px-1.5 py-0.5 tabular-nums">
        {count}
      </span>
    )}
  </button>
);
