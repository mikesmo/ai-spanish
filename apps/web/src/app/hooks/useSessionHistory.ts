"use client";

import { useCallback, useRef, useState } from "react";
import {
  computeMastery,
  type Phrase,
  type PhraseEvent,
} from "@ai-spanish/logic";

export interface ScoreSummary {
  accuracy: number;
  fluency: number | null;
  mastery: number;
  isAccuracySuccess: boolean;
}

export interface HistoryEntry {
  id: string;
  event: PhraseEvent;
  phrase: Phrase;
  scoreSummary: ScoreSummary | null;
}

export interface UseSessionHistoryResult {
  history: HistoryEntry[];
  /** Stable callback — pass to usePhraseDisplay options. */
  onPhraseEvent: (event: PhraseEvent) => void;
  /**
   * Call on each render with the currently displayed phrase. Events emitted
   * before the next call will be attributed to this phrase. Setting a ref
   * during render is safe in React — no state updates occur here.
   */
  bindCurrentPhrase: (phrase: Phrase | undefined) => void;
  clearHistory: () => void;
}

const generateId = (): string => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `h_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * In-memory log of every PhraseEvent emitted during the current session.
 *
 * For Attempt events we precompute a ScoreSummary — stability is pinned to
 * 0, matching the preview convention used by
 * usePhraseDisplay.lastScoreBreakdown.
 */
export const useSessionHistory = (): UseSessionHistoryResult => {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const phraseRef = useRef<Phrase | undefined>(undefined);

  const onPhraseEvent = useCallback((event: PhraseEvent): void => {
    const phrase = phraseRef.current;
    if (!phrase) return;

    let scoreSummary: ScoreSummary | null = null;
    if (event.eventType === "attempt") {
      scoreSummary = {
        accuracy: event.accuracyScore,
        fluency: event.fluencyScore,
        mastery: computeMastery(event.accuracyScore, event.fluencyScore, 0),
        isAccuracySuccess: event.isAccuracySuccess,
      };
    }

    const entry: HistoryEntry = {
      id: generateId(),
      event,
      phrase,
      scoreSummary,
    };

    setHistory((prev) => [...prev, entry]);
  }, []);

  const bindCurrentPhrase = useCallback(
    (phrase: Phrase | undefined): void => {
      phraseRef.current = phrase;
    },
    [],
  );

  const clearHistory = useCallback((): void => {
    setHistory([]);
  }, []);

  return { history, onPhraseEvent, bindCurrentPhrase, clearHistory };
};
