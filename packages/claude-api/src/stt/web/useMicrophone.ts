import { useState, useRef, useCallback } from 'react';

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

  const onReceiveData = useCallback((ev: BlobEvent) => { onVoiceData(ev); }, [onVoiceData]);

  const setupMicrophone = async () => {
    setMicrophoneState(MicrophoneState.SettingUp);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { noiseSuppression: true, echoCancellation: true },
    });
    microphone.current = new MediaRecorder(stream);
    setMicrophoneState(MicrophoneState.Ready);
  };

  const startMicrophone = () => {
    const mic = microphone.current;
    if (mic?.state === 'recording') return;
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
