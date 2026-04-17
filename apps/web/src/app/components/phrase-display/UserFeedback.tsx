'use client';

type Props = {
  transcription: string;
  spanishPhrase: string;
  isCorrect: boolean;
  isAudioPlaying: boolean;
  speed: '1x' | 'slow';
  onSpeedChange: (speed: '1x' | 'slow') => void;
  onReplay: () => void;
  onTryAgain: () => void;
  onNext: () => void;
};

const normalize = (s: string) => s.toLowerCase().replace(/[¿?¡!.,;:'"…]/g, '').trim();

function diffWords(spoken: string, spanish: string) {
  const spokenWords = (spoken || '').trim().split(/\s+/).filter(Boolean);
  const spanishWords = (spanish || '').trim().split(/\s+/).filter(Boolean);
  const m = spokenWords.length;
  const n = spanishWords.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = normalize(spokenWords[i - 1]) === normalize(spanishWords[j - 1])
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const result: { word: string; spanishWord: string | null; type: 'correct' | 'wrong' | 'missing' }[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && normalize(spokenWords[i - 1]) === normalize(spanishWords[j - 1])) {
      result.unshift({ word: spokenWords[i - 1], spanishWord: spanishWords[j - 1], type: 'correct' });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ word: spanishWords[j - 1], spanishWord: spanishWords[j - 1], type: 'missing' });
      j--;
    } else {
      result.unshift({ word: spokenWords[i - 1], spanishWord: null, type: 'wrong' });
      i--;
    }
  }
  return result;
}

function AudioControls({ isAudioPlaying, speed, onSpeedChange, onReplay }: {
  isAudioPlaying: boolean;
  speed: '1x' | 'slow';
  onSpeedChange: (s: '1x' | 'slow') => void;
  onReplay: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onReplay}
        disabled={isAudioPlaying}
        className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
          isAudioPlaying
            ? 'border border-[#1D9E75] bg-[#E1F5EE]'
            : 'border-[0.5px] border-gray-300 hover:border-[#1D9E75]'
        }`}
        title={isAudioPlaying ? 'Playing…' : 'Play pronunciation'}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isAudioPlaying ? '#1D9E75' : '#6b7280'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      </button>

      <div className="h-[30px] rounded-[20px] border-[0.5px] border-gray-300 flex items-center overflow-hidden">
        <button
          onClick={() => onSpeedChange('1x')}
          className={`h-full px-3 text-[12px] font-medium transition-all ${
            speed === '1x' ? 'bg-[#E1F5EE] text-[#085041]' : 'text-gray-500'
          }`}
        >
          1x
        </button>
        <div className="w-[0.5px] h-4 bg-gray-300" />
        <button
          onClick={() => onSpeedChange('slow')}
          className={`h-full px-3 text-[12px] font-medium transition-all ${
            speed === 'slow' ? 'bg-[#E1F5EE] text-[#085041]' : 'text-gray-500'
          }`}
        >
          slow
        </button>
      </div>
    </div>
  );
}

export default function UserFeedback({
  transcription,
  spanishPhrase,
  isCorrect,
  isAudioPlaying,
  speed,
  onSpeedChange,
  onReplay,
  onTryAgain,
  onNext,
}: Props) {
  const diff = transcription?.trim() ? diffWords(transcription, spanishPhrase) : null;

  return (
    <div className="flex-1 flex flex-col items-center justify-between w-full animate-screen-fade-in">

      {isCorrect ? (
        /* ── Correct answer layout ── */
        <div className="flex flex-col items-center flex-1 justify-center">
          {/* Correct Spanish phrase */}
          <p className="text-[18px] text-[#1D9E75] text-center leading-relaxed">{spanishPhrase}</p>

          {/* Audio controls */}
          <div className="mt-4">
            <AudioControls isAudioPlaying={isAudioPlaying} speed={speed} onSpeedChange={onSpeedChange} onReplay={onReplay} />
          </div>

          {/* Checkmark + encouragement inline */}
          <div className="flex items-center gap-2 mt-6">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" stroke="#1D9E75" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="7.5 12 10.5 15.5 16.5 8.5" stroke="#1D9E75" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-[18px] text-[#1D9E75]">bien hecho!</p>
          </div>
        </div>
      ) : (
        /* ── Incorrect answer layout ── */
        <div className="flex flex-col items-center gap-8 flex-1 justify-center">

          {/* YOU SAID block */}
          <div className="flex flex-col items-center gap-2">
            <p className="text-[11px] text-gray-400 uppercase tracking-wide">You said</p>
            <p className="text-[18px] text-center leading-relaxed">
              {diff ? (
                diff
                  .filter(({ type }) => type !== 'missing')
                  .map(({ word, type }, i) => (
                    <span key={i}>
                      {i > 0 ? ' ' : ''}
                      <span className={type === 'wrong' ? 'text-[#D85A30]' : 'text-gray-800'}>{word}</span>
                    </span>
                  ))
              ) : (
                <span className="text-gray-400">No answer recorded</span>
              )}
            </p>
          </div>

          {/* Divider */}
          <div className="w-[40px] h-[1px] bg-gray-300" />

          {/* CORRECT block */}
          <div className="flex flex-col items-center gap-2">
            <p className="text-[11px] text-gray-400 uppercase tracking-wide">Correct</p>
            <p className="text-[18px] text-gray-800 text-center leading-relaxed">
              {diff ? (
                diff
                  .filter(({ type }) => type !== 'wrong')
                  .map(({ spanishWord, type }, i) => (
                    <span key={i}>
                      {i > 0 ? ' ' : ''}
                      {type === 'missing' ? (
                        <span className="relative inline-block pb-[3px]">
                          {spanishWord}
                          <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-[#1D9E75]" />
                        </span>
                      ) : (
                        <span>{spanishWord}</span>
                      )}
                    </span>
                  ))
              ) : spanishPhrase}
            </p>
          </div>

          {/* Audio controls */}
          <AudioControls isAudioPlaying={isAudioPlaying} speed={speed} onSpeedChange={onSpeedChange} onReplay={onReplay} />

          {/* Try again link */}
          <button
            onClick={onTryAgain}
            className="text-[13px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            try again
          </button>
        </div>
      )}

      {/* Next link — both layouts */}
      <button
        onClick={onNext}
        className="text-[13px] text-gray-400 hover:text-gray-600 transition-colors"
      >
        next →
      </button>
    </div>
  );
}
