import { useState } from "react";
import LessonListScreen from "./screens/LessonListScreen";
import LessonScreen from "./screens/LessonScreen";
import { QueryProvider } from "./src/providers/QueryProvider";

export default function AppInner(): JSX.Element {
  const [lessonId, setLessonId] = useState<string | null>(null);

  return (
    <QueryProvider>
      {lessonId == null ? (
        <LessonListScreen onChooseLesson={setLessonId} />
      ) : (
        <LessonScreen lessonId={lessonId} onBack={() => setLessonId(null)} />
      )}
    </QueryProvider>
  );
}
