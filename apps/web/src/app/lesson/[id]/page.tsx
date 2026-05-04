import dynamic from "next/dynamic";

const LessonPageContent = dynamic(() => import("./LessonPageContent"), {
  loading: () => (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <main className="w-full max-w-[390px] mx-auto px-8 py-16 text-center text-gray-500">
        Loading lesson...
      </main>
    </div>
  ),
  ssr: true,
});

export default function LessonPage(): JSX.Element {
  return <LessonPageContent />;
}
