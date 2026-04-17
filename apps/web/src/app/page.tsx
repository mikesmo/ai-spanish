"use client";

import { phrases } from "@ai-spanish/logic";
import PhraseDisplay from "./components/PhraseDisplay";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white">
      <main className="w-full">
        <PhraseDisplay phrases={phrases} />
      </main>
    </div>
  );
}