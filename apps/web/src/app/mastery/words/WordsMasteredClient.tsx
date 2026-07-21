"use client";

import {
  buildLifetimeWordMasteryRows,
  summarizeItemBands,
  useLearnerMasteryQuery,
} from "@ai-spanish/logic";
import { useMemo } from "react";
import { webLessonProgressFetcher } from "@/lib/lessonProgressApi";
import { MasteryReportPage } from "../../components/MasteryReportPage";

export function WordsMasteredClient(): JSX.Element {
  const { data: snapshot, isLoading, isError } = useLearnerMasteryQuery(webLessonProgressFetcher);

  const rows = useMemo(
    () => (snapshot ? buildLifetimeWordMasteryRows(snapshot) : []),
    [snapshot],
  );
  const summary = useMemo(() => summarizeItemBands(rows), [rows]);

  return (
    <MasteryReportPage
      title="Words Mastered"
      isLoading={isLoading}
      isError={isError}
      rows={rows}
      summary={summary}
      emptyLabel="No words tracked yet. Complete a lesson to start building your report."
    />
  );
}
