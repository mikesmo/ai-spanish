"use client";

import type { ItemBandSummary, LifetimeMasteryRow } from "@ai-spanish/logic";
import Link from "next/link";
import { AppMenu } from "../AppMenu";
import { BandBar, MasteryRankingList } from "../MasteryRanking";

export interface MasteryReportPageProps {
  title: string;
  isLoading: boolean;
  isError: boolean;
  rows: LifetimeMasteryRow[];
  summary: ItemBandSummary;
  emptyLabel: string;
}

/**
 * Shared shell for a single-category lifetime mastery report page (Words
 * Mastered / Grammar Mastered). Renders the band-summary bar plus the full
 * ranked list directly in page flow — no inner scroll container, so the
 * browser's own scrollbar shows the complete list.
 */
export const MasteryReportPage = ({
  title,
  isLoading,
  isError,
  rows,
  summary,
  emptyLabel,
}: MasteryReportPageProps): JSX.Element => (
  <div className="min-h-screen flex flex-col items-center bg-white">
    <AppMenu />
    <main className="w-full max-w-[390px] mx-auto px-8 py-16">
      <div className="mb-2 flex w-full items-center justify-between gap-3">
        <Link
          href="/settings"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
          aria-label="Back"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
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
        <h1 className="flex-1 text-center text-2xl font-semibold text-gray-900">{title}</h1>
        <span className="w-10 shrink-0" aria-hidden />
      </div>

      {isLoading ? (
        <p className="mt-10 text-sm text-gray-500">Loading…</p>
      ) : isError ? (
        <p className="mt-10 text-sm text-[#D85A30]">
          Failed to load your mastery report. Try again later.
        </p>
      ) : (
        <div className="mt-10 flex flex-col gap-3">
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
            <BandBar summary={summary} label={title} />
          </div>
          <MasteryRankingList title={title} rows={rows} emptyLabel={emptyLabel} />
        </div>
      )}
    </main>
  </div>
);
