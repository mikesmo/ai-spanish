"use client";

import { isTranscriptLessonIdSyntaxValid } from "@ai-spanish/logic";
import { notFound, useParams } from "next/navigation";
import { PhraseDisplay } from "../../components/PhraseDisplay";
import { useLessonQuery } from "../../hooks/useLessonQuery";

function resolveLessonId(params: { id?: string | string[] }): string {
  const raw =
    typeof params.id === "string"
      ? params.id
      : Array.isArray(params.id)
        ? params.id[0]
        : undefined;
  if (raw == null || !isTranscriptLessonIdSyntaxValid(raw)) {
    notFound();
  }
  return raw;
}

export default function LessonPage(): JSX.Element {
  const params = useParams();
  const lessonId = resolveLessonId(params);

  const {
    data: phrases,
    isLoading,
    isError,
    error,
  } = useLessonQuery(lessonId);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <main className="w-full max-w-[390px] mx-auto px-8 py-16 text-center text-gray-500">
          Loading lesson...
        </main>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <main className="w-full max-w-[390px] mx-auto px-8 py-16 text-center text-[#D85A30]">
          {error instanceof Error ? error.message : "Failed to load lesson."}
        </main>
      </div>
    );
  }

  if (!phrases || phrases.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <main className="w-full max-w-[390px] mx-auto px-8 py-16 text-center text-gray-500">
          No phrases available.
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white">
      <main className="w-full">
        <PhraseDisplay phrases={phrases} lessonId={lessonId} />
      </main>
    </div>
  );
}
