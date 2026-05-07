import { getLessonTitle } from "@ai-spanish/logic";
import { LessonReportClient } from "./LessonReportClient";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function LessonReportPage({ params }: Props): Promise<JSX.Element> {
  const { id } = await params;
  const lessonId = id?.trim() ?? "";
  const lessonTitle = getLessonTitle(lessonId);

  return <LessonReportClient lessonId={lessonId} lessonTitle={lessonTitle} />;
}
