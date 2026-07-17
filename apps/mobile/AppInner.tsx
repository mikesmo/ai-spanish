import { useState } from "react";
import LessonListScreen from "./screens/LessonListScreen";
import LessonScreen from "./screens/LessonScreen";
import SettingsScreen from "./screens/SettingsScreen";
import { QueryProvider } from "./src/providers/QueryProvider";

export default function AppInner(): JSX.Element {
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <QueryProvider>
      {lessonId != null ? (
        <LessonScreen lessonId={lessonId} onBack={() => setLessonId(null)} />
      ) : isSettingsOpen ? (
        <SettingsScreen onBack={() => setIsSettingsOpen(false)} />
      ) : (
        <LessonListScreen
          onChooseLesson={setLessonId}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
      )}
    </QueryProvider>
  );
}
