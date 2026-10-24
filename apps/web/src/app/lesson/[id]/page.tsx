import dynamic from "next/dynamic";

const LessonPageContent = dynamic(() => import("./LessonPageContent"), {
  loading: () => (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-white">
      <svg
        className="h-6 w-6 animate-spin text-gray-400"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <main className="text-center text-gray-500">Loading lesson...</main>
    </div>
  ),
  ssr: true,
});

export default function LessonPage(): JSX.Element {
  return <LessonPageContent />;
}
