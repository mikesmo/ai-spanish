/**
 * Ambient types for native-only modules so `packages/ai` typecheck can see
 * the STT transport files. Runtime bindings come from the mobile app.
 */
declare module 'react-native' {
  export const Platform: {
    OS: string;
    select: <T>(map: { ios?: T; android?: T; default?: T }) => T | undefined;
  };

  export class NativeEventEmitter {
    constructor(nativeModule: unknown);
    addListener(
      eventType: string,
      listener: (event: unknown) => void,
    ): { remove: () => void };
  }

  export const NativeModules: {
    Deepgram?: unknown;
    MicPermission?: { request: () => Promise<boolean> };
    [key: string]: unknown;
  };

  export const PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: string };
    RESULTS: { GRANTED: string };
    request: (permission: string) => Promise<string>;
  };
}

declare module 'react-native-deepgram' {
  export const Deepgram: {
    startRecording: () => Promise<void>;
    stopRecording: () => Promise<void>;
  };
}
