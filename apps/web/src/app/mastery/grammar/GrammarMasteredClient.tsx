"use client";

import {
  buildLifetimeGrammarMasteryRows,
  summarizeItemBands,
  useLearnerMasteryQuery,
} from "@ai-spanish/logic";
import { useMemo } from "react";
import { webLessonProgressFetcher } from "@/lib/lessonProgressApi";
import { MasteryReportPage } from "../../components/MasteryReportPage";

export function GrammarMasteredClient(): JSX.Element {
  const { data: snapshot, isLoading, isError } = useLearnerMasteryQuery(webLessonProgressFetcher);

  const rows = useMemo(
    () => (snapshot ? buildLifetimeGrammarMasteryRows(snapshot) : []),
    [snapshot],
  );
  const summary = useMemo(() => summarizeItemBands(rows), [rows]);

  return (
    <MasteryReportPage
      title="Grammar Mastered"
      isLoading={isLoading}
      isError={isError}
      rows={rows}
      summary={summary}
      emptyLabel="No grammar tracked yet. Complete a lesson to start building your report."
    />
  );
}
