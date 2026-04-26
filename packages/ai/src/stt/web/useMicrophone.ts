import { useState, useRef, useCallback, useEffect } from 'react';
import {
  getDefaultLearningPipelineDebug,
  logSttMicSetupDone,
  logSttMicSetupStart,
  logSttMicStart,
  logSttMicStartSkipped,
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
  const energyStreamRef = useRef<MediaStream | null>(null);
  const energyCtxRef = useRef<AudioContext | null>(null);
  const energyAnalyserRef = useRef<AnalyserNode | null>(null);
  const energyBufRef = useRef<Float32Array | null>(null);
  const [microphoneState, setMicrophoneState] = useState<MicrophoneState>(MicrophoneState.NotSetup);
  /** Set only in the `useEffect` below (do not set in `teardownMicrophone` — that runs async and can clobber a Strict remount). */
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const onReceiveData = useCallback((ev: BlobEvent) => {
    onVoiceData(ev);
  }, [onVoiceData]);

  /** False while `teardownMicrophone` has nulled the stream but React may still show `Ready`. */
  const isStreamReady = useCallback(() => energyStreamRef.current != null, []);

  // Idempotent. On first call: opens the mic via getUserMedia and builds the
  // audio-energy analyser graph. On subsequent calls (e.g. after stop→start):
  // if the stream is still alive, just reports Ready and returns without
  // recycling anything. The MediaStream and AudioContext are intentionally
  // kept alive for the entire hook lifetime — they're created once in this
  // function, and only torn down in teardownMicrophone (unmount).
  //
  // Rationale: Firefox degrades rapidly when getUserMedia is called in a
  // tight open/close loop. After ~3–4 cycles it returns a track that reports
  // "live" but produces silence, causing Deepgram to receive only empty
  // audio. Keeping the underlying stream alive eliminates the recycling.
  // Per-attempt state isolation is achieved by creating a fresh
  // MediaRecorder per startMicrophone() instead (see below).
  const setupMicrophone = async () => {
    if (energyStreamRef.current) {
      setMicrophoneState(MicrophoneState.Ready);
      return;
    }
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
    if (!isMountedRef.current) {
      stream.getTracks().forEach((t) => {
        try { t.stop(); } catch { /* empty */ }
      });
      return;
    }
    // NOTE: we do NOT create the MediaRecorder here. It's created fresh per
    // attempt in startMicrophone() so that (a) mic.stop() cleanly flushes the
    // buffered audio to the CURRENT WebSocket via its final dataavailable
    // event, and (b) the next attempt's MediaRecorder produces a brand-new
    // WebM stream whose first blob contains the full EBML header — required
    // for Deepgram to decode on a freshly-opened WebSocket.
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
    if (!isMountedRef.current) {
      stream.getTracks().forEach((t) => {
        try { t.stop(); } catch { /* empty */ }
      });
      energyStreamRef.current = null;
      energyCtxRef.current = null;
      energyAnalyserRef.current = null;
      energyBufRef.current = null;
      return;
    }
    setMicrophoneState(MicrophoneState.Ready);
    if (getDefaultLearningPipelineDebug()) {
      logSttMicSetupDone({ elapsedMs: Date.now() - setupStartedAt });
    }
  };

  const startMicrophone = () => {
    let mic = microphone.current;
    // Duplicate OPEN callbacks (or a race with stop) can call start while the
    // recorder is already active. Still sync React to Open so `isRecording`
    // flips and the phrase UI leaves `recordingPriming`.
    if (mic?.state === 'recording') {
      setMicrophoneState(MicrophoneState.Open);
      return;
    }
    // Fresh MediaRecorder per attempt (see setupMicrophone rationale). The
    // previous recorder was disposed in stopMicrophone once its 'stop' event
    // fired and its final dataavailable was flushed to the old WS.
    if (!mic) {
      const stream = energyStreamRef.current;
      if (!stream) {
        if (getDefaultLearningPipelineDebug()) {
          logSttMicStartSkipped({ reason: 'no-stream' });
        }
        return;
      }
      mic = new MediaRecorder(stream);
      microphone.current = mic;
    }
    if (getDefaultLearningPipelineDebug()) {
      logSttMicStart({
        recorderState: mic.state,
        path: 'start-fresh',
      });
    }
    setMicrophoneState(MicrophoneState.Opening);
    mic.addEventListener('dataavailable', onReceiveData);
    mic.start(250);
    setMicrophoneState(MicrophoneState.Open);
  };

  // Ends the current recording attempt while KEEPING the underlying stream
  // and AudioContext alive for the next attempt. The MediaRecorder itself is
  // disposed — a fresh one will be created in the next startMicrophone().
  //
  // We await the recorder's 'stop' event (not just its synchronous state
  // flip) because MediaRecorder.stop() asynchronously dispatches one final
  // 'dataavailable' event with the still-buffered audio, followed by 'stop'.
  // That final dataavailable goes through our existing listener → sendVoiceData
  // → the CURRENT WebSocket (still OPEN at this point). Without this wait,
  // the adapter's stop() would race ahead to disconnectFromDeepgram and close
  // the WS before the final blob shipped, dropping the last fragment of
  // speech. (Pausing+resuming the recorder was considered and rejected: pause
  // keeps the pre-pause audio in the recorder's internal blob, which then
  // leaks into the next attempt's WebSocket at the wrong timing, and WebM
  // container continuity breaks across WS swaps.)
  const stopMicrophone = async () => {
    if (getDefaultLearningPipelineDebug()) {
      logSttMicStop({
        recorderState: microphone.current?.state ?? null,
      });
    }
    setMicrophoneState(MicrophoneState.Stopping);
    const mic = microphone.current;
    if (mic && mic.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        let done = false;
        const finalize = () => {
          if (done) return;
          done = true;
          resolve();
        };
        mic.addEventListener('stop', finalize, { once: true });
        try {
          mic.stop();
        } catch {
          finalize();
        }
        // Safety timeout: if the 'stop' event never fires (e.g. recorder in
        // an unexpected state), don't hang the caller indefinitely.
        setTimeout(finalize, 300);
      });
    }
    // Drop the MediaRecorder ref. GC collects the recorder + its listener.
    // Stream and AudioContext stay alive for the next attempt.
    microphone.current = null;
    setMicrophoneState(MicrophoneState.Ready);
  };

  // Full teardown for unmount / end-of-session. Stops the MediaStream tracks
  // (releases the OS mic indicator) and closes the AudioContext (frees the
  // DSP graph). Only call this when the component is going away, not between
  // attempts.
  const teardownMicrophone = async () => {
    const mic = microphone.current;
    microphone.current = null;
    if (mic && mic.state !== 'inactive') {
      try { mic.stop(); } catch {}
    }
    energyStreamRef.current?.getTracks().forEach((t) => {
      try { t.stop(); } catch {}
    });
    energyStreamRef.current = null;
    const ctx = energyCtxRef.current;
    energyCtxRef.current = null;
    energyAnalyserRef.current = null;
    energyBufRef.current = null;
    // Must not leave `Ready` while the stream ref is null: `await ctx.close()`
    // can take a long time; `start()` could otherwise pick connect-direct and
    // open Deepgram before a MediaRecorder can be created (no-stream).
    setMicrophoneState(MicrophoneState.Stopped);
    if (ctx) {
      try { await ctx.close(); } catch {}
    }
  };

  return {
    microphoneState,
    setupMicrophone,
    startMicrophone,
    stopMicrophone,
    teardownMicrophone,
    isStreamReady,
  };
}
