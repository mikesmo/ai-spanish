'use client';

type Props = {
  englishText: string;
  transcription: string;
  isCorrect: boolean;
  onShowAnswer: () => void;
};

export default function UserRecording({ englishText, transcription, isCorrect, onShowAnswer }: Props) {
  return (
    <div className="flex-1 flex flex-col items-center justify-between w-full animate-screen-fade-in">

      <div className="flex flex-col items-center flex-1 justify-center">
        {/* Teal mic circle */}
        <div className={`w-[120px] h-[120px] rounded-full flex items-center justify-center animate-breathe-fast ${
          isCorrect ? 'bg-[#1D9E75]/70' : 'bg-[#1D9E75]'
        }`}>
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="8" y1="22" x2="16" y2="22" />
          </svg>
        </div>

        {/* English prompt — subdued */}
        <p className="text-[15px] text-gray-400 text-center max-w-[280px] mt-6" style={{ opacity: 0.45 }}>
          {englishText}
        </p>

        {/* Live transcript — turns teal when answer is correct */}
        <div className="mt-6 min-h-[28px] flex items-center justify-center">
          <p className={`text-[18px] text-center ${isCorrect ? 'text-[#1D9E75]' : 'text-gray-500'}`}>
            {transcription}
          </p>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="flex flex-col items-center gap-6">
        {/* Recording indicator */}
        <div className="flex items-center gap-2">
          <div className="w-[10px] h-[10px] rounded-full bg-[#1D9E75] animate-recording-blink" />
          <p className="text-[12px] text-gray-400">Recording</p>
        </div>
        {/* Show answer link */}
        <button
          onClick={onShowAnswer}
          className="text-[13px] text-gray-400 hover:text-gray-600 transition-colors"
        >
          show answer
        </button>
      </div>
    </div>
  );
}
