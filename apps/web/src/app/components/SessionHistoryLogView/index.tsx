"use client";

import React, { useMemo, useState } from "react";
import {
  ACCURACY_SUCCESS_THRESHOLD,
  EXTRA_PENALTY_CAP,
  EXTRA_WORD_PENALTY,
  FLUENCY_GAP_WEIGHT,
  FLUENCY_LONG_PAUSE_SEC,
  FLUENCY_PAUSE_DECAY,
  FLUENCY_PAUSE_WEIGHT,
  FLUENCY_SPEED_WEIGHT,
  FLUENCY_TARGET_WPS_HIGH,
  FLUENCY_TARGET_WPS_LOW,
  FLUENCY_WPS_CEIL,
  FLUENCY_WPS_FLOOR,
  MASTERY_STABILIZING_CEIL,
  MASTERY_W_ACCURACY,
  MASTERY_W_ACCURACY_NO_FLUENCY,
  MASTERY_W_FLUENCY,
  MASTERY_W_STABILITY,
  MASTERY_W_STABILITY_NO_FLUENCY,
  MAX_REINSERTS_PER_PHRASE_PER_SESSION,
  REVEAL_MASTERY_DECAY,
  REVEAL_STABILITY_DECAY,
  STABILITY_EMA_ALPHA,
  alignWords,
  fluencyForMastery,
  normalizeStr,
  type AccuracyBreakdown,
  type Attempt,
  type FluencyBreakdown,
  type HistoryEntry,
  type PracticeAttempt,
  type ScoreSummary,
  type StabilityBreakdownSnapshot,
  type WordMeta,
} from "@ai-spanish/logic";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface SessionStats {
  totalAttempts: number;
  exactCorrect: number;
  exactCorrectPct: number | null;
  avgAccuracy: number | null;
  avgFluency: number | null;
  practiceCount: number;
  revealCount: number;
  revisitAttemptCount: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export const computeStats = (history: HistoryEntry[]): SessionStats => {
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
    revisitAttemptCount: attempts.filter((h) => h.isRepeatedPresentation)
      .length,
  };
};

export const formatPct = (n: number | null): string =>
  n == null ? "—" : `${Math.round(n * 100)}%`;

const formatTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const formatSrsSessionLabel = (
  dueOnLessonSessionIndex: number,
  completedLessonCount: number,
): string => {
  const delta = dueOnLessonSessionIndex - completedLessonCount;
  if (delta <= 0) return "due now";
  if (delta === 1) return "next lesson";
  return `in ${delta} lessons`;
};

const formatSrsSessionTitle = (dueOnLessonSessionIndex: number): string =>
  `SRS: phrase eligible when completed-lesson count ≥ ${dueOnLessonSessionIndex}`;

const formatSlotsAhead = (slots: number | null): string => {
  if (slots == null) return "—";
  const cards = slots + 1;
  return cards === 1 ? "next card" : `in ${cards} cards`;
};

type ResultBadge = { label: string; className: string; title: string };

const getResultBadge = (entry: HistoryEntry): ResultBadge | null => {
  if (entry.event.eventType === "reveal") {
    return {
      label: "reveal",
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

const fmt = (n: number, digits = 3): string => n.toFixed(digits);

const SESSION_GRADUATION_PCT = Math.round(MASTERY_STABILIZING_CEIL * 100);

// ---------------------------------------------------------------------------
// Sub-components (detail panels + legend)
// ---------------------------------------------------------------------------

const SessionRequeueHint = ({
  masteryAfter,
  sessionRequeueApplies,
}: {
  masteryAfter: number;
  sessionRequeueApplies: boolean;
}): JSX.Element => {
  if (!sessionRequeueApplies) {
    return (
      <p className="text-[10px] text-gray-600 normal-case leading-relaxed pt-2 border-t border-gray-200 mt-2">
        Try Again does not change stored mastery or the session queue. The value
        above is the phrase&apos;s stored mastery after prior events;
        in-session requeue is driven by scored attempts and reveals, using
        post-event mastery vs {SESSION_GRADUATION_PCT}% (and a per-phrase
        reinsert cap).
      </p>
    );
  }
  if (masteryAfter >= MASTERY_STABILIZING_CEIL) {
    return (
      <p className="text-[10px] text-emerald-800 normal-case leading-relaxed pt-2 border-t border-gray-200 mt-2">
        At or above session graduation mastery ({SESSION_GRADUATION_PCT}% /{" "}
        {fmt(MASTERY_STABILIZING_CEIL, 2)}): the session engine will not
        reinsert this phrase for mastery reasons (it may leave the current
        lesson queue).
      </p>
    );
  }
  return (
    <p className="text-[10px] text-red-700 normal-case leading-relaxed pt-2 border-t border-gray-200 mt-2">
      Below session graduation mastery ({SESSION_GRADUATION_PCT}% /{" "}
      {fmt(MASTERY_STABILIZING_CEIL, 2)}): this phrase is{" "}
      <strong>eligible</strong> for in-session requeue (slot depth depends on
      mastery/stability). At most {MAX_REINSERTS_PER_PHRASE_PER_SESSION}{" "}
      reinserts per phrase per session — after that, another appearance is not
      guaranteed even if mastery stays below {SESSION_GRADUATION_PCT}%.
    </p>
  );
};

const AccuracyBreakdownSection = ({
  ab,
  isAccuracySuccess,
}: {
  ab: AccuracyBreakdown;
  isAccuracySuccess: boolean;
}): JSX.Element => {
  const extraWordCount =
    EXTRA_WORD_PENALTY > 0
      ? Math.round(ab.rawExtraPenalty / EXTRA_WORD_PENALTY)
      : 0;
  const thrPct = Math.round(ACCURACY_SUCCESS_THRESHOLD * 100);
  return (
    <div>
      <div className="font-semibold text-gray-700 mb-1">Accuracy breakdown</div>
      <div className="text-gray-700 font-mono space-y-0.5">
        <div>
          accuracy = clamp(1 − (missingPenalty + extraPenalty_capped) /
          totalWeight)
        </div>
        <div className="pl-4">totalWeight = {fmt(ab.totalWeight, 2)}</div>
        <div className="pl-4">missingPenalty = {fmt(ab.missingPenalty, 2)}</div>
        <div className="pl-4">
          rawExtraPenalty = {EXTRA_WORD_PENALTY} × {extraWordCount} ={" "}
          {fmt(ab.rawExtraPenalty, 2)}
        </div>
        <div className="pl-4">
          extraPenalty = min({EXTRA_PENALTY_CAP}, rawExtraPenalty) ={" "}
          {fmt(ab.extraPenalty, 2)}
        </div>
        <div className="pl-4 text-gray-600 text-[10px] leading-snug normal-case">
          Each extra token costs {EXTRA_WORD_PENALTY}; sum is capped at{" "}
          {EXTRA_PENALTY_CAP} so noise cannot wipe accuracy.
        </div>
        <div className="pt-1 text-gray-900 normal-case">
          → {fmt(ab.accuracy, 3)} ({formatPct(ab.accuracy)}){" "}
          {isAccuracySuccess ? (
            <span className="text-emerald-600">
              (≥ {thrPct}% weighted accuracy success)
            </span>
          ) : (
            <span className="text-red-600">
              (&lt; {thrPct}% weighted accuracy success)
            </span>
          )}
        </div>
        <p className="text-[10px] text-gray-600 normal-case leading-relaxed pt-2">
          This line is the{" "}
          <span className="font-semibold">accuracy success</span> gate (
          <span className="font-mono">ACCURACY_SUCCESS_THRESHOLD</span>,{" "}
          {thrPct}%), not session graduation mastery ({SESSION_GRADUATION_PCT}
          %). Passing sets <span className="font-mono">isAccuracySuccess</span>{" "}
          and the stability EMA input{" "}
          <span className="font-mono">x = 1</span>; failing sets{" "}
          <span className="font-mono">x = 0</span>. Independent of the
          exact-match badge and independent of the {SESSION_GRADUATION_PCT}%
          mastery threshold for leaving this lesson&apos;s queue.
        </p>
      </div>
    </div>
  );
};

const FluencyBreakdownSection = ({
  fluencyScore,
  fb,
}: {
  fluencyScore: number | null;
  fb: FluencyBreakdown | null;
}): JSX.Element => (
  <div>
    <div className="font-semibold text-gray-700 mb-1">Fluency breakdown</div>
    {fb == null || fluencyScore == null ? (
      <div className="text-gray-700">
        null — requires ≥2 words with finite start/end timestamps from the STT
        adapter.
      </div>
    ) : (
      <div className="text-gray-700 space-y-1">
        <div className="font-mono space-y-0.5">
          <div>wordsPerSecond = {fmt(fb.wordsPerSecond, 3)}</div>
          <div>longPauses (&gt; {FLUENCY_LONG_PAUSE_SEC}s between words) = {fb.longPauses}</div>
          <div>speedScore = {fmt(fb.speedScore, 3)}</div>
          <div className="text-[10px] text-gray-600 leading-snug">
            Triangular score on wps: 1 inside [{FLUENCY_TARGET_WPS_LOW},{" "}
            {FLUENCY_TARGET_WPS_HIGH}], 0 outside [{FLUENCY_WPS_FLOOR},{" "}
            {FLUENCY_WPS_CEIL}], linear ramps between.
          </div>
          <div>pauseScore = clamp(1 − {FLUENCY_PAUSE_DECAY} × longPauses) = {fmt(fb.pauseScore, 3)}</div>
          <div>gapConsistencyScore = 1 / (1 + variance(gaps)) = {fmt(fb.gapConsistencyScore, 3)}</div>
          <div>
            fluencyScore = clamp({FLUENCY_SPEED_WEIGHT}×speed +{" "}
            {FLUENCY_PAUSE_WEIGHT}×pause + {FLUENCY_GAP_WEIGHT}×gapConsistency) ={" "}
            {fmt(fb.fluencyScore, 3)}
          </div>
        </div>
        <div className="text-gray-900 normal-case pt-0.5">
          Composite ({formatPct(fluencyScore)})
        </div>
      </div>
    )}
  </div>
);

const StabilityBreakdownSection = ({
  snap,
}: {
  snap: StabilityBreakdownSnapshot;
}): JSX.Element => (
  <div>
    <div className="font-semibold text-gray-700 mb-1">Stability breakdown</div>
    <div className="text-gray-700 space-y-1 font-mono">
      {snap.kind === "attempt_ema" && (
        <>
          <div>
            S′ = clamp((1 − α)·S + α·x), α = {STABILITY_EMA_ALPHA}
          </div>
          <div className="pl-2">
            S = {fmt(snap.before, 3)}, x = {snap.emaInput} (1 if weighted
            accuracy ≥ accuracy success threshold — same gate as the Acc panel
            — else 0)
          </div>
          <div className="pl-2">S′ = {fmt(snap.after, 3)}</div>
        </>
      )}
      {snap.kind === "reveal_decay" && (
        <>
          <div>S′ = clamp(S × {REVEAL_STABILITY_DECAY})</div>
          <div className="pl-2">
            S = {fmt(snap.before, 3)} → S′ = {fmt(snap.after, 3)}
          </div>
        </>
      )}
      {snap.kind === "practice_unchanged" && (
        <div>
          Unchanged — practice events do not update progress. S stays{" "}
          {fmt(snap.after, 3)}.
        </div>
      )}
    </div>
  </div>
);

const MasteryEngineSection = ({
  accuracy,
  fluencyRecorded,
  fluencyMastery,
  stabilityAfter,
  masteryAfter,
  sessionRequeueApplies,
}: {
  accuracy: number;
  fluencyRecorded: number | null;
  fluencyMastery: number | null;
  stabilityAfter: number;
  masteryAfter: number;
  sessionRequeueApplies: boolean;
}): JSX.Element => {
  const hasFluencyMastery = fluencyMastery != null;
  const blended = hasFluencyMastery
    ? MASTERY_W_ACCURACY * accuracy +
      MASTERY_W_FLUENCY * (fluencyMastery ?? 0) +
      MASTERY_W_STABILITY * stabilityAfter
    : MASTERY_W_ACCURACY_NO_FLUENCY * accuracy +
      MASTERY_W_STABILITY_NO_FLUENCY * stabilityAfter;
  const imputedFluency =
    fluencyRecorded == null && fluencyMastery != null;
  return (
    <div>
      <div className="font-semibold text-gray-700 mb-1">
        Mastery (engine, post-event)
      </div>
      <div className="text-gray-700 font-mono space-y-0.5">
        {hasFluencyMastery ? (
          <>
            <div>
              mastery = clamp({MASTERY_W_ACCURACY}×accuracy +{" "}
              {MASTERY_W_FLUENCY}×fluency + {MASTERY_W_STABILITY}×S′)
            </div>
            <div className="pl-2">
              = {MASTERY_W_ACCURACY}×{fmt(accuracy, 3)} + {MASTERY_W_FLUENCY}×
              {fmt(fluencyMastery ?? 0, 3)} + {MASTERY_W_STABILITY}×
              {fmt(stabilityAfter, 3)} ≈ {fmt(blended, 3)}
            </div>
            {imputedFluency && (
              <div className="pl-2 text-gray-500 normal-case text-[10px] pt-0.5">
                Measured fluency was not recorded; mastery used the with-fluency
                path with imputed fluency = {fmt(fluencyMastery ?? 0, 3)} (single
                STT word).
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              mastery = clamp({MASTERY_W_ACCURACY_NO_FLUENCY}×accuracy +{" "}
              {MASTERY_W_STABILITY_NO_FLUENCY}×S′)
            </div>
            <div className="pl-2">
              = {MASTERY_W_ACCURACY_NO_FLUENCY}×{fmt(accuracy, 3)} +{" "}
              {MASTERY_W_STABILITY_NO_FLUENCY}×{fmt(stabilityAfter, 3)} ≈{" "}
              {fmt(blended, 3)}
            </div>
          </>
        )}
        <div className="text-gray-900 normal-case pt-1">
          Stored mastery = {fmt(masteryAfter, 3)} ({formatPct(masteryAfter)})
        </div>
        <SessionRequeueHint
          masteryAfter={masteryAfter}
          sessionRequeueApplies={sessionRequeueApplies}
        />
      </div>
    </div>
  );
};

type ScoredEntry = HistoryEntry & {
  event: Attempt | PracticeAttempt;
  scoreSummary: ScoreSummary;
};

const ScoredEventDetail = ({
  entry,
  isPractice,
}: {
  entry: ScoredEntry;
  isPractice: boolean;
}): JSX.Element => {
  const { event, phrase, scoreSummary, stabilityBreakdown } = entry;
  const ab = event.accuracyBreakdown;
  const fb = event.fluencyBreakdown;
  const wordCountForMasteryImputation =
    event.eventType === "attempt"
      ? (event.spokenWordCount ?? 0)
      : event.transcript.length;

  const { rows, extraWordsDisplay } = useMemo(() => {
    if (event.eventType === "attempt") {
      return {
        rows: buildAlignmentRows(phrase.Spanish.words, event.missingWords),
        extraWordsDisplay: event.extraWords,
      };
    }
    const spokenStub = event.transcript.map((w) => ({
      word: w,
      start: 0,
      end: 0,
    }));
    const alignment = alignWords(phrase.Spanish.words, spokenStub);
    const missingWords = alignment.missing.map((w) => w.word);
    return {
      rows: buildAlignmentRows(phrase.Spanish.words, missingWords),
      extraWordsDisplay: alignment.extra.map((w) => w.word),
    };
  }, [event, phrase.Spanish.words]);

  return (
    <div className="bg-gray-50 border-t border-gray-200 px-3 py-3 space-y-4 text-[11px]">
      {isPractice && (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900 text-[10px]">
          Try Again — informational only; this row does not change stored
          mastery, stability, or SRS.
        </div>
      )}

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

      {extraWordsDisplay.length > 0 && (
        <div>
          <div className="font-semibold text-gray-700 mb-1">
            Extra words ({extraWordsDisplay.length})
          </div>
          <div className="text-gray-900 font-mono">
            {extraWordsDisplay.join(", ")}
          </div>
        </div>
      )}

      <AccuracyBreakdownSection
        ab={ab}
        isAccuracySuccess={scoreSummary.isAccuracySuccess}
      />
      <FluencyBreakdownSection fluencyScore={scoreSummary.fluency} fb={fb} />
      <StabilityBreakdownSection snap={stabilityBreakdown} />
      <MasteryEngineSection
        accuracy={scoreSummary.accuracy}
        fluencyRecorded={event.fluencyScore}
        fluencyMastery={fluencyForMastery(
          event.fluencyScore,
          wordCountForMasteryImputation,
        )}
        stabilityAfter={stabilityBreakdown.after}
        masteryAfter={scoreSummary.mastery}
        sessionRequeueApplies={!isPractice}
      />
    </div>
  );
};

const RevealEventDetail = ({ entry }: { entry: HistoryEntry }): JSX.Element => {
  const { phrase, stabilityBreakdown, masteryBefore, masteryAfter } = entry;
  const blendedM = masteryBefore * REVEAL_MASTERY_DECAY;
  return (
    <div className="bg-gray-50 border-t border-gray-200 px-3 py-3 space-y-4 text-[11px]">
      <div>
        <div className="font-semibold text-gray-700 mb-1">Target phrase</div>
        <div className="text-gray-900 italic">{phrase.Spanish.answer}</div>
      </div>
      <div className="rounded border border-red-100 bg-red-50/80 px-2 py-1.5 text-red-900 text-[10px]">
        Show Answer — applies reveal decay in the reducer; phrase state becomes
        learning.
      </div>
      <StabilityBreakdownSection snap={stabilityBreakdown} />
      <div>
        <div className="font-semibold text-gray-700 mb-1">Mastery decay</div>
        <div className="text-gray-700 font-mono space-y-0.5">
          <div>M′ = clamp(M × {REVEAL_MASTERY_DECAY})</div>
          <div className="pl-2">
            M = {fmt(masteryBefore, 3)} → ≈ {fmt(blendedM, 3)}
          </div>
          <div className="text-gray-900 normal-case pt-1">
            Stored mastery = {fmt(masteryAfter, 3)} ({formatPct(masteryAfter)})
          </div>
        </div>
      </div>
      <SessionRequeueHint
        masteryAfter={masteryAfter}
        sessionRequeueApplies={true}
      />
    </div>
  );
};

interface RowProps {
  index: number;
  entry: HistoryEntry;
  liveSlotsAhead: number | null;
  completedLessonCount: number;
  /**
   * True when this is the most recent history entry for this phrase in the
   * current session. When false, `session (log)` and `session (now)` are
   * blanked out — a later entry for the same phrase supersedes these values.
   */
  isLatestForPhrase: boolean;
}

const HistoryRow = ({
  index,
  entry,
  liveSlotsAhead,
  completedLessonCount,
  isLatestForPhrase,
}: RowProps): JSX.Element => {
  const [expanded, setExpanded] = useState(false);
  const { event, phrase, scoreSummary } = entry;
  const badge = getResultBadge(entry);

  const userSaid =
    event.eventType === "reveal"
      ? "—"
      : (event as Attempt | PracticeAttempt).transcript.join(" ") || "—";

  const canExpand =
    event.eventType === "reveal" ||
    ((event.eventType === "attempt" || event.eventType === "practice") &&
      scoreSummary != null);

  const isPractice = event.eventType === "practice";
  const primaryTextClass = isPractice ? "text-gray-500" : "text-gray-900";
  const rowBgClass = isPractice
    ? `bg-gray-100${canExpand ? " cursor-pointer hover:bg-gray-200/70" : ""}`
    : canExpand
      ? "cursor-pointer hover:bg-gray-50"
      : "";
  const rowTitle = isPractice
    ? "Practice only — not scored, does not update mastery"
    : undefined;

  const mastDisplayed =
    scoreSummary?.mastery ??
    (event.eventType === "reveal" ? entry.masteryAfter : null);
  const mastCellClass =
    isPractice || mastDisplayed == null
      ? `py-2 px-1 text-right tabular-nums align-top ${primaryTextClass}`
      : mastDisplayed < MASTERY_STABILIZING_CEIL
        ? "py-2 px-1 text-right tabular-nums align-top text-red-600"
        : "py-2 px-1 text-right tabular-nums align-top text-emerald-700";

  return (
    <>
      <tr
        className={`border-b border-gray-100 ${rowBgClass}`}
        title={rowTitle}
        onClick={() => {
          if (canExpand) setExpanded((v) => !v);
        }}
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
            {entry.isRepeatedPresentation && (
              <span
                title="Revisit — this phrase was presented again in the same session (e.g. Pimsleur requeue or deck wrap)"
                className="inline-block w-fit text-[10px] px-1.5 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200"
              >
                revisit
              </span>
            )}
            <span
              title={`${formatSrsSessionTitle(entry.dueOnLessonSessionIndex)} (current completed-lesson count: ${completedLessonCount})`}
              className="text-[10px] text-gray-500 tabular-nums"
            >
              next:{" "}
              {formatSrsSessionLabel(
                entry.dueOnLessonSessionIndex,
                completedLessonCount,
              )}
            </span>
            <span
              title={
                isLatestForPhrase
                  ? "In-session distance captured at the moment this event was logged. Mirrors the session engine's Pimsleur requeue: REPEAT_SOON for weak attempts/reveals, REPEAT_LATER for stabilizing attempts, '—' for mastered (dropped) or practice."
                  : "Superseded — a later entry exists for this phrase in this session"
              }
              className="text-[10px] text-gray-500 tabular-nums"
            >
              session (log):{" "}
              {isLatestForPhrase ? formatSlotsAhead(entry.slotsAheadAtEvent) : "—"}
            </span>
            <span
              title={
                isLatestForPhrase
                  ? "Current distance to this phrase in the remaining session queue. Ticks down as cards play and goes to '—' once the phrase is re-drawn or dropped."
                  : "Superseded — a later entry exists for this phrase in this session"
              }
              className="text-[10px] text-gray-500 tabular-nums"
            >
              session (now):{" "}
              {isLatestForPhrase ? formatSlotsAhead(liveSlotsAhead) : "—"}
            </span>
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
        <td
          className={mastCellClass}
          title={
            !isPractice && mastDisplayed != null
              ? mastDisplayed < MASTERY_STABILIZING_CEIL
                ? `Below ${SESSION_GRADUATION_PCT}% session graduation mastery — eligible for in-session requeue (cap ${MAX_REINSERTS_PER_PHRASE_PER_SESSION} reinserts/phrase).`
                : `At or above ${SESSION_GRADUATION_PCT}% — not reinserted for mastery reasons this session.`
              : isPractice
                ? "Try Again does not change mastery; color follows stored value for reference only."
                : undefined
          }
        >
          {formatPct(mastDisplayed)}
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
            {event.eventType === "reveal" ? (
              <RevealEventDetail entry={entry} />
            ) : (
              <ScoredEventDetail
                entry={entry as ScoredEntry}
                isPractice={event.eventType === "practice"}
              />
            )}
          </td>
        </tr>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

interface LegendItem {
  term: string;
  description: string;
}

const LEARNING_THRESHOLD_PCT = Math.round(ACCURACY_SUCCESS_THRESHOLD * 100);

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
    description: `Weighted accuracy ≥ ${LEARNING_THRESHOLD_PCT}% (accuracy success) but not an exact string match — stability EMA uses x = 1; exact-match chime is separate.`,
  },
  {
    term: "miss",
    description: `Weighted accuracy below the ${LEARNING_THRESHOLD_PCT}% accuracy success threshold — stability EMA uses x = 0 for this attempt.`,
  },
  {
    term: "revisit",
    description:
      "This phrase was presented again in the current session — e.g. a Pimsleur requeue after a weak attempt, or a deck wrap. The badge applies to every event (attempt, retry, reveal) logged for that revisit card and is orthogonal to the scored-vs-practice distinction.",
  },
  {
    term: "next",
    description:
      "Cross-session SRS is lesson-based (not wall-clock): after the event, the phrase stores a due-on lesson index. Learning-band results schedule the next lesson; stabilizing schedules two lessons ahead; mastered uses a growing spacing (capped); reveal schedules the next lesson. \u201cnext\u201d compares that index to your completed-lesson count. Retry (practice) rows carry the prior schedule forward unchanged.",
  },
  {
    term: "session (log)",
    description:
      "Snapshot of the in-session distance captured at the moment this event was logged. Reflects the session engine's Pimsleur requeue: 3 cards ahead for weak attempts and reveals (REPEAT_SOON), 6 cards ahead for stabilizing attempts (REPEAT_LATER), or '—' for mastered attempts (dropped) and practice events (never reorder).",
  },
  {
    term: "session (now)",
    description:
      "Live distance to this phrase's next appearance in the remaining session queue. Shrinks as cards play and goes to '—' once the phrase has been re-drawn or dropped from the session.",
  },
];

const METRIC_LEGEND: LegendItem[] = [
  {
    term: "Accuracy",
    description:
      "How well the transcript matches the target phrase when missing and extra words are weighted by part of speech. Shown as Acc in the table; expand a row for the full penalty math.",
  },
  {
    term: "Fluency",
    description:
      "How smoothly the phrase was spoken using word-level timings from speech-to-text. Shown as Flu; null when there are not enough timed words. Expand a row for speed, pause, and rhythm subscores.",
  },
  {
    term: "Stability",
    description:
      "A 0–1 score per phrase. On each scored attempt, the EMA blends prior S with x, where x is 1 if weighted accuracy met the accuracy success threshold (not the exact-match badge), else 0. Reveal multiplies S by a decay; Try Again leaves S unchanged. Shown indirectly via Mast; expand a row for S, S′, α, and x.",
  },
  {
    term: "Mastery",
    description:
      "The engine's combined score (0–1) after each event: accuracy, fluency when available, and stability S′. Drives learning / stabilizing / mastered bands, SRS spacing, and whether the phrase may be reinserted in the current lesson: below session graduation (see expanded row, typically 80%) means eligible for in-session requeue (with a per-phrase cap). Shown as Mast.",
  },
];

const BREAKDOWN_TERMS_LEGEND: LegendItem[] = [
  {
    term: "clamp",
    description:
      "Written clamp(\u2026) in the formulas. It pins a value into the 0\u20131 range: anything below 0 becomes 0, anything above 1 becomes 1, otherwise the value is unchanged. So scores never leave the \u201c0\u2013100%\u201d band.",
  },
  {
    term: "totalWeight",
    description:
      "Sum of part-of-speech weights for every word in the target phrase. Used as the denominator when turning missing and extra penalties into accuracy.",
  },
  {
    term: "missingPenalty",
    description:
      "Sum of weights for target words that did not align to anything in the transcript (skipped or wrong).",
  },
  {
    term: "rawExtraPenalty",
    description:
      "Flat penalty per extra spoken word (tokens not matched to the target), multiplied by count before the cap is applied.",
  },
  {
    term: "extraPenalty (after cap)",
    description:
      "The smaller of the configured cap and rawExtraPenalty. Stops a burst of noise or filler from wiping accuracy entirely.",
  },
  {
    term: `Accuracy success threshold (${LEARNING_THRESHOLD_PCT}%)`,
    description:
      "Weighted accuracy must be ≥ this value for isAccuracySuccess. That sets stability EMA input x = 1 on scored attempts; below it, x = 0. Same constant as ACCURACY_SUCCESS_THRESHOLD in code. Not the same as session graduation mastery (next entry). Independent of the exact-match badge.",
  },
  {
    term: `Session graduation mastery (${SESSION_GRADUATION_PCT}%)`,
    description:
      "MASTERY_STABILIZING_CEIL (0.8): after a scored attempt or reveal, post-event mastery below this makes the phrase eligible for in-session requeue (slot depth from mastery/stability blend). At or above it, the session engine does not reinsert the phrase for mastery reasons. At most MAX_REINSERTS_PER_PHRASE_PER_SESSION reinserts per phrase per lesson — eligibility does not guarantee another appearance after the cap.",
  },
  {
    term: "wordsPerSecond",
    description:
      "Number of words divided by elapsed time from the start of the first word to the end of the last (whole-phrase duration).",
  },
  {
    term: "speedScore",
    description:
      "0–1 score from how close wordsPerSecond is to a conversational band: full credit inside the band, falling toward zero outside it (triangular shape between floor and ceiling speeds).",
  },
  {
    term: "longPauses",
    description:
      "Count of pauses between consecutive words longer than the configured seconds; each one reduces pauseScore.",
  },
  {
    term: "pauseScore",
    description:
      "Starts at 1 and shrinks when longPauses accumulate; rewards steady delivery without big gaps.",
  },
  {
    term: "gapConsistencyScore",
    description:
      "1 divided by (1 + variance of gaps between words). Even spacing scores higher than erratic rhythm.",
  },
  {
    term: "fluencyScore (composite)",
    description:
      "Weighted sum of speedScore, pauseScore, and gapConsistencyScore (see constants in the expanded row), then clamped to 0–1.",
  },
  {
    term: "S and S′ (stability)",
    description:
      "S is stability before the event; S′ is after. On attempts, S′ comes from the EMA with success bit x. On reveal, S is multiplied by a decay factor. On practice, S is unchanged so S′ equals S.",
  },
  {
    term: "α (alpha)",
    description:
      "EMA blend weight in (1−α)·S + α·x: how much the latest attempt's success (x) moves stability versus how much old S is kept.",
  },
  {
    term: "x (success input)",
    description:
      "1 if this attempt's weighted accuracy met the accuracy success threshold (ACCURACY_SUCCESS_THRESHOLD), 0 otherwise. Only on scored attempts; reveal and practice do not use this EMA step.",
  },
  {
    term: "M and M′ (mastery on reveal)",
    description:
      "M is mastery before Show Answer; M′ is after multiplying by the reveal decay constant and clamping. Attempt rows use the general mastery blend instead.",
  },
  {
    term: "Mastery blend (attempt / retry)",
    description:
      "Post-attempt mastery is a weighted sum of accuracy, fluency, and S′, then clamped. When word-level fluency is not recorded but exactly one STT word was captured, fluency is imputed as 1 for this calculation only. Otherwise, without a measured fluency score, the formula uses only accuracy and S′ with different weights — see the expanded row for the exact coefficients.",
  },
];

export const Legend = (): JSX.Element => (
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
        <span className="font-mono">mastered</span> bands, and the{" "}
        spaced-repetition scheduler uses that band to decide how many
        full lesson runs to skip before showing them again (session-based,
        not calendar time).
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
        Expanded row · formulas and data points
      </h3>
      <p className="text-[11px] text-gray-600 leading-relaxed mb-2">
        Open any row with the arrow to see numbers for that event. Terms below
        match the labels in those panels.
      </p>
      <dl className="space-y-2 text-[11px] leading-relaxed">
        {BREAKDOWN_TERMS_LEGEND.map((item) => (
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

// ---------------------------------------------------------------------------
// SessionHistoryStatsBar
// ---------------------------------------------------------------------------

export const SessionHistoryStatsBar = ({
  history,
  remainingInSession,
  subtitle,
  variant = "dark",
  actions,
}: {
  history: HistoryEntry[];
  remainingInSession: number;
  /** Short line below the title row, e.g. "Buffered log (mobile dev)". */
  subtitle?: string;
  variant?: "dark" | "light";
  /** Optional controls rendered at the far end of the title row (e.g. Clear/Close buttons). */
  actions?: React.ReactNode;
}): JSX.Element => {
  const stats = useMemo(() => computeStats(history), [history]);
  const isDark = variant === "dark";

  const labelClass = isDark
    ? "text-[10px] uppercase tracking-wide text-gray-400"
    : "text-[10px] uppercase tracking-wide text-gray-500";
  const valueClass = isDark
    ? "text-sm font-semibold text-gray-100 tabular-nums"
    : "text-sm font-semibold text-gray-900 tabular-nums";
  const wrapClass = isDark
    ? "bg-gray-900 text-white px-4 py-3"
    : "bg-white border-b border-gray-200 px-4 py-3";
  const metaClass = isDark ? "text-[10px] text-gray-400" : "text-[10px] text-gray-500";

  return (
    <div className={wrapClass}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={isDark ? "text-sm font-semibold tracking-wide" : "text-sm font-semibold text-gray-800 tracking-wide"}>
            Session history
          </span>
          <span className={metaClass}>
            {history.length} event{history.length === 1 ? "" : "s"}
            {subtitle ? ` · ${subtitle}` : remainingInSession > 0 ? ` · ${remainingInSession} left in session` : ""}
          </span>
        </div>
        {actions}
      </div>
      <div className="grid grid-cols-4 gap-3">
        <div className="flex flex-col min-w-0">
          <span className={labelClass}>Attempts</span>
          <span className={valueClass}>{stats.totalAttempts}</span>
        </div>
        <div className="flex flex-col min-w-0">
          <span className={labelClass}>Exact</span>
          <span className={valueClass}>
            {stats.exactCorrectPct == null
              ? "—"
              : `${stats.exactCorrect}/${stats.totalAttempts}`}
          </span>
        </div>
        <div className="flex flex-col min-w-0">
          <span className={labelClass}>Avg acc</span>
          <span className={valueClass}>{formatPct(stats.avgAccuracy)}</span>
        </div>
        <div className="flex flex-col min-w-0">
          <span className={labelClass}>Avg flu</span>
          <span className={valueClass}>{formatPct(stats.avgFluency)}</span>
        </div>
      </div>
      {(stats.practiceCount > 0 ||
        stats.revealCount > 0 ||
        stats.revisitAttemptCount > 0) && (
        <div className={`mt-2 ${metaClass}`}>
          {stats.practiceCount} retry · {stats.revealCount} reveal ·{" "}
          {stats.revisitAttemptCount} revisit attempt
          {stats.revisitAttemptCount === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// SessionHistoryLogView (main export)
// ---------------------------------------------------------------------------

export interface SessionHistoryLogViewProps {
  history: HistoryEntry[];
  getLiveSlotsAhead: (phraseId: string) => number | null;
  queueVersion: number;
  completedLessonCount: number;
  emptyStateMessage?: string;
  className?: string;
}

export const SessionHistoryLogView = ({
  history,
  getLiveSlotsAhead,
  queueVersion,
  completedLessonCount,
  emptyStateMessage,
  className,
}: SessionHistoryLogViewProps): JSX.Element => {
  const reversed = useMemo(() => [...history].reverse(), [history]);

  const liveSlotsByPhraseId = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const entry of history) {
      if (!map.has(entry.phrase.id)) {
        map.set(entry.phrase.id, getLiveSlotsAhead(entry.phrase.id));
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, queueVersion, getLiveSlotsAhead]);

  const latestEntryIdByPhraseId = useMemo(() => {
    const map = new Map<string, string>(); // phraseId → entry.id
    for (const entry of history) {
      map.set(entry.phrase.id, entry.id); // later entries overwrite earlier ones
    }
    return map;
  }, [history]);

  return (
    <div className={className}>
      {history.length === 0 ? (
        <div className="p-6 text-center text-xs text-gray-500">
          {emptyStateMessage ??
            "No events yet. Attempts, practice repeats, and reveals will appear here as you progress through the lesson."}
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
                liveSlotsAhead={liveSlotsByPhraseId.get(entry.phrase.id) ?? null}
                completedLessonCount={completedLessonCount}
                isLatestForPhrase={latestEntryIdByPhraseId.get(entry.phrase.id) === entry.id}
              />
            ))}
          </tbody>
        </table>
      )}
      <Legend />
    </div>
  );
};
