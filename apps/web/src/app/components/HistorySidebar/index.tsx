"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type HistoryEntry } from "@ai-spanish/logic";
import {
  SessionHistoryLogView,
  SessionHistoryStatsBar,
} from "../SessionHistoryLogView";

interface HistorySidebarProps {
  history: HistoryEntry[];
  isOpen: boolean;
  onClose: () => void;
  onClear: () => void;
  getLiveSlotsAhead: (phraseId: string) => number | null;
  queueVersion: number;
  remainingInSession: number;
  completedLessonCount: number;
}

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
  getLiveSlotsAhead,
  queueVersion,
  remainingInSession,
  completedLessonCount,
}: HistorySidebarProps): JSX.Element => {
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

        <header className="shrink-0">
          <SessionHistoryStatsBar
            history={history}
            remainingInSession={remainingInSession}
            variant="dark"
            actions={
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
            }
          />
        </header>

        <div className="flex-1 overflow-y-auto">
          <SessionHistoryLogView
            history={history}
            getLiveSlotsAhead={getLiveSlotsAhead}
            queueVersion={queueVersion}
            completedLessonCount={completedLessonCount}
          />
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
