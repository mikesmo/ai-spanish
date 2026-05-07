"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  buildDeckFingerprint,
  buildLessonCompletionPayload,
  createLessonCompletionRunId,
  getLessonTitle,
  pickRandomPhraseEventsForCard,
  useLessonSessionWithHistory,
  type Phrase,
} from "@ai-spanish/logic";
import { useLessonQuery } from "../../hooks/useLessonQuery";
import { postLessonCompletion } from "@/lib/postLessonCompletion";

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

  const session = useLessonSessionWithHistory(phrases, {});
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Step effect: fires after every advance() updates presentationVersion.
  useEffect(() => {
    if (!runningRef.current) return;

    const s = sessionRef.current;
    if (s.isComplete) return;

    const tid = window.setTimeout(() => {
      if (!runningRef.current) return;
      const snap = sessionRef.current;
      if (snap.isComplete) return;

      const phrase = snap.currentPhrase;
      snap.bindCurrentPhrase(phrase);
      snap.onPresentationStart?.(phrase);
      const events = pickRandomPhraseEventsForCard(phrase, Math.random);
      events.forEach((ev) => snap.onPhraseEvent(ev));
      snap.advance();
    }, 0);

    return () => window.clearTimeout(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drive steps off presentation bumps
  }, [simStatus, session.presentationVersion]);

  // Completion effect: when session drains, post results.
  useEffect(() => {
    if (!session.isComplete || simStatus !== "running") return;

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
  }, [session.isComplete, simStatus, lessonId, queryClient]);

  const handleStart = () => {
    lessonRunIdRef.current = createLessonCompletionRunId();
    startTimeRef.current = Date.now();
    setResult(null);
    setSimStatus("running");
    runningRef.current = true;

    const s = sessionRef.current;
    const phrase = s.currentPhrase;
    s.bindCurrentPhrase(phrase);
    s.onPresentationStart?.(phrase);
    const events = pickRandomPhraseEventsForCard(phrase, Math.random);
    events.forEach((ev) => s.onPhraseEvent(ev));
    s.advance();
  };

  const handleStop = () => {
    runningRef.current = false;
    setSimStatus("idle");
  };

  const isRunning = simStatus === "running";

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
