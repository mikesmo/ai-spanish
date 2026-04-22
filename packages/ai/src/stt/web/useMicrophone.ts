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
    setMicrophoneState(MicrophoneState.Ready);
    if (getDefaultLearningPipelineDebug()) {
      logSttMicSetupDone({ elapsedMs: Date.now() - setupStartedAt });
    }
  };

  const startMicrophone = () => {
    const mic = microphone.current;
    if (mic?.state === 'recording') return;
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
    setMicrophoneState(MicrophoneState.Open);
  };

  const stopMicrophone = () => {
    if (getDefaultLearningPipelineDebug()) {
      logSttMicStop({
        recorderState: microphone.current?.state ?? null,
      });
    }
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
