import { lessons } from "@ai-spanish/logic";
import Link from "next/link";

export default function Home(): JSX.Element {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white">
      <main className="w-full max-w-[390px] mx-auto px-8 py-16">
        <h1 className="text-2xl font-semibold text-gray-900 text-center mb-2">
          AI Spanish
        </h1>
        <p className="text-sm text-gray-500 text-center mb-10">
          Choose a lesson to practice
        </p>
        <ul className="flex flex-col gap-4">
          {lessons.map((lesson) => (
            <li key={lesson.id}>
              <Link
                href={`/lesson/${lesson.id}`}
                className="block w-full rounded-xl border border-gray-200 bg-white px-5 py-4 text-left shadow-sm transition hover:border-gray-300 hover:shadow"
              >
                <span className="block text-base font-medium text-gray-900">
                  {lesson.title}
                </span>
                <span className="mt-1 block text-sm text-gray-500">
                  {lesson.description}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
