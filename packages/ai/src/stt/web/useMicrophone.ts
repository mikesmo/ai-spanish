import { useState, useRef, useCallback } from 'react';
import {
  getDefaultLearningPipelineDebug,
  logSttMicSetupDone,
  logSttMicSetupStart,
  logSttMicStart,
  logSttMicStop,
} from '@ai-spanish/logic';

export enum MicrophoneState {
  NotSetup = -1,
  SettingUp = 0,
  Ready = 1,
  Opening = 2,
  Open = 3,
  Error = 4,
  Stopping = 7,
  Stopped = 8,
}

export function useMicrophone(onVoiceData: (ev: BlobEvent) => void) {
  const microphone = useRef<MediaRecorder | null>(null);
  // #region agent log
  const energyStreamRef = useRef<MediaStream | null>(null);
  const energyCtxRef = useRef<AudioContext | null>(null);
  const energyAnalyserRef = useRef<AnalyserNode | null>(null);
  const energyBufRef = useRef<Float32Array | null>(null);
  const energyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // #endregion
  const [microphoneState, setMicrophoneState] = useState<MicrophoneState>(MicrophoneState.NotSetup);

  const onReceiveData = useCallback((ev: BlobEvent) => {
    onVoiceData(ev);
  }, [onVoiceData]);

  const setupMicrophone = async () => {
    const setupStartedAt = Date.now();
    if (getDefaultLearningPipelineDebug()) {
      logSttMicSetupStart();
    }
    setMicrophoneState(MicrophoneState.SettingUp);
    const stream = await navigator.mediaDevices.getUserMedia({
      // noiseSuppression disabled — Chrome's aggressive noise suppression was
      // trimming quiet Spanish vowels (e.g. "algo" after a pause), causing
      // Deepgram to miss the audio entirely. echoCancellation kept to reduce
      // TTS→mic bleed on laptop speakers.
      audio: { noiseSuppression: false, echoCancellation: true },
    });
    microphone.current = new MediaRecorder(stream);
    // #region agent log
    try {
      energyStreamRef.current = stream;
      const Ctx: typeof AudioContext =
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext ?? window.AudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      energyCtxRef.current = ctx;
      energyAnalyserRef.current = analyser;
      energyBufRef.current = new Float32Array(analyser.fftSize);
    } catch {}
    // #endregion
    setMicrophoneState(MicrophoneState.Ready);
    if (getDefaultLearningPipelineDebug()) {
      logSttMicSetupDone({ elapsedMs: Date.now() - setupStartedAt });
    }
  };

  const startMicrophone = () => {
    const mic = microphone.current;
    if (mic?.state === 'recording') return;
    // #region agent log
    fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '961193',
      },
      body: JSON.stringify({
        sessionId: '961193',
        runId: 'jacket-bleed',
        hypothesisId: 'H5',
        location: 'stt/web/useMicrophone.ts:startMicrophone',
        message: 'mic start()',
        data: { recorderState: mic?.state ?? null },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (getDefaultLearningPipelineDebug()) {
      logSttMicStart({
        recorderState: mic?.state ?? null,
        path: mic?.state === 'paused' ? 'resume' : 'start-fresh',
      });
    }
    setMicrophoneState(MicrophoneState.Opening);
    if (mic?.state === 'paused') {
      mic.resume();
    } else if (mic) {
      mic.addEventListener('dataavailable', onReceiveData);
      mic.start(250);
    }
    // #region agent log
    if (energyTimerRef.current) {
      clearInterval(energyTimerRef.current);
      energyTimerRef.current = null;
    }
    const analyser = energyAnalyserRef.current;
    const buf = energyBufRef.current;
    if (analyser && buf) {
      energyTimerRef.current = setInterval(() => {
        try {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          let peak = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = buf[i];
            sum += v * v;
            const abs = v < 0 ? -v : v;
            if (abs > peak) peak = abs;
          }
          const rms = Math.sqrt(sum / buf.length);
          fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Debug-Session-Id': '961193',
            },
            body: JSON.stringify({
              sessionId: '961193',
              runId: 'audio-energy',
              hypothesisId: 'H6-H7',
              location: 'stt/web/useMicrophone.ts:rmsTick',
              message: 'mic rms sample',
              data: {
                rms: Number(rms.toFixed(4)),
                peak: Number(peak.toFixed(4)),
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
        } catch {}
      }, 250);
    }
    // #endregion
    setMicrophoneState(MicrophoneState.Open);
  };

  const stopMicrophone = () => {
    if (getDefaultLearningPipelineDebug()) {
      logSttMicStop({
        recorderState: microphone.current?.state ?? null,
      });
    }
    // #region agent log
    if (energyTimerRef.current) {
      clearInterval(energyTimerRef.current);
      energyTimerRef.current = null;
    }
    // #endregion
    setMicrophoneState(MicrophoneState.Stopping);
    const mic = microphone.current;
    if (mic?.state === 'recording') mic.stop();
    mic?.removeEventListener('dataavailable', onReceiveData);
    setMicrophoneState(MicrophoneState.Stopped);
  };

  return {
    microphone: microphone.current,
    microphoneState,
    setupMicrophone,
    startMicrophone,
    stopMicrophone,
  };
}
