/**
 * Framework-agnostic STT session rules shared by web and native adapters:
 * start-path selection, accept-gate (including Finalize flush), epoch, and
 * a bounded audio ring buffer flushed in order when the socket opens.
 */

export type SttConnectionState = 'closed' | 'connecting' | 'open';

export type SttStartPath = 'warm' | 'connect' | 'keyword-mismatch';

export function keywordsMatch(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

/**
 * Choose how `start()` should treat the live socket.
 * `cold` (mic not set up) is an adapter-level overlay on `connect`.
 */
export function selectSttStartPath(input: {
  connectionState: SttConnectionState;
  connectedKeywords: readonly string[];
  requestedKeywords: readonly string[];
}): SttStartPath {
  if (input.connectionState === 'open') {
    return keywordsMatch(input.connectedKeywords, input.requestedKeywords)
      ? 'warm'
      : 'keyword-mismatch';
  }
  return 'connect';
}

export interface SttAcceptGateState {
  accepting: boolean;
}

export type SttAcceptGateEvent =
  | { type: 'close' }
  | { type: 'openAfterStoppedMic' }
  | { type: 'transcript'; isFinal: boolean; fromFinalize: boolean };

export interface SttAcceptGateResult {
  accepting: boolean;
  /** Whether this transcript should reach the caption reducer. */
  acceptEvent: boolean;
}

/**
 * Accept-gate for a kept-open Deepgram socket.
 *
 * - `close`: live Clear / stop — drop everything until reopened.
 * - `openAfterStoppedMic`: no audio has flowed since the last Finalize, so
 *   the next result belongs to the new attempt.
 * - While closed, drop interims. A `from_finalize` result is the flush —
 *   drop it and reopen. An `is_final` without `from_finalize` is new speech
 *   — reopen and accept it.
 */
export function reduceAcceptGate(
  state: SttAcceptGateState,
  event: SttAcceptGateEvent,
): SttAcceptGateResult {
  if (event.type === 'close') {
    return { accepting: false, acceptEvent: false };
  }
  if (event.type === 'openAfterStoppedMic') {
    return { accepting: true, acceptEvent: false };
  }
  if (state.accepting) {
    return { accepting: true, acceptEvent: true };
  }
  if (!event.isFinal) {
    return { accepting: false, acceptEvent: false };
  }
  if (event.fromFinalize) {
    return { accepting: true, acceptEvent: false };
  }
  return { accepting: true, acceptEvent: true };
}

export function bumpSttEpoch(epoch: number): number {
  return epoch + 1;
}

export function isCurrentSttEpoch(current: number, mine: number): boolean {
  return current === mine;
}

/** 16 kHz × 16-bit mono = 32 bytes/ms. */
export const STT_PCM_BYTES_PER_MS = 32;
export const STT_AUDIO_BUFFER_MAX_MS = 5000;
export const STT_AUDIO_BUFFER_MAX_BYTES =
  STT_AUDIO_BUFFER_MAX_MS * STT_PCM_BYTES_PER_MS;

export interface SttAudioRingBuffer<T> {
  push: (item: T) => void;
  flush: () => T[];
  clear: () => void;
  readonly length: number;
  readonly dropped: number;
  readonly bytes: number;
}

/**
 * Drop-oldest ring buffer. Flush returns items in insertion order.
 */
export function createSttAudioRingBuffer<T>(
  byteLengthOf: (item: T) => number,
  maxBytes: number = STT_AUDIO_BUFFER_MAX_BYTES,
): SttAudioRingBuffer<T> {
  const items: T[] = [];
  let bytes = 0;
  let dropped = 0;

  const push = (item: T): void => {
    const size = byteLengthOf(item);
    items.push(item);
    bytes += size;
    while (bytes > maxBytes && items.length > 0) {
      const removed = items.shift();
      if (removed === undefined) break;
      bytes -= byteLengthOf(removed);
      dropped += 1;
    }
  };

  const flush = (): T[] => {
    const out = items.slice();
    items.length = 0;
    bytes = 0;
    return out;
  };

  const clear = (): void => {
    items.length = 0;
    bytes = 0;
  };

  return {
    push,
    flush,
    clear,
    get length() {
      return items.length;
    },
    get dropped() {
      return dropped;
    },
    get bytes() {
      return bytes;
    },
  };
}
