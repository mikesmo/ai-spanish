"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  buildDeckFingerprint,
  buildLessonCompletionPayload,
  createLessonCompletionRunId,
  getLessonTitle,
  MASTERY_STABILIZING_CEIL,
  pickRandomPhraseEventsForCard,
  useLessonSessionWithHistory,
  type Phrase,
} from "@ai-spanish/logic";
import { useLessonQuery } from "../../hooks/useLessonQuery";
import { postLessonCompletion } from "@/lib/postLessonCompletion";
import { postGrammarGrading } from "@/lib/grammarGrading";

interface Props {
  lessonId: string;
  lessonTitle: string;
}

type SimStatus = "idle" | "running" | "done";

interface SimResult {
  historyLength: number;
  incorrectCount: number;
  elapsedMs: number;
  posted: boolean;
}

const LESSON_IDS = ["1", "2"];

interface RunnerProps {
  phrases: Phrase[];
  lessonId: string;
  lessonTitle: string;
}

/**
 * Only mounted when `phrases.length > 0` so `useLessonSessionWithHistory` never
 * receives an empty deck while the transcript query is still loading.
 */
function LessonSimRunner({
  phrases,
  lessonId,
  lessonTitle,
}: RunnerProps): JSX.Element {
  const queryClient = useQueryClient();
  const [simStatus, setSimStatus] = useState<SimStatus>("idle");
  const [result, setResult] = useState<SimResult | null>(null);

  const runningRef = useRef(false);
  const startTimeRef = useRef<number>(0);
  const lessonRunIdRef = useRef<string | undefined>(undefined);

  const deckFingerprintRef = useRef(buildDeckFingerprint(phrases));

  const session = useLessonSessionWithHistory(phrases, { postGrammarGrading });
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const {
    getSessionCheckpoint,
    presentationVersion,
    isComplete,
    pendingGradingCount,
  } = session;

  const [waitingToAdvance, setWaitingToAdvance] = useState(false);

  // Step effect: fires after every advance() updates presentationVersion.
  // Processes events for the current card then sets waitingToAdvance so the
  // advance effect can gate on grading completion before moving forward.
  useEffect(() => {
    if (!runningRef.current) return;

    const s = sessionRef.current;
    if (s.isComplete) return;

    const phrase = s.currentPhrase;
    s.bindCurrentPhrase(phrase);
    s.onPresentationStart?.(phrase);
    const events = pickRandomPhraseEventsForCard(phrase, Math.random);
    events.forEach((ev) => s.onPhraseEvent(ev));
    setWaitingToAdvance(true);
  }, [simStatus, presentationVersion]);

  // Advance effect: calls advance() only after all pending AI grading has
  // resolved for the current card. This ensures grammar results can influence
  // whether the card is revisited before we move on.
  useEffect(() => {
    if (!waitingToAdvance) return;
    if (!runningRef.current) return;
    if (sessionRef.current.isComplete) return;
    if (pendingGradingCount > 0) return;

    setWaitingToAdvance(false);
    sessionRef.current.advance();
  }, [waitingToAdvance, pendingGradingCount]);

  // Completion effect: when session drains, post results.
  useEffect(() => {
    if (!isComplete || simStatus !== "running") return;

    runningRef.current = false;
    const elapsedMs = Date.now() - startTimeRef.current;
    const s = sessionRef.current;

    const checkpoint = s.getSessionCheckpoint({
      lessonId,
      deckFingerprint: deckFingerprintRef.current,
    });

    const payload = buildLessonCompletionPayload({
      runId: lessonRunIdRef.current!,
      lessonId,
      lessonTitle,
      entries: s.history,
      checkpoint,
    });

    const incorrectCount = s.incorrectPhraseRecords.length;
    const historyLength = s.history.length;

    void postLessonCompletion(payload).then((posted) => {
      if (posted) {
        void queryClient.invalidateQueries({
          queryKey: ["lesson-resume-checkpoint", lessonId],
        });
      }
      setResult({ historyLength, incorrectCount, elapsedMs, posted });
      setSimStatus("done");
    });
  }, [isComplete, simStatus, lessonId, lessonTitle, queryClient]);

  const handleStart = () => {
    lessonRunIdRef.current = createLessonCompletionRunId();
    startTimeRef.current = Date.now();
    setResult(null);
    setWaitingToAdvance(false);
    setSimStatus("running");
    runningRef.current = true;

    const s = sessionRef.current;
    const phrase = s.currentPhrase;
    s.bindCurrentPhrase(phrase);
    s.onPresentationStart?.(phrase);
    const events = pickRandomPhraseEventsForCard(phrase, Math.random);
    events.forEach((ev) => s.onPhraseEvent(ev));
    setWaitingToAdvance(true);
  };

  const handleStop = () => {
    runningRef.current = false;
    setWaitingToAdvance(false);
    setSimStatus("idle");
  };

  const isRunning = simStatus === "running";

  const cp = getSessionCheckpoint({
    lessonId,
    deckFingerprint: deckFingerprintRef.current,
  });
  const progressById = new Map(cp.progress.map((p) => [p.phraseId, p]));
  const simRows = phrases.map((phrase, deckIndex) => {
    const prog = progressById.get(phrase.name);
    const isMastered =
      prog != null && prog.masteryScore >= MASTERY_STABILIZING_CEIL;
    return {
      key: phrase.name,
      deckIndex: deckIndex + 1,
      label: phrase.English.question,
      isMastered,
    };
  });
  const masteredCount = simRows.filter((r) => r.isMastered).length;
  const simTotal = phrases.length;
  const progressFraction = simTotal > 0 ? masteredCount / simTotal : 0;
  const progressPercent = Math.round(progressFraction * 100);

  return (
    <>
      <div className="mb-8 flex items-center gap-3">
        <button
          type="button"
          onClick={isRunning ? handleStop : handleStart}
          className={`rounded-lg px-5 py-2.5 text-sm font-medium transition ${
            isRunning
              ? "bg-red-50 text-red-600 hover:bg-red-100"
              : "bg-gray-900 text-white hover:bg-gray-700"
          }`}
        >
          {isRunning ? "Stop" : "Run simulation"}
        </button>
        {isRunning && (
          <span className="text-sm text-gray-400">Running…</span>
        )}
      </div>

      {(isRunning || simStatus === "done") && (
        <div className="mb-8 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Phrases mastered
            </p>
            <p className="text-sm tabular-nums text-gray-600">
              {masteredCount} / {simTotal}
              <span className="text-gray-400"> ({progressPercent}%)</span>
            </p>
          </div>
          <div
            className="mb-4 h-2.5 w-full overflow-hidden rounded-full bg-gray-100"
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Lesson phrases mastered"
          >
            <div
              className="h-full rounded-full bg-gray-900 transition-[width] duration-300 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <ul className="max-h-48 space-y-1.5 overflow-y-auto text-sm">
            {simRows.map((row) => (
              <li
                key={row.key}
                className={`flex items-start gap-2 rounded-md px-2 py-1 ${
                  row.isMastered ? "bg-green-50 text-green-900" : "text-gray-600"
                }`}
              >
                <span
                  className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                    row.isMastered
                      ? "bg-green-600 text-white"
                      : "bg-gray-200 text-gray-500"
                  }`}
                  aria-hidden
                >
                  {row.isMastered ? "✓" : row.deckIndex}
                </span>
                <span
                  className={`min-w-0 flex-1 leading-snug ${
                    row.isMastered ? "" : "text-gray-700"
                  }`}
                  title={row.label}
                >
                  {row.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {simStatus === "done" && result && (
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400">
            Result
          </p>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <dt className="text-gray-500">Events recorded</dt>
            <dd className="font-medium text-gray-900">{result.historyLength}</dd>
            <dt className="text-gray-500">Incorrect phrases</dt>
            <dd className="font-medium text-gray-900">{result.incorrectCount}</dd>
            <dt className="text-gray-500">Elapsed</dt>
            <dd className="font-medium text-gray-900">
              {(result.elapsedMs / 1000).toFixed(2)} s
            </dd>
            <dt className="text-gray-500">Completion posted</dt>
            <dd
              className={`font-medium ${
                result.posted ? "text-green-600" : "text-red-500"
              }`}
            >
              {result.posted ? "Yes" : "No"}
            </dd>
          </dl>
        </div>
      )}
    </>
  );
}

export function LessonSimClient({ lessonId, lessonTitle }: Props): JSX.Element {
  const { data: phrases, isLoading, isError } = useLessonQuery(lessonId);
  const hasDeck = phrases != null && phrases.length > 0;

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-[560px] px-8 py-14">
        <div className="mb-8 flex items-center gap-3">
          <Link
            href="/"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            aria-label="Home"
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
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </Link>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-400">
              Dev — Lesson Simulation
            </p>
            <h1 className="text-lg font-semibold text-gray-900">
              {lessonTitle}
            </h1>
          </div>
        </div>

        <div className="mb-8">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
            Lesson
          </p>
          <ul className="flex flex-wrap gap-2">
            {LESSON_IDS.map((id) => (
              <li key={id}>
                <Link
                  href={`/dev/lesson-sim?lesson=${id}`}
                  className={`rounded-md border px-3 py-1.5 text-sm transition ${
                    id === lessonId
                      ? "border-gray-800 bg-gray-900 text-white"
                      : "border-gray-200 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {getLessonTitle(id)}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="mb-8">
          {isLoading && (
            <p className="text-sm text-gray-400">Loading lesson deck…</p>
          )}
          {isError && (
            <p className="text-sm text-red-500">Failed to load lesson deck.</p>
          )}
          {phrases != null && !isLoading && !isError && (
            <p className="text-sm text-gray-500">
              {hasDeck
                ? `${phrases.length} phrases loaded.`
                : "No phrases in this lesson — nothing to simulate."}
            </p>
          )}
        </div>

        {hasDeck ? (
          <LessonSimRunner
            key={lessonId}
            phrases={phrases}
            lessonId={lessonId}
            lessonTitle={lessonTitle}
          />
        ) : null}
      </div>
    </div>
  );
}
