'use client';

type Props = {
  isLoading: boolean;
  isAudioPlaying: boolean;
};

export default function AISpeaking({ isLoading, isAudioPlaying }: Props) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center animate-screen-fade-in">
      <div className="relative flex items-center justify-center">

        {/* Expanding pulse rings — only animate while audio is playing */}
        <div className={`absolute w-[120px] h-[120px] rounded-full border-2 border-[#7F77DD] ${isAudioPlaying ? 'animate-pulse-ring' : 'opacity-0'}`} />
        <div className={`absolute w-[120px] h-[120px] rounded-full border-2 border-[#7F77DD] ${isAudioPlaying ? 'animate-pulse-ring-delayed' : 'opacity-0'}`} />

        {/* Main circle: dimmed + spinner while loading, pulsing while playing */}
        <div className={`relative w-[120px] h-[120px] rounded-full flex items-center justify-center ${
          isLoading ? 'bg-[#7F77DD]/40' : 'bg-[#7F77DD]'
        } ${isAudioPlaying ? 'animate-breathe' : ''}`}>
          {isLoading ? (
            <svg className="animate-spin h-6 w-6 text-white/70" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <span className="text-white text-xs font-medium tracking-wider uppercase">AI</span>
          )}
        </div>
      </div>
    </div>
  );
}
