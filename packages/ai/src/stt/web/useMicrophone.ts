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

  const onReceiveData = useCallback((ev: BlobEvent) => {
    onVoiceData(ev);
  }, [onVoiceData]);

  const setupMicrophone = async () => {
    // #region agent log
    const setupStartedAt = Date.now();
    fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'86d2f5'},body:JSON.stringify({sessionId:'86d2f5',hypothesisId:'H1b',location:'useMicrophone.ts:setupMicrophone',message:'setupMicrophone started (getUserMedia)',data:{},timestamp:setupStartedAt})}).catch(()=>{});
    // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'86d2f5'},body:JSON.stringify({sessionId:'86d2f5',hypothesisId:'H1b',location:'useMicrophone.ts:setupMicrophone',message:'setupMicrophone completed (Ready)',data:{elapsedMs:Date.now()-setupStartedAt},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  };

  const startMicrophone = () => {
    const mic = microphone.current;
    if (mic?.state === 'recording') return;
    // #region agent log
    const startedAt = Date.now();
    fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'86d2f5'},body:JSON.stringify({sessionId:'86d2f5',hypothesisId:'H1b',location:'useMicrophone.ts:startMicrophone',message:'startMicrophone called',data:{micRecorderState:mic?.state??'null',path:mic?.state==='paused'?'resume':'start-fresh'},timestamp:startedAt})}).catch(()=>{});
    // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'86d2f5'},body:JSON.stringify({sessionId:'86d2f5',hypothesisId:'H1b',location:'useMicrophone.ts:stopMicrophone',message:'stopMicrophone called',data:{micRecorderState:microphone.current?.state??'null'},timestamp:Date.now()})}).catch(()=>{});
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
