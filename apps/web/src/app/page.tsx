"use client";

import { PhraseDisplay } from "./components/PhraseDisplay";
import { useTranscriptQuery } from "./hooks/useTranscriptQuery";

export default function Home(): JSX.Element {
  const {
    data: phrases,
    isLoading,
    isError,
    error,
  } = useTranscriptQuery();

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
        <PhraseDisplay phrases={phrases} />
      </main>
    </div>
  );
}