"use client";

import {
  classifyItemMastery,
  type ItemBandSummary,
  type ItemMasteryBand,
  type LifetimeMasteryRow,
} from "@ai-spanish/logic";

const formatPct = (n: number): string => `${Math.round(n * 100)}%`;

const BAND_BADGE_CLASS: Record<ItemMasteryBand, string> = {
  weak: "bg-red-50 text-red-700 border-red-200",
  stabilizing: "bg-amber-50 text-amber-700 border-amber-200",
  mastered: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

// ─── Band summary bar ───────────────────────────────────────────────────────

interface BandBarProps {
  summary: ItemBandSummary;
  label: string;
}

export const BandBar = ({ summary, label }: BandBarProps): JSX.Element => {
  const { weak, stabilizing, mastered, untrained, total } = summary;
  if (total === 0) return <p className="text-xs text-gray-400">No data yet.</p>;

  const pct = (n: number): string => `${Math.round((n / total) * 100)}%`;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] text-gray-600">{label}</span>
        <span className="text-[10px] text-gray-400">{total} items</span>
      </div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100"
        role="img"
        aria-label={`${label}: ${mastered} mastered, ${stabilizing} stabilizing, ${weak} weak, ${untrained} not yet practiced`}
      >
        {mastered > 0 && (
          <div className="h-full bg-emerald-500" style={{ width: pct(mastered) }} />
        )}
        {stabilizing > 0 && (
          <div className="h-full bg-amber-400" style={{ width: pct(stabilizing) }} />
        )}
        {weak > 0 && <div className="h-full bg-red-400" style={{ width: pct(weak) }} />}
        {untrained > 0 && (
          <div className="h-full bg-gray-200" style={{ width: pct(untrained) }} />
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-gray-500">
        {mastered > 0 && <span className="text-emerald-600">{mastered} mastered</span>}
        {stabilizing > 0 && <span className="text-amber-600">{stabilizing} stabilizing</span>}
        {weak > 0 && <span className="text-red-600">{weak} weak</span>}
        {untrained > 0 && <span className="text-gray-400">{untrained} not yet practiced</span>}
      </div>
    </div>
  );
};

// ─── Ranked row ──────────────────────────────────────────────────────────────

interface MasteryRowItemProps {
  row: LifetimeMasteryRow;
}

const MasteryRowItem = ({ row }: MasteryRowItemProps): JSX.Element => {
  const band: ItemMasteryBand = row.isUntrained ? "weak" : classifyItemMastery(row.mastery);

  return (
    <li className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{row.key}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        {row.isUntrained ? (
          <>
            {row.claimedLevel && (
              <span className="rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-500">
                {row.claimedLevel}
              </span>
            )}
            <span className="rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-400">
              not yet practiced
            </span>
          </>
        ) : (
          <>
            <span className="text-[10px] tabular-nums text-gray-400">
              {Math.round(row.trialsEff)} trials
            </span>
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
      </div>
    </li>
  );
};

// ─── Ranked list ─────────────────────────────────────────────────────────────
//
// Renders inline (no inner scroll container) — the browser's own scroll
// shows the full list as the page grows.

export interface MasteryRankingListProps {
  title: string;
  rows: readonly LifetimeMasteryRow[];
  emptyLabel: string;
}

export const MasteryRankingList = ({
  title,
  rows,
  emptyLabel,
}: MasteryRankingListProps): JSX.Element => (
  <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
    <header className="mb-2 flex items-center justify-between">
      <span className="text-sm font-semibold text-gray-800">
        All {title.toLowerCase()} ranked
      </span>
      <span className="text-[11px] text-gray-500">
        Lowest first · {rows.length} item{rows.length === 1 ? "" : "s"}
      </span>
    </header>
    {rows.length === 0 ? (
      <p className="py-2 text-xs text-gray-400">{emptyLabel}</p>
    ) : (
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <MasteryRowItem key={row.key} row={row} />
        ))}
      </ul>
    )}
  </div>
);
